/**
 * apps/web — deterministic biome/terrain gameplay-rule tests.
 *
 * Proves the terrain biomes drive deterministic behaviour:
 *  - the biome-aware nav grid blocks exactly the impassable biomes (ocean,
 *    mountain, snow) and matches the canonical `buildNavGrid` blocked set;
 *  - each walkable biome carries a stable movement cost (forest/desert slow);
 *  - the same seed ⇒ identical biome grid + identical cost field;
 *  - `scatterTiles` places N distinct free tiles deterministically (pure
 *    function of seed, no RNG, no clock) and never on a blocked tile.
 *
 * Pure grid math — no DOM, no GL.
 */

import { describe, it, expect } from 'vitest';
import { TerrainGenerator } from '@omega/world-gen';
import { Biome } from '@omega/world-gen';
import { buildNavGrid, IMPASSABLE_BIOMES } from './nav';
import {
  buildBiomeNavGrid,
  biomeCost,
  isBlockedBiome,
  scatterTiles,
  BIOME_COST,
  SLOW_BIOME,
} from './biome';

const SEED = 'omega-demo';
const SIZE = 40;

function terrain(seed = SEED) {
  return new TerrainGenerator(seed, { size: SIZE }).generate();
}

describe('apps/web biome rules — blocked set', () => {
  it('biome nav grid blocks exactly the impassable biomes', () => {
    const t = terrain();
    const bg = buildNavGrid(t);
    const bng = buildBiomeNavGrid(t);
    // The two grids agree on every tile's blocked-ness.
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        expect(bng.isBlocked(x, y)).toBe(bg.isBlocked(x, y));
      }
    }
  });

  it('only ocean/mountain/snow are blocked; others are walkable', () => {
    for (const b of [
      Biome.Ocean,
      Biome.Mountain,
      Biome.Snow,
      Biome.Beach,
      Biome.Grassland,
      Biome.Forest,
      Biome.Desert,
    ]) {
      expect(isBlockedBiome(b)).toBe(IMPASSABLE_BIOMES.has(b));
    }
  });

  it('same seed ⇒ identical biome grid + identical cost field', () => {
    const a = buildBiomeNavGrid(terrain());
    const b = buildBiomeNavGrid(terrain());
    expect(Array.from(a.biomes)).toEqual(Array.from(b.biomes));
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        expect(a.costAt(x, y)).toBe(b.costAt(x, y));
      }
    }
  });
});

describe('apps/web biome rules — deterministic movement costs', () => {
  it('forest and desert are slower than grassland/beach; costs are stable', () => {
    expect(biomeCost(Biome.Forest)).toBeGreaterThan(biomeCost(Biome.Grassland));
    expect(biomeCost(Biome.Desert)).toBeGreaterThan(biomeCost(Biome.Grassland));
    expect(biomeCost(Biome.Beach)).toBe(1);
    expect(biomeCost(Biome.Grassland)).toBe(1);
    // Costs are part of the determinism contract — single source of truth.
    expect(BIOME_COST.get(SLOW_BIOME)).toBeGreaterThan(1);
  });

  it('blocked biomes have infinite cost', () => {
    expect(biomeCost(Biome.Ocean)).toBe(Infinity);
    expect(biomeCost(Biome.Mountain)).toBe(Infinity);
    expect(biomeCost(Biome.Snow)).toBe(Infinity);
  });
});

describe('apps/web biome rules — deterministic scatter placement', () => {
  it('same seed + salt ⇒ identical placement; never on a blocked tile', () => {
    const grid = buildNavGrid(terrain());
    const a = scatterTiles(grid, 6, SEED, 'resource');
    const b = scatterTiles(grid, 6, SEED, 'resource');
    expect(a.map((v) => [v.x, v.y])).toEqual(b.map((v) => [v.x, v.y]));
    for (const v of a) expect(grid.isBlocked(v.x, v.y)).toBe(false);
  });

  it('different salt ⇒ (generally) different placement, still deterministic', () => {
    const grid = buildNavGrid(terrain());
    const a = scatterTiles(grid, 6, SEED, 'resource');
    const c = scatterTiles(grid, 6, SEED, 'blocker');
    expect(c.map((v) => [v.x, v.y])).toEqual(scatterTiles(grid, 6, SEED, 'blocker').map((v) => [v.x, v.y]));
    expect(a.map((v) => [v.x, v.y])).not.toEqual(c.map((v) => [v.x, v.y]));
  });

  it('all scattered tiles are distinct', () => {
    const grid = buildNavGrid(terrain());
    const tiles = scatterTiles(grid, 8, SEED, 'wanderer');
    const keys = new Set(tiles.map((v) => `${v.x},${v.y}`));
    expect(keys.size).toBe(tiles.length);
  });
});
