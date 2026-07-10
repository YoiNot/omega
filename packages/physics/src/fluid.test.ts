import { describe, it, expect } from 'vitest';
import { Vec3 } from '@omega/engine-math';
import { FluidWorld, fillBlock } from './index.js';

describe('fluid (SPH-lite) — determinism + settling', () => {
  it('identical particle field + parameters => identical evolution', () => {
    function run(): number[] {
      const w = new FluidWorld({
        gravity: new Vec3(0, -9.81, 0),
        bounds: { min: new Vec3(-2, 0, -2), max: new Vec3(2, 5, 2) },
        smoothingRadius: 0.5,
        restDensity: 1,
        stiffness: 50,
        viscosity: 10,
        mass: 1,
      });
      fillBlock(w, new Vec3(-1, 3, -1), new Vec3(1, 4, 1), 0.3);
      for (let i = 0; i < 40; i++) w.step(1 / 60);
      return w.all().flatMap((p) => [p.position.x, p.position.y, p.position.z]);
    }
    const a = run();
    const b = run();
    expect(a).toEqual(b);
  });

  it('a block of fluid settles downward (no upward runaway) and respects walls', () => {
    const w = new FluidWorld({
      gravity: new Vec3(0, -9.81, 0),
      bounds: { min: new Vec3(-2, 0, -2), max: new Vec3(2, 6, 2) },
      smoothingRadius: 0.5,
      restDensity: 1,
      stiffness: 50,
      viscosity: 10,
      mass: 1,
    });
    fillBlock(w, new Vec3(-1, 3, -1), new Vec3(1, 4, 1), 0.3);
    const y0 = w.all().reduce((s, p) => s + p.position.y, 0) / w.count;
    for (let i = 0; i < 60; i++) w.step(1 / 60);
    const y1 = w.all().reduce((s, p) => s + p.position.y, 0) / w.count;
    expect(y1).toBeLessThan(y0);
    for (const p of w.all()) {
      expect(p.position.x).toBeGreaterThanOrEqual(-2 - 1e-6);
      expect(p.position.x).toBeLessThanOrEqual(2 + 1e-6);
      expect(p.position.y).toBeGreaterThanOrEqual(0 - 1e-6);
    }
  });
});
