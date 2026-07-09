import { describe, it, expect } from 'vitest';
import { Mat4 } from './mat4.js';
import { Vec3 } from './vec.js';
import { DEG2RAD } from './math.js';

describe('Mat4', () => {
  it('identity is identity', () => {
    const m = new Mat4();
    expect(Array.from(m.m)).toEqual([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1].map(Number));
  });

  it('translate then transform point', () => {
    const m = Mat4.translation(new Mat4(), 1, 2, 3);
    const p = m.transformPoint(new Vec3(0, 0, 0));
    expect([p.x, p.y, p.z]).toEqual([1, 2, 3]);
  });

  it('scaling', () => {
    const m = Mat4.scaling(new Mat4(), 2, 3, 4);
    const p = m.transformPoint(new Vec3(1, 1, 1));
    expect([p.x, p.y, p.z]).toEqual([2, 3, 4]);
  });

  it('multiplication is associative-ish and maps correctly', () => {
    const t = Mat4.translation(new Mat4(), 10, 0, 0);
    const s = Mat4.scaling(new Mat4(), 2, 2, 2);
    const t2 = new Mat4().multiply(s).multiply(t); // M = S * T  (applied T first then S)
    const p = t2.transformPoint(new Vec3(1, 1, 1));
    // T(1,1,1) = (11,1,1); S => (22,2,2)
    expect([p.x, p.y, p.z]).toEqual([22, 2, 2]);
  });

  it('perspective projects a point in front of camera', () => {
    const p = Mat4.perspective(new Mat4(), 90 * DEG2RAD, 1, 0.1, 100);
    const clip = p.transformPoint(new Vec3(0, 0, -1));
    // For our perspective matrix, clip.w = -z of the input point.
    const w = -1; // input z = -1
    expect(clip.z / w).toBeLessThan(1); // NDC z within (-1, 1)
    expect(clip.z / w).toBeGreaterThan(-1);
  });

  it('lookAt builds a right-handed basis', () => {
    const v = Mat4.lookAt(new Mat4(), new Vec3(0, 0, 5), new Vec3(0, 0, 0), new Vec3(0, 1, 0));
    const p = v.transformPoint(new Vec3(0, 0, 5));
    // eye should map to origin in view space
    expect(p.x).toBeCloseTo(0, 9);
    expect(p.y).toBeCloseTo(0, 9);
    expect(p.z).toBeCloseTo(0, 9);
  });

  it('clone is independent', () => {
    const a = Mat4.scaling(new Mat4(), 2, 2, 2);
    const b = a.clone();
    b.m[0] = 99;
    expect(a.m[0]).toBe(2);
  });
});
