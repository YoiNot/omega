/**
 * apps/web — deterministic construction system (Roadmap §15, part 4/4).
 *
 * Lets the player place STRUCTURES (derived from crafted items: wall, beacon)
 * onto the terrain. Placement is validated against TWO deterministic rules:
 *
 *   1. BIOME rule  — a structure may only be placed on a permitted biome
 *                    (e.g. walls on firm ground, never on ocean/mountain).
 *   2. COLLISION rule — the target tile must be free of (a) impassable nav
 *                    tiles, (b) other placed structures, and (c) resource nodes
 *                    already on the map. This reuses the SAME blocked-set logic
 *                    the nav/AI systems use, so a placed wall becomes an obstacle
 *                    the GOAP agents + wanderers route around — emergence, not a
 *                    separate collision world.
 *
 * Crucially, placed structures do NOT mutate the physics world (`PhysicsBody`).
 * They live in their own engine-core `StructureStore` that the @omega/replay
 * `Recorder` snapshots in addition to the existing stores. This keeps the
 * physics/fixed-tick simulation byte-identical to the pre-§15 `runHeadless`
 * result (the determinism oracle), while still being fully record/replay-safe.
 *
 * Determinism contract: given the same terrain + same biome grid + same existing
 * placements + same (tile, item) request, `tryPlace` always returns the same
 * outcome. No RNG, no clock, no id-derived tie-breaks.
 */

import type { World } from '@omega/engine-core';
import { Vec2 } from '@omega/engine-math';
import type { Grid } from '@omega/nav-core';
import { Biome } from '@omega/world-gen';
import { ITEM } from './crafting';

/** Engine-core store name for placed structures. */
export const STRUCTURE_STORE = 'StructureC';

/** A placed structure instance. */
export interface StructureC {
  tx: number;
  tz: number;
  /** The item id it was built from ('wall' | 'beacon'). */
  kind: string;
}

/** Biome permission per structure kind (mirrors the demo's biome model). */
const ALLOWED_BIOME: Record<string, ReadonlySet<number>> = {
  [ITEM.WALL]: new Set<number>([
    Biome.Beach,
    Biome.Grassland,
    Biome.Forest,
    Biome.Desert,
  ]),
  [ITEM.BEACON]: new Set<number>([
    Biome.Beach,
    Biome.Grassland,
    Biome.Forest,
    Biome.Desert,
  ]),
};

/** Why a placement was rejected (empty string = accepted). */
export type PlaceReject =
  | ''
  | 'out-of-bounds'
  | 'impassable-nav'
  | 'blocked-biome'
  | 'occupied-by-structure'
  | 'occupied-by-resource'
  | 'unknown-structure';

export interface PlaceResult {
  ok: boolean;
  reject: PlaceReject;
  /** The structure id when `ok` (entity id), else -1. */
  id: number;
}

/**
 * A deterministic construction system over an engine-core `World`. It consults a
 * `biomeAt(tx, tz)` callback (supplied by the caller from the seeded terrain) and
 * a set of occupancy probes so it can stay ECS-agnostic about where resources/
 * other movers live.
 */
export class ConstructionSystem {
  private readonly world: World;
  private readonly grid: Grid;
  private readonly biomeAt: (tx: number, tz: number) => number;

  constructor(
    world: World,
    grid: Grid,
    biomeAt: (tx: number, tz: number) => number,
  ) {
    this.world = world;
    this.grid = grid;
    this.biomeAt = biomeAt;
  }

  /** Is the tile inside the nav grid bounds? */
  inBounds(tx: number, tz: number): boolean {
    return tx >= 0 && tz >= 0 && tx < this.grid.width && tz < this.grid.height;
  }

  /** Is the tile free of other placed structures? */
  structureAt(tx: number, tz: number): StructureC | undefined {
    for (const id of this.world.store<StructureC>(STRUCTURE_STORE).keys()) {
      const c = this.world.getComponent<StructureC>(STRUCTURE_STORE, id);
      if (c && c.tx === tx && c.tz === tz) return c;
    }
    return undefined;
  }

  /**
   * Validate a placement request WITHOUT committing it. Pure function of the
   * inputs + current world state. Returns the (non-mutating) rejection reason.
   */
  validate(
    tx: number,
    tz: number,
    kind: string,
    occupiedResourceTiles: readonly Vec2[],
  ): PlaceReject {
    if (!this.inBounds(tx, tz)) return 'out-of-bounds';
    if (this.grid.isBlocked(tx, tz)) return 'impassable-nav';
    const allowed = ALLOWED_BIOME[kind];
    if (!allowed) return 'unknown-structure';
    if (!allowed.has(this.biomeAt(tx, tz))) return 'blocked-biome';
    if (this.structureAt(tx, tz)) return 'occupied-by-structure';
    for (const r of occupiedResourceTiles) {
      if (r.x === tx && r.y === tz) return 'occupied-by-resource';
    }
    return '';
  }

  /**
   * Attempt to place a structure. Deterministic: validate first, then (on
   * success) create the entity + component and mark the nav tile blocked via the
   * provided `markBlocked` callback so movers re-route around it.
   *
   * @param markBlocked callback that flips the live nav grid (e.g. LiveGrid.block).
   */
  tryPlace(
    tx: number,
    tz: number,
    kind: string,
    occupiedResourceTiles: readonly Vec2[],
    markBlocked?: (tx: number, tz: number) => void,
  ): PlaceResult {
    const reject = this.validate(tx, tz, kind, occupiedResourceTiles);
    if (reject !== '') return { ok: false, reject, id: -1 };
    const id = this.world.createEntity();
    const c: StructureC = { tx, tz, kind };
    this.world.addComponent<StructureC>(STRUCTURE_STORE, id, c);
    // A placed wall/beacon becomes a real obstacle for the nav grid.
    markBlocked?.(tx, tz);
    return { ok: true, reject: '', id };
  }

  /** Observable placed structures, ascending by entity id. */
  structures(): { id: number; tx: number; tz: number; kind: string }[] {
    const out: { id: number; tx: number; tz: number; kind: string }[] = [];
    for (const id of this.world.store<StructureC>(STRUCTURE_STORE).keys()) {
      const c = this.world.getComponent<StructureC>(STRUCTURE_STORE, id);
      if (c) out.push({ id, tx: c.tx, tz: c.tz, kind: c.kind });
    }
    return out;
  }
}
