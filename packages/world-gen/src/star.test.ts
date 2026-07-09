import { describe, it, expect } from 'vitest';
import {
  StarSystemGenerator,
  pickSpectralClass,
  SPECTRAL_CLASSES,
} from './star.js';
import { Rng } from '@omega/engine-core';

describe('star system', () => {
  it('is deterministic for a given seed', () => {
    const a = new StarSystemGenerator(777, { index: 0 }).generate();
    const b = new StarSystemGenerator(777, { index: 0 }).generate();
    expect(a).toEqual(b);
  });

  it('planet count is within [1, 12]', () => {
    for (let seed = 0; seed < 20; seed++) {
      const sys = new StarSystemGenerator(seed, { index: 0 }).generate();
      expect(sys.planets.length).toBeGreaterThanOrEqual(1);
      expect(sys.planets.length).toBeLessThanOrEqual(12);
    }
  });

  it('orbital radii strictly increasing', () => {
    for (let seed = 0; seed < 12; seed++) {
      const sys = new StarSystemGenerator(seed, { index: 0 }).generate();
      expect(sys.orbitalRadii).toHaveLength(sys.planets.length);
      for (let i = 1; i < sys.orbitalRadii.length; i++) {
        expect(sys.orbitalRadii[i]!).toBeGreaterThan(sys.orbitalRadii[i - 1]!);
      }
      // All positive AU values.
      for (const r of sys.orbitalRadii) expect(r).toBeGreaterThan(0);
    }
  });

  it('spectral class is a known code', () => {
    for (let seed = 0; seed < 12; seed++) {
      const sys = new StarSystemGenerator(seed, { index: 0 }).generate();
      expect(SPECTRAL_CLASSES.map((c) => c.code)).toContain(sys.spectralClass);
      expect(sys.tempK).toBeGreaterThan(0);
    }
  });

  it('star name is non-empty', () => {
    const sys = new StarSystemGenerator(55, { index: 0 }).generate();
    expect(sys.starName.length).toBeGreaterThan(0);
  });

  it('pickSpectralClass returns a valid weighted class', () => {
    const rng = new Rng(3);
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      seen.add(pickSpectralClass(rng).code);
    }
    // Should see more than one class across 200 draws (distribution not degenerate).
    expect(seen.size).toBeGreaterThan(1);
  });

  it('id is a stable SYS label', () => {
    const sys = new StarSystemGenerator(1, { index: 41 }).generate();
    expect(sys.id).toBe('SYS-0042');
  });
});
