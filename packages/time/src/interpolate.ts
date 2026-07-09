/**
 * @omega/time — frame interpolation helpers.
 *
 * Pure functions to blend between the previous and current simulation state using
 * the `alpha` produced by `FixedTimestep`. `alpha` is clamped to [0, 1] so a
 * slightly-out-of-range value (or a state snap) never extrapolates past the
 * bracketing states.
 */

import { clamp01, lerp, Vec3 } from '@omega/engine-math';

/** Interpolate two scalars. Pure. */
export function lerpScalar(a: number, b: number, alpha: number): number {
  return lerp(a, b, clamp01(alpha));
}

/** Interpolate two Vec3 states, returning a new Vec3. Pure. */
export function lerpVec3(a: Vec3, b: Vec3, alpha: number): Vec3 {
  return Vec3.lerp(a, b, clamp01(alpha));
}

/**
 * Interpolate either two scalars or two Vec3 states. The `alpha` (blend factor,
 * typically `FixedTimestep.alpha`) is clamped to [0, 1].
 */
export function lerpState(a: number, b: number, alpha: number): number;
export function lerpState(a: Vec3, b: Vec3, alpha: number): Vec3;
export function lerpState(
  a: number | Vec3,
  b: number | Vec3,
  alpha: number,
): number | Vec3 {
  if (typeof a === 'number' && typeof b === 'number') {
    return lerpScalar(a, b, alpha);
  }
  if (a instanceof Vec3 && b instanceof Vec3) {
    return lerpVec3(a, b, alpha);
  }
  throw new TypeError('lerpState: both endpoints must be number or both Vec3');
}
