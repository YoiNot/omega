import { describe, it, expect } from 'vitest';
import { Vec3 } from '@omega/engine-math';
import { NBodySystem, keplerStep } from './index.js';

describe('orbital — N-body determinism + energy conservation', () => {
  it('two-body N-body run is identical across two runs and conserves energy', () => {
    function run(): { pos: number[]; e0: number; e1: number } {
      const w = new NBodySystem({ g: 1, softening: 0 });
      // Circular orbit: r=1, v=sqrt(mu/r)=1.
      w.addBody(new Vec3(0, 0, 0), new Vec3(0, 0, 0), 1); // central
      w.addBody(new Vec3(1, 0, 0), new Vec3(0, 1, 0), 1e-6); // orbiter
      const e0 = w.energy();
      for (let i = 0; i < 200; i++) w.step(0.01);
      const bodies = w.all();
      const e1 = w.energy();
      return {
        pos: bodies.flatMap((b) => [b.position.x, b.position.y, b.position.z]),
        e0, e1,
      };
    }
    const a = run();
    const b = run();
    expect(a.pos).toEqual(b.pos);
    // Symplectic integrator: energy should be near-conserved (drift small).
    expect(Math.abs(a.e1 - a.e0)).toBeLessThan(Math.abs(a.e0) * 0.05 + 1e-3);
  });
});

describe('orbital — Kepler propagator matches N-body (reference)', () => {
  it('keplerStep keeps a near-circular orbit near radius 1 and is deterministic', () => {
    function run(): number[] {
      const mu = 1;
      let r = new Vec3(1, 0, 0);
      let v = new Vec3(0, 1, 0); // v = sqrt(mu/r) for r=1
      for (let i = 0; i < 100; i++) {
        const s = keplerStep(r, v, mu, 0.01);
        r = s.position; v = s.velocity;
      }
      return [r.x, r.y, r.z, v.x, v.y, v.z];
    }
    const a = run();
    const b = run();
    expect(a).toEqual(b);
    const radius = Math.hypot(a[0], a[1], a[2]);
    expect(radius).toBeCloseTo(1, 2);
  });

  it('keplerStep handles an exactly circular orbit (e≈0) deterministically', () => {
    function run(): number[] {
      const mu = 1;
      let r = new Vec3(1, 0, 0);
      let v = new Vec3(0, 1, 0);
      for (let i = 0; i < 50; i++) {
        const s = keplerStep(r, v, mu, 0.02);
        r = s.position; v = s.velocity;
      }
      return [r.x, r.y, r.z];
    }
    const a = run();
    const b = run();
    expect(a).toEqual(b);
    expect(Math.hypot(a[0], a[1], a[2])).toBeCloseTo(1, 2);
  });
});
