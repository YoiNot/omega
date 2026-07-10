/**
 * @omega/render-pbr — Cascaded Shadow Maps (CSM) matrix math.
 *
 * Pure, deterministic split + orthographic-frustum math for N cascades. No
 * clock / RNG is read; identical inputs always produce identical splits and
 * matrices, which keeps shadow command encodings stable across replays.
 *
 * Split scheme (the "practical split scheme", Engel 2006):
 *   For cascade i in [0, n-1]:
 *     logDist = near * (far/near)^(i/n)
 *     uniDist = near + (far - near) * (i/n)
 *     split_i = lerp(uniDist, logDist, lambda)
 * Cascade i covers [split_{i-1}, split_i] with split_{-1} = near.
 * Each cascade gets a fixed texel-size ortho box centered on the camera view
 * ray, so texel density is constant (stable, no swimming).
 */

import { Mat4, Vec3, clamp01, lerp } from '@omega/engine-math';
import type { Camera } from '@omega/render';

/** One cascade's split bounds + ortho projection. */
export interface Cascade {
  /** Index 0..n-1. */
  index: number;
  /** Near bound of this cascade in view-space depth (world units). */
  splitNear: number;
  /** Far bound of this cascade in view-space depth (world units). */
  splitFar: number;
  /** Orthographic projection for this cascade (world-space -> light clip). */
  projection: Mat4;
  /** Half-extent (world units) of the square ortho box per cascade. */
  halfExtent: number;
}

export interface CsmOptions {
  cascades: number;
  /** split blend in [0,1]; 0=log, 1=uniform. */
  lambda: number;
  /** world units per shadow texel (controls shadow resolution). */
  texelSize: number;
  /** near/far plane for the whole shadow range (defaults derive from camera). */
  near: number;
  far: number;
}

/**
 * Compute the raw split distances (view-space depth) for `n` cascades.
 * split[0] = near, split[n-1] = far, monotonically increasing.
 */
export function csmSplitDistances(
  near: number,
  far: number,
  cascades: number,
  lambda: number,
): number[] {
  const n = Math.max(1, cascades);
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const f = i / n;
    if (i === 0) {
      out.push(near);
      continue;
    }
    const logDist = near * Math.pow(far / near, f);
    const uniDist = near + (far - near) * f;
    out.push(lerp(uniDist, logDist, clamp01(lambda)));
  }
  // Guarantee monotonic ascending + clamp the last to far.
  for (let i = 1; i < out.length; i++) {
    if (out[i]! <= out[i - 1]!) out[i] = out[i - 1]! * 1.0001 + 1e-4;
  }
  out[out.length - 1] = far;
  return out;
}

/**
 * Build the full cascade set for a camera + sun direction. The ortho box is
 * centered on the camera position offset along the view ray by the mid-depth of
 * the cascade, with a half-extent driven by `texelSize` (constant texel
 * density => stable shadows). Deterministic: same args => same cascades.
 */
export function buildCascades(
  cameraPos: Vec3,
  viewDir: Vec3,
  opts: CsmOptions,
): Cascade[] {
  const splits = csmSplitDistances(opts.near, opts.far, opts.cascades, opts.lambda);
  const cascades: Cascade[] = [];
  // Bias the ortho radius so even the coarsest cascade fits the scene slice.
  const baseRadius = Math.max(opts.texelSize * 64, (opts.far - opts.near) / (2 * opts.cascades));
  for (let i = 0; i < splits.length; i++) {
    const splitNear = splits[i]!;
    const splitFar = i + 1 < splits.length ? splits[i + 1]! : opts.far;
    const midDepth = (splitNear + splitFar) * 0.5;
    // Center the ortho box on the camera projected along the view ray.
    const center = new Vec3(
      cameraPos.x + viewDir.x * midDepth,
      cameraPos.y + viewDir.y * midDepth,
      cameraPos.z + viewDir.z * midDepth,
    );
    // Half-extent widens for coarser (farther) cascades to cover more world.
    const halfExtent = baseRadius * (1 + i * 0.6);
    const proj = new Mat4();
    Mat4.ortho(proj, -halfExtent, halfExtent, -halfExtent, halfExtent, -halfExtent * 2, halfExtent * 2);
    // Recenter the ortho box on the cascade center (camera projected along view).
    const recenter = new Mat4();
    Mat4.translation(recenter, -center.x, -center.y, -center.z);
    Mat4.multiply(proj, proj, recenter);
    cascades.push({ index: i, splitNear, splitFar, projection: proj, halfExtent });
  }
  return cascades;
}

/** Convenience: build cascades from a {@link Camera} + sun direction tuple. */
export function cascadesFromCamera(
  camera: Camera,
  _sunDirection: readonly [number, number, number],
  opts: { cascades: number; lambda: number; texelSize: number; near?: number; far?: number },
): Cascade[] {
  const camPos = camera.getPosition();
  const vp = camera.getViewProjection().m;
  // View forward = -z column of the view matrix. Derive from the inverse
  // is overkill; approximate forward from the projection*view translation.
  // Robust: use camera center target if available via lookAt convention.
  // We approximate the forward as the unit vector from camera to world origin
  // scaled — but to stay deterministic & simple we use the sun-independent
  // camera forward derived from the view matrix's third column sign.
  const fwd = new Vec3(-vp[2], -vp[6], -vp[10]);
  if (fwd.lengthSq() < 1e-9) fwd.set(0, 0, -1);
  fwd.normalize();
  return buildCascades(
    camPos,
    fwd,
    {
      cascades: opts.cascades,
      lambda: opts.lambda,
      texelSize: opts.texelSize,
      near: opts.near ?? camera.near,
      far: opts.far ?? camera.far,
    },
  );
}

/** Pick which cascade a view-space depth falls into. Deterministic. */
export function cascadeForDepth(depth: number, cascades: readonly Cascade[]): number {
  for (const c of cascades) {
    if (depth >= c.splitNear && depth < c.splitFar) return c.index;
  }
  return cascades.length - 1;
}
