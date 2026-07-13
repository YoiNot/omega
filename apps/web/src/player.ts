/**
 * apps/web — deterministic player controller (Roadmap §15, part 1/4).
 *
 * A `PlayerController` maps a per-tick {@link InputCommand} (derived from
 * @omega/input-core frames) onto a single player entity that lives in the SAME
 * engine-core `World` the @omega/replay `Recorder` snapshots every tick — so
 * the player is fully record/replay-deterministic alongside physics + AI.
 *
 * Movement is grid-locked and validated by the shared nav-core `Grid` (the
 * existing `LiveGrid`), exactly like the GOAP agents / wanderers: the player
 * advances at most one tile per fixed tick along a deterministic A* path. This
 * means the player can never desync from the recorded world and can never walk
 * into an impassable / blocker-occupied tile.
 *
 * The controller ALSO carries an ai-goap goal stack (`{ hasResource, atBase,
 * delivered }`) — the same vocabulary the existing `GoapSystem` uses — so the
 * player's higher-level intent (`collect` / `deliver`) is expressed through the
 * already-present GOAP component shape, and the existing recorder / scenario /
 * net code can observe it unchanged.
 *
 * Determinism contract — every observable mutation is a pure function of:
 *   - the seeded grid (navGrid / liveGrid),
 *   - the player's own serializable component state (tx, tz, facing, goal),
 *   - the input command sequence (frame, dx, dz, action), and
 *   - the fixed tick index.
 * There is NO `Math.random`, NO `Date.now`, NO entity-id-derived behaviour.
 */

import { Vec2 } from '@omega/engine-math';
import type { World } from '@omega/engine-core';
import type { Grid } from '@omega/nav-core';
import { pathBetween, nearestFreeTile, tileToWorld } from './nav';

/** Engine-core store name for the serializable player component. */
export const PLAYER_STORE = 'PlayerC';

/** Facing direction the player sprite/entity reports (for the HUD/overlay). */
export type Facing = 'N' | 'S' | 'E' | 'W' | 'NE' | 'NW' | 'SE' | 'SW' | 'idle';

/** Serializable player state — all numbers/strings, survives JSON snapshot. */
export interface PlayerComponent {
  /** Current tile X (column). */
  tx: number;
  /** Current tile Y (world Z, row). */
  tz: number;
  /** Last movement direction as a facing tag. */
  facing: Facing;
  /** 1 while a collect/deliver goal is active. */
  hasGoal: number;
  /** 1 once a resource has been picked up. */
  hasResource: number;
  /** 1 once the resource was delivered to base. */
  delivered: number;
  /** Active GOAP-style goal tag ('collect' | 'deliver' | 'idle'). */
  goal: string;
}

/** A single, fully-determined per-tick input to the player controller. */
export interface InputCommand {
  /** Caller-supplied frame index (never read from a clock). */
  readonly frame: number;
  /** Desired tile delta X this tick, in {-1, 0, 1}. */
  readonly dx: number;
  /** Desired tile delta Z this tick, in {-1, 0, 1}. */
  readonly dz: number;
  /** True when the player issues a "use/interact" action this tick. */
  readonly action: boolean;
}

/**
 * Deterministically map an @omega/input-core {@link InputFrame} into a grid
 * movement command. Pure function of the frame + the player's current tile:
 *   - W/A/S/D (or arrow) key ids drive a 4-/8-neighbour tile delta,
 *   - `action` is set when a designated interact key (KeyE / Space) is held.
 * The same frame always maps to the same command on every platform/replay.
 */
export function frameToCommand(
  frame: { frame: number; heldKeys: Uint32Array },
  playerTile: Vec2,
): InputCommand {
  // Key ids are the low 32 bits of FNV-1a of the code (see input-core keyId).
  const keyIds = new Set(frame.heldKeys);
  const has = (code: string): boolean => keyIds.has(inputKeyId(code));
  const up = has('KeyW') || has('ArrowUp') || has('Numpad8');
  const down = has('KeyS') || has('ArrowDown') || has('Numpad2');
  const left = has('KeyA') || has('ArrowLeft') || has('Numpad4');
  const right = has('KeyD') || has('ArrowRight') || has('Numpad6');
  const action = has('KeyE') || has('Space') || has('Numpad5');
  void playerTile; // player tile is accepted for API symmetry; not RNG-derived
  const dx = (right ? 1 : 0) - (left ? 1 : 0);
  const dz = (down ? 1 : 0) - (up ? 1 : 0);
  return { frame: frame.frame, dx: clampAxis(dx), dz: clampAxis(dz), action };
}

/** FNV-1a 32-bit key id — mirrors input-core's `keyId` (avoids a cycle). */
function inputKeyId(code: string): number {
  let h = 0x811c9dc5 >>> 0;
  for (let i = 0; i < code.length; i++) {
    h ^= code.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

function clampAxis(v: number): number {
  return v < 0 ? -1 : v > 0 ? 1 : 0;
}

/** Facing tag for a (dx, dz) delta (screen: +z = south/down). */
function facingFor(dx: number, dz: number): Facing {
  if (dx === 0 && dz === 0) return 'idle';
  if (dx < 0 && dz < 0) return 'NW';
  if (dx > 0 && dz < 0) return 'NE';
  if (dx < 0 && dz > 0) return 'SW';
  if (dx > 0 && dz > 0) return 'SE';
  if (dx < 0) return 'W';
  if (dx > 0) return 'E';
  if (dz < 0) return 'N';
  return 'S';
}

/**
 * A deterministic controller for the single player entity. It walks the player
 * one tile per fixed tick along an A* path toward the target tile implied by
 * the current input delta, and keeps the GOAP-style goal flag in sync.
 *
 * Movement is validated against `grid` (the shared live nav grid), so the
 * player can never occupy an impassable tile or a blocker-occupied tile. The
 * authoritative, replay-safe state is the `PlayerComponent` written back into
 * the world every tick; the controller keeps its A* path in memory only.
 */
export class PlayerController {
  readonly entity: number;
  private readonly grid: Grid;
  private readonly baseTile: Vec2;

  constructor(entity: number, grid: Grid, start: PlayerComponent, baseTile: Vec2) {
    this.entity = entity;
    this.grid = grid;
    this.baseTile = nearestFreeTile(grid, baseTile.x, baseTile.y) ?? baseTile;
    void start; // start state already persisted in the world component
  }

  /**
   * Advance the player by one fixed tick from its current component state,
   * applying `cmd`. Returns the (mutated) component for convenience.
   *
   * Determinism: at most one tile of movement; target tile is clamped to the
   * player's surroundings and validated against the grid; the goal flag is a
   * pure function of (hasResource, action, baseTile).
   */
  step(state: PlayerComponent, cmd: InputCommand): PlayerComponent {
    const dx = cmd.dx;
    const dz = cmd.dz;

    // Resolve the instantaneous desired target tile (clamped to bounds).
    const tx = state.tx + dx;
    const tz = state.tz + dz;
    const target = new Vec2(
      Math.min(this.grid.width - 1, Math.max(0, tx)),
      Math.min(this.grid.height - 1, Math.max(0, tz)),
    );

    // Only move when there is input and the target tile is walkable.
    const wantMove = dx !== 0 || dz !== 0;
    if (wantMove && !this.grid.isBlocked(target.x, target.y)) {
      // Two paths keep determinism trivial + grid-locked:
      //   - if the target is the very next tile, step directly (O(1), no A*),
      //   - otherwise compute an A* path and step its first tile.
      if (Math.abs(dx) <= 1 && Math.abs(dz) <= 1) {
        state.tx = target.x;
        state.tz = target.y;
      } else {
        const from = nearestFreeTile(this.grid, state.tx, state.tz) ?? new Vec2(state.tx, state.tz);
        const p = pathBetween(this.grid, from, target, { allowDiagonal: false });
        if (p && p.length >= 2) {
          const step = p[1]!; // p[0] === from
          state.tx = step.x;
          state.tz = step.y;
        }
      }
      state.facing = facingFor(dx, dz);
    } else if (wantMove) {
      // Bumped into a wall: keep facing the attempted direction (no slide).
      state.facing = facingFor(dx, dz);
    }

    // GOAP-style goal flag (same vocabulary as the existing GoapSystem):
    //   - pressing action while NOT carrying a resource arms the 'collect' goal,
    //   - pressing action while carrying arms the 'deliver' goal; when standing
    //     on the base tile it resolves (delivered=1).
    if (cmd.action) {
      if (state.hasResource === 0) {
        state.hasGoal = 1;
        state.goal = 'collect';
      } else {
        state.hasGoal = 1;
        state.goal = 'deliver';
        if (state.tx === this.baseTile.x && state.tz === this.baseTile.y) {
          state.delivered = 1;
          state.hasResource = 0;
          state.hasGoal = 0;
          state.goal = 'idle';
        }
      }
    }

    return state;
  }

  /** Mark the player as having collected a resource (called by interaction). */
  collect(state: PlayerComponent): void {
    state.hasResource = 1;
    state.hasGoal = 0;
    state.goal = 'idle';
  }

  /** The player's current world-space (x, z) centre for rendering. */
  worldPos(state: PlayerComponent): Vec2 {
    return tileToWorld(state.tx, state.tz);
  }
}

/** A fresh player component parked on a starting tile with all flags cleared. */
export function makePlayerComponent(tx: number, tz: number): PlayerComponent {
  return {
    tx,
    tz,
    facing: 'idle',
    hasGoal: 0,
    hasResource: 0,
    delivered: 0,
    goal: 'idle',
  };
}

/**
 * A deterministic player system over an engine-core `World`. Owns the single
 * player entity (store {@link PLAYER_STORE}) and steps it one tile per tick from
 * an injected command. The component store is JSON-serializable, so @omega/replay
 * snapshots it.
 */
export class PlayerSystem {
  private readonly world: World;
  private readonly grid: Grid;
  private readonly baseTile: Vec2;
  private controller: PlayerController | null = null;

  constructor(world: World, grid: Grid, baseTile: Vec2) {
    this.world = world;
    this.grid = grid;
    this.baseTile = baseTile;
  }

  /** Spawn the player at `startTile`. Returns the new entity id. */
  spawnPlayer(startTile: Vec2): number {
    const id = this.world.createEntity();
    const snap = nearestFreeTile(this.grid, startTile.x, startTile.y) ?? startTile;
    const comp = makePlayerComponent(snap.x, snap.y);
    this.world.addComponent<PlayerComponent>(PLAYER_STORE, id, comp);
    this.controller = new PlayerController(id, this.grid, comp, this.baseTile);
    return id;
  }

  /** Step the player entity by one fixed tick using `cmd`. */
  step(cmd: InputCommand): void {
    if (!this.controller) return;
    const comp = this.world.getComponent<PlayerComponent>(PLAYER_STORE, this.controller.entity);
    if (!comp) return;
    this.controller.step(comp, cmd);
    this.world.addComponent<PlayerComponent>(PLAYER_STORE, this.controller.entity, comp);
  }

  /** Observe the player's tile + flags, ascending by entity id. */
  players(): { id: number; tx: number; tz: number; facing: Facing; hasResource: number; delivered: number }[] {
    const out: { id: number; tx: number; tz: number; facing: Facing; hasResource: number; delivered: number }[] = [];
    for (const id of this.world.store<PlayerComponent>(PLAYER_STORE).keys()) {
      const c = this.world.getComponent<PlayerComponent>(PLAYER_STORE, id);
      if (c) out.push({ id, tx: c.tx, tz: c.tz, facing: c.facing, hasResource: c.hasResource, delivered: c.delivered });
    }
    return out;
  }

  /** The player controller (for interaction / crafting to call collect()). */
  getPlayerController(): PlayerController | null {
    return this.controller;
  }
}
