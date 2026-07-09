/**
 * @omega/engine-math — scalar math utilities.
 *
 * Everything here is pure and deterministic (no ambient state) so it is safe to use
 * inside seeded generation and simulation code. See docs/adr/0001-determinism.md.
 */

export const PI = Math.PI;
export const TAU = Math.PI * 2;
export const HALF_PI = Math.PI * 0.5;
export const DEG2RAD = Math.PI / 180;
export const RAD2DEG = 180 / Math.PI;

export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

export function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Inverse lerp: where does x sit between a and b? Unclamped. */
export function invLerp(a: number, b: number, x: number): number {
  return a === b ? 0 : (x - a) / (b - a);
}

/** Smoothstep (Hermite) on [edge0, edge1]. */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01(invLerp(edge0, edge1, x));
  return t * t * (3 - 2 * t);
}

/** Cubic smootherstep (Ken Perlin's improved interpolation). */
export function smootherstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01(invLerp(edge0, edge1, x));
  return t * t * t * (t * (t * 6 - 15) + 10);
}

export function mix(a: number, b: number, t: number): number {
  return lerp(a, b, t);
}

/**
 * Bilinear interpolation of four corner values arranged as:
 *   v00 -- v10
 *   |       |
 *   v01 -- v11
 * with (tx, ty) in [0,1] across x then y.
 */
export function bilerp(
  v00: number, v10: number, v01: number, v11: number, tx: number, ty: number,
): number {
  const a = lerp(v00, v10, tx);
  const b = lerp(v01, v11, tx);
  return lerp(a, b, ty);
}

/** Linear interpolation along a gradient (for value-noise lookup). */
export function fade(t: number): number {
  return smootherstep(0, 1, t);
}

export function fract(x: number): number {
  return x - Math.floor(x);
}

export function sign(x: number): number {
  return x > 0 ? 1 : x < 0 ? -1 : 0;
}

/** Move `current` toward `target` by at most `maxDelta`. */
export function moveToward(current: number, target: number, maxDelta: number): number {
  const d = target - current;
  if (Math.abs(d) <= maxDelta) return target;
  return current + Math.sign(d) * maxDelta;
}

/** Wrap an angle in radians into (-PI, PI]. */
export function wrapAngle(a: number): number {
  let x = (a + PI) % TAU;
  if (x < 0) x += TAU;
  return x - PI;
}

/** Integer power for small integer exponents (deterministic, no Math.pow float noise). */
export function ipow(base: number, exp: number): number {
  let r = 1;
  let e = exp;
  let b = base;
  while (e > 0) {
    if (e & 1) r *= b;
    b *= b;
    e = Math.floor(e / 2);
  }
  return r;
}
