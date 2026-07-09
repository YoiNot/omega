import { describe, it, expect } from 'vitest';
import {
  clamp, clamp01, lerp, invLerp, smoothstep, smootherstep, bilerp, fract,
  wrapAngle, moveToward, ipow, sign, DEG2RAD, RAD2DEG,
} from './math.js';

describe('math scalars', () => {
  it('clamps', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(11, 0, 10)).toBe(10);
    expect(clamp01(-3)).toBe(0);
    expect(clamp01(3)).toBe(1);
    expect(clamp01(0.4)).toBe(0.4);
  });

  it('lerp / invLerp round-trip', () => {
    expect(lerp(0, 10, 0.5)).toBe(5);
    expect(invLerp(0, 10, 5)).toBe(0.5);
    expect(invLerp(0, 10, 10)).toBe(1);
    expect(invLerp(2, 2, 5)).toBe(0); // divide-by-zero guard
  });

  it('smoothstep boundaries and monotonic', () => {
    expect(smoothstep(0, 1, 0)).toBeCloseTo(0, 10);
    expect(smoothstep(0, 1, 1)).toBeCloseTo(1, 10);
    expect(smoothstep(0, 1, 0.5)).toBeCloseTo(0.5, 10);
    const a = smoothstep(0, 1, 0.25), b = smoothstep(0, 1, 0.5), c = smoothstep(0, 1, 0.75);
    expect(a).toBeLessThan(b); expect(b).toBeLessThan(c);
  });

  it('smootherstep zero derivatives at ends', () => {
    expect(smootherstep(0, 1, 0)).toBeCloseTo(0, 10);
    expect(smootherstep(0, 1, 1)).toBeCloseTo(1, 10);
  });

  it('bilerp corners', () => {
    expect(bilerp(1, 2, 3, 4, 0, 0)).toBeCloseTo(1, 10);
    expect(bilerp(1, 2, 3, 4, 1, 0)).toBeCloseTo(2, 10);
    expect(bilerp(1, 2, 3, 4, 0, 1)).toBeCloseTo(3, 10);
    expect(bilerp(1, 2, 3, 4, 1, 1)).toBeCloseTo(4, 10);
    expect(bilerp(1, 2, 3, 4, 0.5, 0.5)).toBeCloseTo(2.5, 10);
  });

  it('fract and sign', () => {
    expect(fract(3.25)).toBeCloseTo(0.25, 10);
    expect(fract(-1.25)).toBeCloseTo(0.75, 10);
    expect(sign(-5)).toBe(-1); expect(sign(5)).toBe(1); expect(sign(0)).toBe(0);
  });

  it('wrapAngle keeps within (-PI, PI]', () => {
    expect(wrapAngle(0)).toBeCloseTo(0, 10);
    expect(Math.abs(wrapAngle(Math.PI * 2.5) - Math.PI * 0.5)).toBeLessThan(1e-9);
    expect(wrapAngle(-Math.PI * 2.5)).toBeCloseTo(-Math.PI * 0.5, 9);
  });

  it('moveToward caps at maxDelta', () => {
    expect(moveToward(0, 10, 3)).toBe(3);
    expect(moveToward(0, 2, 5)).toBe(2);
    expect(moveToward(5, 5, 1)).toBe(5);
  });

  it('ipow integer exponent', () => {
    expect(ipow(2, 10)).toBe(1024);
    expect(ipow(3, 0)).toBe(1);
    expect(ipow(5, 3)).toBe(125);
  });

  it('degree/radian constants', () => {
    expect(90 * DEG2RAD).toBeCloseTo(Math.PI / 2, 10);
    expect((Math.PI / 2) * RAD2DEG).toBeCloseTo(90, 10);
  });
});
