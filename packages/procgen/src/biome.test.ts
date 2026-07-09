import { describe, it, expect } from 'vitest';
import { classify, BIOME_TABLE, Biome, type BiomeId } from './biome.js';

describe('classify', () => {
  it('deep ocean for low height', () => {
    expect(classify(0.5, 0.5, 0.1, 0.5)).toBe(Biome.Ocean);
    expect(classify(0.2, 0.8, 0.29, 0.9)).toBe(Biome.Ocean);
  });

  it('beach just above water', () => {
    expect(classify(0.5, 0.5, 0.33, 0.5)).toBe(Biome.Beach);
  });

  it('desert for dry mid elevation', () => {
    expect(classify(0.5, 0.5, 0.6, 0.1)).toBe(Biome.Desert);
  });

  it('forest for wet warm mid elevation', () => {
    expect(classify(0.5, 0.5, 0.6, 0.9)).toBe(Biome.Forest);
  });

  it('grassland for temperate mid elevation', () => {
    expect(classify(0.5, 0.5, 0.6, 0.5)).toBe(Biome.Grassland);
  });

  it('snow at the cold pole (y=1)', () => {
    expect(classify(0.5, 1.0, 0.6, 0.5)).toBe(Biome.Snow);
    expect(classify(0.0, 1.0, 0.5, 0.9)).toBe(Biome.Snow);
  });

  it('mountain at high elevation in warm band', () => {
    expect(classify(0.5, 0.5, 0.9, 0.5)).toBe(Biome.Mountain);
  });

  it('snow at high elevation in cold band', () => {
    expect(classify(0.5, 0.95, 0.9, 0.5)).toBe(Biome.Snow);
  });

  it('height monotonic-ish: increasing height ocean -> beach -> land', () => {
    const moist = 0.5;
    const y = 0.5;
    expect(classify(0.5, y, 0.2, moist)).toBe(Biome.Ocean);
    expect(classify(0.5, y, 0.33, moist)).toBe(Biome.Beach);
    expect(classify(0.5, y, 0.5, moist)).toBe(Biome.Grassland);
  });

  it('is a pure function (no randomness)', () => {
    const args: [number, number, number, number] = [0.3, 0.7, 0.55, 0.42];
    expect(classify(...args)).toBe(classify(...args));
    expect(classify(...args)).toBe(classify(...args));
  });

  it('clamps out-of-range inputs to valid biomes', () => {
    // height way above 1 -> high elevation branch
    expect(classify(0.5, 0.5, 5, 0.5)).toBe(Biome.Mountain);
    // height way below 0 -> ocean
    expect(classify(0.5, 0.5, -5, 0.5)).toBe(Biome.Ocean);
    // moisture out of range still classified
    const r = classify(0.5, 0.5, 0.6, 50);
    expect(typeof r).toBe('number');
  });

  it('BIOME_TABLE covers every BiomeId and only valid ids', () => {
    const ids = Object.keys(BIOME_TABLE).map(Number) as BiomeId[];
    expect(ids).toContain(Biome.Ocean);
    expect(ids).toContain(Biome.Snow);
    expect(ids.length).toBeGreaterThanOrEqual(7);
    for (const info of Object.values(BIOME_TABLE)) {
      expect(typeof info.name).toBe('string');
      expect(typeof info.vegetated).toBe('boolean');
    }
  });
});
