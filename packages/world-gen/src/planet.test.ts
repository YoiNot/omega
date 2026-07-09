import { describe, it, expect } from 'vitest';
import { PlanetGenerator, makePlanetName, biomeName, BIOME_COUNT } from './planet.js';
import { Rng } from '@omega/engine-core';

describe('planet', () => {
  it('is deterministic for a given seed', () => {
    const a = new PlanetGenerator(303, { index: 2 }).generate();
    const b = new PlanetGenerator(303, { index: 2 }).generate();
    expect(a).toEqual(b);
  });

  it('name is non-empty', () => {
    const p = new PlanetGenerator(42, { index: 0 }).generate();
    expect(p.name.length).toBeGreaterThan(0);
    expect(p.name.trim()).toBe(p.name);
  });

  it('radius is positive', () => {
    for (let seed = 0; seed < 20; seed++) {
      const p = new PlanetGenerator(seed, { index: 0 }).generate();
      expect(p.radiusKm).toBeGreaterThan(0);
    }
  });

  it('biomeWeights has correct length and sums near 1', () => {
    const p = new PlanetGenerator(17, { index: 1 }).generate();
    expect(p.biomeWeights).toHaveLength(BIOME_COUNT);
    const sum = p.biomeWeights.reduce((a, b) => a + b, 0);
    expect(sum).toBeGreaterThan(0.99);
    expect(sum).toBeLessThanOrEqual(1.0001);
  });

  it('avgTempC is in a plausible range', () => {
    const p = new PlanetGenerator(8, { index: 0 }).generate();
    expect(p.avgTempC).toBeGreaterThanOrEqual(-200);
    expect(p.avgTempC).toBeLessThanOrEqual(120);
  });

  it('id is a stable PLN label', () => {
    const p = new PlanetGenerator(1, { index: 6 }).generate();
    expect(p.id).toBe('PLN-0007');
  });

  it('makePlanetName produces non-empty names', () => {
    const rng = new Rng(5);
    for (let i = 0; i < 50; i++) {
      expect(makePlanetName(rng).length).toBeGreaterThan(0);
    }
  });

  it('biomeName maps ids to labels', () => {
    expect(biomeName(0)).toBe('ocean');
    expect(biomeName(6)).toBe('snow');
    expect(biomeName(99)).toBe('unknown');
  });
});
