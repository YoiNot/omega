import { describe, it, expect } from 'vitest';
import { GalaxyGenerator, makeGalaxyName } from './galaxy.js';
import { Rng } from '@omega/engine-core';

describe('galaxy', () => {
  it('is deterministic for a given seed', () => {
    const a = new GalaxyGenerator(9001, { systemCount: 32 }).generate();
    const b = new GalaxyGenerator(9001, { systemCount: 32 }).generate();
    expect(a).toEqual(b);
  });

  it('places star systems (count > 0)', () => {
    const g = new GalaxyGenerator(3, { systemCount: 64 }).generate();
    expect(g.starSystems.length).toBeGreaterThan(0);
    expect(g.placements.length).toBe(g.starSystems.length);
  });

  it('armCount is respected and placements reference systems', () => {
    const g = new GalaxyGenerator(4, { systemCount: 50, armCount: 3 }).generate();
    expect(g.armCount).toBe(3);
    // Every placement references a real system id.
    const ids = new Set(g.starSystems.map((s) => s.id));
    for (const p of g.placements) {
      expect(ids.has(p.systemId)).toBe(true);
      expect(p.arm).toBeGreaterThanOrEqual(0);
      expect(p.arm).toBeLessThan(3);
      expect(p.radius).toBeGreaterThanOrEqual(0);
      expect(p.radius).toBeLessThanOrEqual(1);
    }
  });

  it('placements lie within the normalized plane', () => {
    const g = new GalaxyGenerator(6, { systemCount: 80 }).generate();
    for (const p of g.placements) {
      expect(p.x).toBeGreaterThanOrEqual(-1.0001);
      expect(p.x).toBeLessThanOrEqual(1.0001);
      expect(p.y).toBeGreaterThanOrEqual(-1.0001);
      expect(p.y).toBeLessThanOrEqual(1.0001);
    }
  });

  it('name is non-empty', () => {
    const g = new GalaxyGenerator(7, { systemCount: 16 }).generate();
    expect(g.name.length).toBeGreaterThan(0);
  });

  it('id is a stable GLX label', () => {
    const g = new GalaxyGenerator(1, { systemCount: 8, index: 0 }).generate();
    expect(g.id).toBe('GLX-0001');
  });

  it('makeGalaxyName produces non-empty names', () => {
    const rng = new Rng(9);
    for (let i = 0; i < 50; i++) expect(makeGalaxyName(rng).length).toBeGreaterThan(0);
  });

  it('different seeds => different galaxy', () => {
    const a = new GalaxyGenerator(1, { systemCount: 16 }).generate();
    const b = new GalaxyGenerator(2, { systemCount: 16 }).generate();
    expect(a.name).not.toEqual(b.name);
  });
});
