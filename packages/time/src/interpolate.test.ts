import { describe, it, expect } from 'vitest';
import { Vec3 } from '@omega/engine-math';
import { lerpScalar, lerpVec3, lerpState } from './interpolate.js';

describe('interpolate', () => {
  it('lerpScalar hits the midpoint', () => {
    expect(lerpScalar(0, 10, 0.5)).toBe(5);
    expect(lerpScalar(2, 8, 0.25)).toBe(3.5);
  });

  it('lerpScalar clamps alpha to [0, 1]', () => {
    expect(lerpScalar(0, 10, -1)).toBe(0);
    expect(lerpScalar(0, 10, 2)).toBe(10);
    expect(lerpScalar(0, 10, 0)).toBe(0);
    expect(lerpScalar(0, 10, 1)).toBe(10);
  });

  it('lerpVec3 is correct and returns a new Vec3', () => {
    const a = new Vec3(0, 0, 0);
    const b = new Vec3(2, 4, 6);
    const mid = lerpVec3(a, b, 0.5);
    expect(mid).toEqual(new Vec3(1, 2, 3));
    expect(mid).not.toBe(a);
    expect(mid).not.toBe(b);
    // endpoints unchanged
    expect(a).toEqual(new Vec3(0, 0, 0));
    expect(b).toEqual(new Vec3(2, 4, 6));
  });

  it('lerpVec3 clamps alpha to [0, 1]', () => {
    const a = new Vec3(0, 0, 0);
    const b = new Vec3(2, 4, 6);
    expect(lerpVec3(a, b, -1)).toEqual(new Vec3(0, 0, 0));
    expect(lerpVec3(a, b, 2)).toEqual(new Vec3(2, 4, 6));
  });

  it('lerpState dispatches scalar vs Vec3', () => {
    expect(lerpState(0, 10, 0.5)).toBe(5);
    expect(lerpState(new Vec3(0, 0, 0), new Vec3(2, 4, 6), 0.5)).toEqual(new Vec3(1, 2, 3));
  });

  it('lerpState clamps alpha for both kinds', () => {
    expect(lerpState(0, 10, -0.3)).toBe(0);
    expect(lerpState(0, 10, 1.3)).toBe(10);
    expect(lerpState(new Vec3(0, 0, 0), new Vec3(2, 4, 6), 3)).toEqual(new Vec3(2, 4, 6));
  });

  it('lerpState rejects mismatched endpoint types', () => {
    expect(() => lerpState(1 as never, new Vec3() as never, 0.5)).toThrow(TypeError);
  });
});
