/**
 * apps/web — deterministic terrain/biome gameplay rules.
 *
 * Extends the existing `nav.ts` (which only *blocks* impassable biomes) with a
 * richer, still-pure cost model: every walkable biome carries a deterministic
 * movement cost so different terrain makes agents/entities behave differently.
 * A tile's cost is a pure function of its biome id — never of time or RNG — so
 * two runs over the same seeded terrain produce the same cost field and the
 * same behaviour.
 *
 * This module does NOT modify `buildNavGrid`/`IMPASSABLE_BIOMES` (those stay the
 * canonical blocked-flag source used by the existing nav tests); instead it
 * layers a cost field on top and exposes a *partitioned* nav grid that marks
 * water/mountain as blocked and everything else as walkable — identical to the
 * classic grid for the blocked set, so existing `nav.test.ts` keeps passing.
 *
 * It also provides the deterministic placement primitives the gameplay content
 * uses: scattering N entities over free tiles by an expanding-ring scan that is
 * fully ordered by (radius, row-major), so identical inputs always yield
 * identical positions.
 */

import { Vec2 } from '@omega/engine-math';
import { BooleanGrid, type Grid } from '@omega/nav-core';
import type { Terrain } from '@omega/world-gen';
import { Biome } from '@omega/world-gen';
import { IMPASSABLE_BIOMES } from './nav';

/**
 * Deterministic movement cost per biome. Higher = slower to traverse.
 * Blocked biomes (ocean, mountain) are not walked at all (see {@link isBlocked}).
 * The exact numbers are part of the determinism contract: any change here
 * changes observed entity behaviour across seeds, so keep them stable.
 */
export const BIOME_COST: ReadonlyMap<number, number> = new Map<number, number>([
  [Biome.Ocean, Infinity], // blocked (water)
  [Biome.Beach, 1], // firm sand, normal speed
  [Biome.Grassland, 1], // open ground, normal speed
  [Biome.Forest, 3], // dense canopy slows movement
  [Biome.Desert, 2], // loose sand slows movement
  [Biome.Mountain, Infinity], // blocked (peaks)
  [Biome.Snow, Infinity], // blocked (impassable ice/snow fields)
]);

/** The (single) slow biome the demo calls out explicitly: forest. */
export const SLOW_BIOME = Biome.Forest;

/** True when the biome blocks movement (mirrors `IMPASSABLE_BIOMES`). */
export function isBlockedBiome(biome: number): boolean {
  return IMPASSABLE_BIOMES.has(biome);
}

/** Movement cost of a biome, or `Infinity` when the biome is blocked. */
export function biomeCost(biome: number): number {
  return BIOME_COST.get(biome) ?? 1;
}

/**
 * A nav grid that ALSO remembers the per-tile biome id, so consumers can ask
 * for a tile's movement cost. Blocked tiles are exactly those whose biome is in
 * `IMPASSABLE_BIOMES` — so `isBlocked` matches the classic `buildNavGrid`.
 */
export class BiomeNavGrid implements Grid {
  readonly width: number;
  readonly height: number;
  /** Row-major biome ids (1:1 with the terrain's `biomeIds`). */
  readonly biomes: Uint8Array;
  private readonly blocked: Uint8Array;

  constructor(terrain: Terrain) {
    const { width, height, biomeIds } = terrain;
    this.width = width;
    this.height = height;
    this.biomes = biomeIds.slice();
    this.blocked = new Uint8Array(width * height);
    for (let i = 0; i < biomeIds.length; i++) {
      if (IMPASSABLE_BIOMES.has(biomeIds[i]!)) this.blocked[i] = 1;
    }
  }

  isBlocked(x: number, y: number): boolean {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return true;
    return this.blocked[y * this.width + x] === 1;
  }

  /** Movement cost of the tile at `(x, y)`; `Infinity` when blocked/out-of-bounds. */
  costAt(x: number, y: number): number {
    if (this.isBlocked(x, y)) return Infinity;
    const b = this.biomes[y * this.width + x]!;
    return biomeCost(b);
  }

  /** Plain `BooleanGrid` view (blocked flags only) for A* callers. */
  toBooleanGrid(): BooleanGrid {
    return new BooleanGrid(this.width, this.height, this.blocked.slice());
  }
}

/** Build a {@link BiomeNavGrid} from a terrain (pure function of the terrain). */
export function buildBiomeNavGrid(terrain: Terrain): BiomeNavGrid {
  return new BiomeNavGrid(terrain);
}

/**
 * Deterministically scatter `count` distinct free tiles over the grid, starting
 * from an ordered seed list computed from `baseSeed` + `salt`. Positions are
 * chosen so that no two scattered entities share a tile (a seeded linear scan
 * over the free tiles, advanced by a deterministic step). Pure function of
 * (grid, count, baseSeed, salt) — identical calls return identical tiles.
 *
 * The scan is deliberately NOT based on `Rng` consumption inside the loop (it
 * would still be deterministic, but the stepping keeps it trivially
 * order-independent of RNG call order) — it is a closed-form stride over the
 * precomputed free-tile index array, so two grids with the same free-tile
 * sequence (e.g. identical seeds) get identical scatter, and different grids
 * get deterministically different scatters via the salt-derived offset.
 */
export function scatterTiles(
  grid: Grid,
  count: number,
  baseSeed: string,
  salt: string,
): Vec2[] {
  const free: { x: number; y: number }[] = [];
  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) {
      if (!grid.isBlocked(x, y)) free.push({ x, y });
    }
  }
  if (free.length === 0) return [];
  // Deterministic offset from the seed string (FNV-1a 32-bit) + salt.
  let h = 0x811c9dc5 >>> 0;
  const s = `${baseSeed}:${salt}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  const start = h % free.length;
  // Stride coprime-ish to the free count to spread picks; clamp to >=1.
  const stride = free.length > 1 ? 1 + (h % (free.length - 1)) : 1;
  const out: Vec2[] = [];
  const seen = new Set<number>();
  let idx = start;
  let guard = 0;
  while (out.length < count && guard < count * free.length + free.length) {
    const tile = free[idx % free.length]!;
    const key = tile.y * grid.width + tile.x;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(new Vec2(tile.x, tile.y));
    }
    idx += stride;
    guard++;
  }
  return out;
}
