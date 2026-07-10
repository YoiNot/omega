/**
 * apps/web — deterministic navigation glue over @omega/nav-core.
 *
 * Bridges the demo's seeded terrain (`@omega/world-gen`) to the ECS-agnostic
 * grid pathfinder in `@omega/nav-core`. A {@link BooleanGrid} is derived from the
 * terrain's biome map (impassable biomes → blocked tiles), and agents navigate
 * it with `findPath` (A*) or a shared `flowField` (distance field to a goal).
 *
 * Everything here is a PURE function of its inputs (terrain + coordinates), so
 * the same world + start + goal always yields the same path — the determinism
 * contract the vertical slice relies on. No clock, no randomness.
 *
 * Coordinate convention: the terrain heightmap is an NxN grid whose cells map
 * 1:1 onto world units (`tileToWorld` centres a tile at `tile + 0.5`), so a
 * world position `(wx, wz)` lives on tile `(floor(wx), floor(wz))`.
 */

import { Vec2 } from '@omega/engine-math';
import { BooleanGrid, findPath, flowField } from '@omega/nav-core';
import type { Grid, Path, DistanceField, FindPathOptions } from '@omega/nav-core';
import type { Terrain } from '@omega/world-gen';
import { Biome } from '@omega/world-gen';

/** Biome ids that block navigation (deep water + impassable mountain peaks). */
export const IMPASSABLE_BIOMES: ReadonlySet<number> = new Set<number>([
  Biome.Ocean,
  Biome.Mountain,
]);

/**
 * Build a deterministic {@link BooleanGrid} from a terrain's biome map. A tile is
 * blocked when its biome is in {@link IMPASSABLE_BIOMES}. Row-major, matching the
 * terrain's own `biomeIds` layout.
 */
export function buildNavGrid(terrain: Terrain): BooleanGrid {
  const { width, height, biomeIds } = terrain;
  const grid = new BooleanGrid(width, height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const biome = biomeIds[y * width + x]!;
      if (IMPASSABLE_BIOMES.has(biome)) grid.setBlocked(x, y, true);
    }
  }
  return grid;
}

/** World (x, z) position → integer tile coordinate, clamped into grid bounds. */
export function worldToTile(grid: Grid, wx: number, wz: number): Vec2 {
  const tx = Math.min(grid.width - 1, Math.max(0, Math.floor(wx)));
  const ty = Math.min(grid.height - 1, Math.max(0, Math.floor(wz)));
  return new Vec2(tx, ty);
}

/** Tile coordinate → world (x, z) position at the tile centre. */
export function tileToWorld(tx: number, ty: number): Vec2 {
  return new Vec2(tx + 0.5, ty + 0.5);
}

/**
 * Find the nearest FREE tile to `(tx, ty)` by an expanding ring search. Returns
 * the tile itself when already free, or the deterministically-first free tile
 * (scanning by ascending radius, then row-major within the ring), or `null` when
 * the whole grid is blocked. Used to snap an out-of-bounds / blocked spawn or
 * goal onto a walkable tile without breaking determinism.
 */
export function nearestFreeTile(grid: Grid, tx: number, ty: number): Vec2 | null {
  if (!grid.isBlocked(tx, ty)) return new Vec2(tx, ty);
  const maxR = Math.max(grid.width, grid.height);
  for (let r = 1; r <= maxR; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        // Only scan the ring perimeter at this radius.
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const nx = tx + dx;
        const ny = ty + dy;
        if (nx < 0 || ny < 0 || nx >= grid.width || ny >= grid.height) continue;
        if (!grid.isBlocked(nx, ny)) return new Vec2(nx, ny);
      }
    }
  }
  return null;
}

/**
 * Deterministic A* path between two tiles. Returns the tile path (inclusive of
 * start and goal) or `null` when unreachable / blocked. Tie-breaks are fully
 * determined by `@omega/nav-core` (f, then h, then cell index), so identical
 * inputs always yield the identical path.
 */
export function pathBetween(
  grid: Grid,
  start: Vec2,
  goal: Vec2,
  opts: FindPathOptions = {},
): Path | null {
  return findPath(grid, start, goal, opts);
}

/**
 * Shared distance field toward `goal` for group navigation (many agents, one
 * traversal). Returns `null` when the goal tile is blocked / out of bounds.
 */
export function goalFlowField(grid: Grid, goal: Vec2): DistanceField | null {
  return flowField(grid, { x: goal.x, y: goal.y });
}

export type { Grid, Path, DistanceField } from '@omega/nav-core';
export { BooleanGrid } from '@omega/nav-core';
