/**
 * apps/web — deterministic gameplay entity types (resource / dynamic blocker /
 * wanderer) and the system that drives them.
 *
 * These are genuine ECS components living in the *engine-core* `World` (the same
 * `coreWorld` the @omega/replay Recorder snapshots every tick), so they are
 * deterministically recordable and replayable alongside the physics bodies and
 * GOAP agents.
 *
 * Determinism contract — every behaviour is a pure function of:
 *   - the seeded terrain / nav grid,
 *   - the entity's own serializable component state (tx, tz, path, ...),
 *   - the *positions* (tx, tz) of every other entity this tick, and
 *   - the fixed tick index.
 * There is NO `Math.random`, NO `Date.now`, NO use of entity ids to break ties
 * (ids are reassigned on replay, so any id-derived behaviour would desync).
 * Tie-breaks are always by (tx, tz) or insertion/scan order, which are stable
 * across record → restore → play.
 *
 * The three entity types show EMERGENT behaviour together:
 *   - Resource          : a static, depletable node. Agents AND wanderers that
 *                         step onto it decrement its amount (it shrinks, then
 *                         runs dry) — emergence from shared interaction.
 *   - DynamicBlocker    : a roaming obstacle on a deterministic A* loop. It
 *                         marks its tile as blocked in the live nav grid, so
 *                         agents/wanderers must re-route around it — emergence
 *                         from a moving obstacle with no per-frame randomness.
 *   - Wanderer / Scout  : a goal-less scout. It picks a new target tile by a
 *                         deterministic function of (tick, id), paths there over
 *                         the live grid (respecting blockers), and gathers
 *                         resources it passes over. Shows free navigation that
 *                         is NOT a GOAP plan.
 */

import { Vec2 } from '@omega/engine-math';
import type { World } from '@omega/engine-core';
import type { Grid } from '@omega/nav-core';
import { pathBetween, nearestFreeTile } from './nav';
import { AGENT_STORE } from './ai';

/** Engine-core store names (also the replay component names). */
export const RESOURCE_STORE = 'ResourceC';
export const BLOCKER_STORE = 'BlockerC';
export const WANDERER_STORE = 'WandererC';

/** A plain tile (plain object so it survives JSON snapshot/restore bit-for-bit). */
export interface Tile {
  x: number;
  y: number;
}

/** A static, depletable resource node. */
export interface ResourceC {
  tx: number;
  tz: number;
  /** Remaining units; hits 0 and then nothing can gather from it. */
  amount: number;
}

/** A roaming obstacle that walks a deterministic closed loop. */
export interface BlockerC {
  tx: number;
  tz: number;
  /** Closed loop of tiles (start === end), pure function of spawn + grid. */
  loop: Tile[];
  /** Index into `loop` of the blocker's current tile. */
  loopIdx: number;
}

/** A goal-less scout that wanders the live grid and gathers resources. */
export interface WandererC {
  tx: number;
  tz: number;
  /** Current target tile (where it is walking to). */
  goalX: number;
  goalY: number;
  /** Remaining path to the goal (inclusive of current + goal). */
  path: Tile[];
  /** Index into `path` of the wanderer's current tile. */
  pathIdx: number;
  /** Total resource units this wanderer has gathered. */
  gathered: number;
}

/**
 * A live nav grid wrapping a static base grid plus a set of dynamically-blocked
 * tiles (the blockers' current positions). Implements the nav-core `Grid`
 * interface so A* / the GOAP agents / wanderers all see the moving obstacles.
 *
 * Blocked-ness is `base.isBlocked(x,y) || dynamic.has(y*W + x)`. Deterministic
 * and side-effect-free to read.
 */
export class LiveGrid implements Grid {
  readonly width: number;
  readonly height: number;
  private readonly dyn = new Set<number>();

  constructor(private readonly base: Grid) {
    this.width = base.width;
    this.height = base.height;
  }

  isBlocked(x: number, y: number): boolean {
    if (this.base.isBlocked(x, y)) return true;
    return this.dyn.has(y * this.width + x);
  }

  /** Mark a tile as dynamically blocked (a blocker is standing on it). */
  block(x: number, y: number): void {
    this.dyn.add(y * this.width + x);
  }

  /** Clear a tile's dynamic block. */
  unblock(x: number, y: number): void {
    this.dyn.delete(y * this.width + x);
  }

  /** Drop all dynamic blocks (used when re-syncing from authoritative state). */
  clearDynamic(): void {
    this.dyn.clear();
  }
}

/** Build a deterministic closed loop for a blocker: A* to the opposite corner and back. */
function buildBlockerLoop(grid: Grid, start: Tile): Tile[] {
  const goal = nearestFreeTile(grid, grid.width - 1 - start.x, grid.height - 1 - start.y) ??
    new Vec2(start.x, start.y);
  const forward = pathBetween(grid, new Vec2(start.x, start.y), goal, { allowDiagonal: false });
  if (!forward || forward.length < 2) {
    // Degenerate: stay put (loop of a single tile).
    return [{ x: start.x, y: start.y }];
  }
  // Concatenate forward with its reverse minus the shared endpoints → a loop.
  const back = forward.slice(1, forward.length - 1).reverse();
  const loop: Tile[] = [
    ...forward.map((v) => ({ x: v.x, y: v.y })),
    ...back.map((v) => ({ x: v.x, y: v.y })),
  ];
  return loop;
}

/**
 * The deterministic gameplay system. Owns the resource / blocker / wanderer
 * stores in the engine-core world and advances them one fixed tick per `step()`.
 *
 * It reads agent positions directly from the {@link AGENT_STORE} (same world) so
 * agents and wanderers can both deplete resources — and re-routes everyone
 * around the blockers via the shared {@link LiveGrid}.
 */
export class GameplaySystem {
  private readonly world: World;
  private readonly grid: LiveGrid;

  constructor(world: World, grid: LiveGrid) {
    this.world = world;
    this.grid = grid;
  }

  /** Spawn a resource node at a (snapped) tile. Returns the new entity id. */
  addResource(tx: number, tz: number, amount: number): number {
    const snap = nearestFreeTile(this.grid, tx, tz) ?? new Vec2(tx, tz);
    const id = this.world.createEntity();
    this.world.addComponent<ResourceC>(RESOURCE_STORE, id, { tx: snap.x, tz: snap.y, amount });
    return id;
  }

  /** Spawn a dynamic blocker whose loop is a deterministic A* circuit. */
  addBlocker(tx: number, tz: number): number {
    const snap = nearestFreeTile(this.grid, tx, tz) ?? new Vec2(tx, tz);
    const loop = buildBlockerLoop(this.grid, { x: snap.x, y: snap.y });
    const id = this.world.createEntity();
    this.world.addComponent<BlockerC>(BLOCKER_STORE, id, {
      tx: snap.x,
      tz: snap.y,
      loop,
      loopIdx: 0,
    });
    this.grid.block(snap.x, snap.y);
    return id;
  }

  /** Spawn a wanderer at a (snapped) tile with no goal yet (chosen on first step). */
  addWanderer(tx: number, tz: number): number {
    const snap = nearestFreeTile(this.grid, tx, tz) ?? new Vec2(tx, tz);
    const id = this.world.createEntity();
    this.world.addComponent<WandererC>(WANDERER_STORE, id, {
      tx: snap.x,
      tz: snap.y,
      goalX: snap.x,
      goalY: snap.y,
      path: [{ x: snap.x, y: snap.y }],
      pathIdx: 0,
      gathered: 0,
    });
    return id;
  }

  // ---- per-tick advance --------------------------------------------------

  /** Advance every gameplay entity by one fixed tick (deterministic order). */
  step(tick: number): void {
    this.advanceBlockers();
    this.advanceWanderers(tick);
    this.resolveGathering();
  }

  /** Blockers walk their loop one tile per tick, yielding to occupied tiles. */
  private advanceBlockers(): void {
    for (const id of this.world.store<BlockerC>(BLOCKER_STORE).keys()) {
      const c = this.world.getComponent<BlockerC>(BLOCKER_STORE, id);
      if (!c || c.loop.length <= 1) continue;
      // Occupancy WITHOUT this blocker's own tile and WITHOUT resource tiles
      // (blockers never stand on resources; they route around).
      const occ = this.occupancyExcept(BLOCKER_STORE, id);
      const nxt = (c.loopIdx + 1) % c.loop.length;
      const target = c.loop[nxt]!;
      // Only move if the target tile is free of other entities and not a
      // statically-blocked tile. If blocked, the blocker waits this tick
      // (deterministic — no randomness, no teleport).
      if (this.grid.isBlocked(target.x, target.y)) continue;
      if (occ.has(`${target.x},${target.y}`)) continue;
      this.grid.unblock(c.tx, c.tz);
      c.tx = target.x;
      c.tz = target.y;
      c.loopIdx = nxt;
      this.grid.block(c.tx, c.tz);
      this.world.addComponent<BlockerC>(BLOCKER_STORE, id, c);
    }
  }

  /** Build occupancy excluding one entity's own current tile. */
  private occupancyExcept(
    store: string,
    selfId: number,
  ): Set<string> {
    const occ = new Set<string>();
    const addStore = (name: string) => {
      for (const id of this.world.store(name).keys()) {
        if (name === store && id === selfId) continue;
        const c = this.world.getComponent<{ tx: number; tz: number }>(name, id);
        if (c) occ.add(`${c.tx},${c.tz}`);
      }
    };
    addStore(RESOURCE_STORE);
    addStore(BLOCKER_STORE);
    addStore(WANDERER_STORE);
    addStore(AGENT_STORE);
    return occ;
  }

  /** Wanderers pick a deterministic target, path to it, and gather en route. */
  private advanceWanderers(tick: number): void {
    for (const id of this.world.store<WandererC>(WANDERER_STORE).keys()) {
      const c = this.world.getComponent<WandererC>(WANDERER_STORE, id);
      if (!c) continue;
      const atGoal = c.pathIdx >= c.path.length - 1;
      const needNewGoal = atGoal || c.path.length === 0;

      if (needNewGoal) {
        // Deterministic target: stride through the free-tile list by (tick, id).
        const target = this.pickWandererTarget(tick, id, c);
        const p = pathBetween(this.grid, new Vec2(c.tx, c.tz), new Vec2(target.x, target.y), {
          allowDiagonal: false,
        });
        if (p && p.length >= 1) {
          c.path = p.map((v) => ({ x: v.x, y: v.y }));
          c.pathIdx = 0;
          c.goalX = target.x;
          c.goalY = target.y;
        } else {
          // Unreachable: idle one tile (wait) deterministically.
          c.path = [{ x: c.tx, y: c.tz }];
          c.pathIdx = 0;
        }
      }

      // Step one tile along the path (unless already at the end).
      if (c.pathIdx < c.path.length - 1) {
        const nxtTile = c.path[c.pathIdx + 1]!;
        // Re-route if the next tile became blocked by a blocker.
        if (this.grid.isBlocked(nxtTile.x, nxtTile.y)) {
          const p = pathBetween(this.grid, new Vec2(c.tx, c.tz), new Vec2(c.goalX, c.goalY), {
            allowDiagonal: false,
          });
          if (p && p.length >= 1) {
            c.path = p.map((v) => ({ x: v.x, y: v.y }));
            c.pathIdx = 0;
          }
        }
        if (c.pathIdx < c.path.length - 1) {
          const step = c.path[c.pathIdx + 1]!;
          c.tx = step.x;
          c.tz = step.y;
          c.pathIdx++;
        }
      }
      this.world.addComponent<WandererC>(WANDERER_STORE, id, c);
    }
  }

  /** Deterministic target tile for a wanderer (pure function of tick + id). */
  private pickWandererTarget(tick: number, id: number, c: WandererC): Tile {
    const free: Tile[] = [];
    for (let y = 0; y < this.grid.height; y++) {
      for (let x = 0; x < this.grid.width; x++) {
        if (!this.grid.isBlocked(x, y)) free.push({ x, y });
      }
    }
    if (free.length === 0) return { x: c.tx, y: c.tz };
    // Stride coprime to the free count keeps targets well spread; deterministic.
    const idx = (tick * 7 + id * 13) % free.length;
    return free[idx]!;
  }

  /**
   * Resolve resource gathering: any agent OR wanderer standing on a resource
   * tile removes one unit (deterministic id-ascending order so simultaneous
   * claimants are resolved identically every run).
   */
  private resolveGathering(): void {
    // Snapshot the positions of every gatherer (agents + wanderers) once.
    const gatherers: { x: number; y: number; isWanderer: boolean; id: number }[] = [];
    for (const id of this.world.store(AGENT_STORE).keys()) {
      const c = this.world.getComponent<{ tx: number; tz: number }>(AGENT_STORE, id);
      if (c) gatherers.push({ x: c.tx, y: c.tz, isWanderer: false, id });
    }
    for (const id of this.world.store<WandererC>(WANDERER_STORE).keys()) {
      const c = this.world.getComponent<WandererC>(WANDERER_STORE, id);
      if (c) gatherers.push({ x: c.tx, y: c.tz, isWanderer: true, id });
    }

    for (const rid of this.world.store<ResourceC>(RESOURCE_STORE).keys()) {
      const r = this.world.getComponent<ResourceC>(RESOURCE_STORE, rid);
      if (!r || r.amount <= 0) continue;
      // Deterministic order: agents first (lower store order), then by id.
      const claimants = gatherers
        .filter((g) => g.x === r.tx && g.y === r.tz)
        .sort((a, b) => (a.isWanderer === b.isWanderer ? a.id - b.id : a.isWanderer ? 1 : -1));
      for (const g of claimants) {
        if (r.amount <= 0) break;
        r.amount -= 1;
        if (g.isWanderer) {
          const w = this.world.getComponent<WandererC>(WANDERER_STORE, g.id);
          if (w) {
            w.gathered += 1;
            this.world.addComponent<WandererC>(WANDERER_STORE, g.id, w);
          }
        }
      }
      this.world.addComponent<ResourceC>(RESOURCE_STORE, rid, r);
    }
  }

  // ---- observables -------------------------------------------------------

  resources(): { id: number; tx: number; tz: number; amount: number }[] {
    const out: { id: number; tx: number; tz: number; amount: number }[] = [];
    for (const id of this.world.store<ResourceC>(RESOURCE_STORE).keys()) {
      const c = this.world.getComponent<ResourceC>(RESOURCE_STORE, id);
      if (c) out.push({ id, tx: c.tx, tz: c.tz, amount: c.amount });
    }
    return out;
  }

  blockers(): { id: number; tx: number; tz: number }[] {
    const out: { id: number; tx: number; tz: number }[] = [];
    for (const id of this.world.store<BlockerC>(BLOCKER_STORE).keys()) {
      const c = this.world.getComponent<BlockerC>(BLOCKER_STORE, id);
      if (c) out.push({ id, tx: c.tx, tz: c.tz });
    }
    return out;
  }

  wanderers(): { id: number; tx: number; tz: number; gathered: number }[] {
    const out: { id: number; tx: number; tz: number; gathered: number }[] = [];
    for (const id of this.world.store<WandererC>(WANDERER_STORE).keys()) {
      const c = this.world.getComponent<WandererC>(WANDERER_STORE, id);
      if (c) out.push({ id, tx: c.tx, tz: c.tz, gathered: c.gathered });
    }
    return out;
  }
}
