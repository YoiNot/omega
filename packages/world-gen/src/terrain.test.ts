import { describe, it, expect } from 'vitest';
import { TerrainGenerator, Biome, BIOME_COUNT } from './terrain.js';

describe('terrain', () => {
  it('is deterministic for a given seed', () => {
    const a = new TerrainGenerator(2024, { size: 32 }).generate();
    const b = new TerrainGenerator(2024, { size: 32 }).generate();
    expect(Array.from(a.heights)).toEqual(Array.from(b.heights));
    expect(Array.from(a.biomeIds)).toEqual(Array.from(b.biomeIds));
  });

  it('heights stay within [min, max]', () => {
    const t = new TerrainGenerator(99, { size: 48 }).generate();
    for (let i = 0; i < t.heights.length; i++) {
      expect(t.heights[i]!).toBeGreaterThanOrEqual(t.minHeight);
      expect(t.heights[i]!).toBeLessThanOrEqual(t.maxHeight);
    }
  });

  it('biomeIds are valid and within known set', () => {
    const t = new TerrainGenerator(7, { size: 40 }).generate();
    const seen = new Set<number>();
    for (let i = 0; i < t.biomeIds.length; i++) {
      const id = t.biomeIds[i]!;
      expect(id).toBeGreaterThanOrEqual(0);
      expect(id).toBeLessThan(BIOME_COUNT);
      seen.add(id);
    }
    // A plausible world should contain ocean and at least one land biome.
    expect(seen.has(Biome.Ocean)).toBe(true);
    expect(seen.size).toBeGreaterThan(1);
  });

  it('sizes are correct (NxN)', () => {
    const n = 56;
    const t = new TerrainGenerator(5, { size: n }).generate();
    expect(t.width).toBe(n);
    expect(t.height).toBe(n);
    expect(t.heights.length).toBe(n * n);
    expect(t.biomeIds.length).toBe(n * n);
    expect(t.moisture.length).toBe(n * n);
    expect(t.temperature.length).toBe(n * n);
  });

  it('moisture and temperature are normalized', () => {
    const t = new TerrainGenerator(11, { size: 32 }).generate();
    for (let i = 0; i < t.moisture.length; i++) {
      expect(t.moisture[i]!).toBeGreaterThanOrEqual(0);
      expect(t.moisture[i]!).toBeLessThanOrEqual(1);
      expect(t.temperature[i]!).toBeGreaterThanOrEqual(0);
      expect(t.temperature[i]!).toBeLessThanOrEqual(1);
    }
  });

  it('different seeds => different maps', () => {
    const a = new TerrainGenerator(1, { size: 24 }).generate();
    const b = new TerrainGenerator(2, { size: 24 }).generate();
    expect(Array.from(a.heights)).not.toEqual(Array.from(b.heights));
  });
});
