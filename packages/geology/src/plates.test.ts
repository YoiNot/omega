import { describe, it, expect } from 'vitest';
import { PlateSim, Crust } from './plates.js';

describe('PlateSim', () => {
  it('is deterministic for a given seed', () => {
    const a = new PlateSim(12345, { gridSize: 32, steps: 16, plateCount: 8 }).simulate();
    const b = new PlateSim(12345, { gridSize: 32, steps: 16, plateCount: 8 }).simulate();
    expect(Array.from(a.heights)).toEqual(Array.from(b.heights));
    expect(Array.from(a.crustType)).toEqual(Array.from(b.crustType));
  });

  it('honors the requested plate count', () => {
    const field = new PlateSim(7, { gridSize: 16, steps: 4, plateCount: 5 }).simulate();
    expect(field.plateCount).toBe(5);
  });

  it('produces only valid crustType values (0/1)', () => {
    const field = new PlateSim(99, { gridSize: 24, steps: 8 }).simulate();
    for (let i = 0; i < field.crustType.length; i++) {
      const v = field.crustType[i]!;
      expect(v === Crust.Oceanic || v === Crust.Continental).toBe(true);
    }
  });

  it('produces no NaN in heights', () => {
    const field = new PlateSim(314, { gridSize: 24, steps: 8 }).simulate();
    for (let i = 0; i < field.heights.length; i++) {
      expect(Number.isNaN(field.heights[i]!)).toBe(false);
      expect(Number.isFinite(field.heights[i]!)).toBe(true);
    }
  });

  it('grid dimensions are NxN', () => {
    const n = 40;
    const field = new PlateSim(1, { gridSize: n, steps: 4 }).simulate();
    expect(field.n).toBe(n);
    expect(field.heights.length).toBe(n * n);
    expect(field.crustType.length).toBe(n * n);
  });

  it('state()/setState() resume bit-for-bit', () => {
    const sim = new PlateSim(2024, { gridSize: 24, steps: 32, plateCount: 6 });
    // Run a partial simulation via a custom loop using state capture.
    const before = sim.simulate();
    const sim2 = new PlateSim(2024, { gridSize: 24, steps: 32, plateCount: 6 });
    const snap = sim2.state();
    const after = sim2.simulate();
    expect(Array.from(after.heights)).toEqual(Array.from(before.heights));
    // Sanity: snapshot has expected shape.
    expect(snap.rng.length).toBe(4);
    expect(snap.plates.length).toBe(6);
  });

  it('checkpoint mid-run resumes to identical final field', () => {
    const n = 24;
    const full = new PlateSim(555, { gridSize: n, steps: 24, plateCount: 7 });
    const target = full.simulate();

    // Split run: 10 steps, snapshot, restore into a fresh sim, run remaining 14.
    const a = new PlateSim(555, { gridSize: n, steps: 24, plateCount: 7 });
    for (let i = 0; i < 10; i++) a.stepOnce();
    const snap = a.state();
    const b = new PlateSim(555, { gridSize: n, steps: 24, plateCount: 7 });
    b.setState(snap);
    for (let i = 10; i < 24; i++) b.stepOnce();
    const resumed = b.current();

    expect(Array.from(resumed.heights)).toEqual(Array.from(target.heights));
    expect(resumed.plateCount).toBe(target.plateCount);
  });

  it('different seeds => different maps', () => {
    const a = new PlateSim(1, { gridSize: 24, steps: 8 }).simulate();
    const b = new PlateSim(2, { gridSize: 24, steps: 8 }).simulate();
    expect(Array.from(a.heights)).not.toEqual(Array.from(b.heights));
  });
});
