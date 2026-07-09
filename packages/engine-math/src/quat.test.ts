import { describe, it, expect } from 'vitest';
import { Quat } from './quat.js';
import { Vec3 } from './vec.js';
import { HALF_PI, TAU } from './math.js';

describe('Quat', () => {
  it('identity', () => {
    expect(Quat.identity()).toEqual(new Quat(0, 0, 0, 1));
  });

  it('normalize', () => {
    const q = new Quat(1, 1, 1, 1).normalize();
    expect(q.length()).toBeCloseTo(1, 10);
  });

  it('axis-angle rotates a vector 90deg about Z', () => {
    const q = Quat.fromAxisAngle(new Vec3(0, 0, 1), HALF_PI);
    const r = q.rotate(new Vec3(1, 0, 0));
    expect(r.x).toBeCloseTo(0, 9);
    expect(r.y).toBeCloseTo(1, 9);
    expect(r.z).toBeCloseTo(0, 9);
  });

  it('fromEuler then toEuler round-trips for a simple tilt', () => {
    const q = Quat.fromEuler(0, 0, HALF_PI);
    const e = q.toEuler();
    expect(e.z).toBeCloseTo(HALF_PI, 8);
  });

  it('multiply composes rotations', () => {
    const qx = Quat.fromAxisAngle(new Vec3(1, 0, 0), HALF_PI);
    const qy = Quat.fromAxisAngle(new Vec3(0, 1, 0), HALF_PI);
    const q = qx.multiply(qy); // q = Qx * Qy  => apply Qy first, then Qx
    // Qy (about Y) sends +X -> -Z; Qx (about X) sends -Z -> +Y.
    const r = q.rotate(new Vec3(1, 0, 0));
    expect(r.y).toBeCloseTo(1, 8);
    expect(r.x).toBeCloseTo(0, 8);
    expect(r.z).toBeCloseTo(0, 8);
  });

  it('slerp endpoints', () => {
    const a = Quat.identity();
    const b = Quat.fromAxisAngle(new Vec3(0, 0, 1), TAU / 2);
    const m0 = Quat.slerp(a, b, 0);
    const m1 = Quat.slerp(a, b, 1);
    expect(m0.x).toBeCloseTo(0, 9); expect(m0.w).toBeCloseTo(1, 9);
    expect(m1.x).toBeCloseTo(b.x, 9);
  });

  it('slerp midpoint has unit length', () => {
    const a = Quat.fromAxisAngle(new Vec3(0, 1, 0), 0.3);
    const b = Quat.fromAxisAngle(new Vec3(0, 1, 0), 1.2);
    const m = Quat.slerp(a, b, 0.5);
    expect(m.length()).toBeCloseTo(1, 9);
  });
});
