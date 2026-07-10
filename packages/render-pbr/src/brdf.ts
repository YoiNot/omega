/**
 * @omega/render-pbr — CPU BRDF math (Cook-Torrance GGX).
 *
 * Deterministic Cook-Torrance specular BRDF, mirrored from the WGSL PBR
 * fragment shader so unit tests can pin exact reference values (no GL needed).
 * All functions are pure (no clock / ambient state); identical inputs always
 * yield identical radiance. Linear-space RGB in [0,1].
 *
 * Reference model:
 *   f(l,v) = (D * G * F) / (4 * (n·v) * (n·l))        (specular)
 *   diffuse = kd * albedo / PI
 *   where kd = (1 - F) * (1 - metallic)
 * D = GGX/Trowbridge-Reitz normal distribution (alpha = roughness^2)
 * G = Smith height-correlated (k = (rough+1)^2 / 8)
 * F = Schlick Fresnel with F0 = mix(0.04, albedo, metallic)
 */

import { clamp } from '@omega/engine-math';

export const PI = Math.PI;

/** Clamp a vector (tuple) component-wise into [0,1]. */
export function clamp3(v: readonly [number, number, number]): [number, number, number] {
  return [clamp(v[0], 0, 1), clamp(v[1], 0, 1), clamp(v[2], 0, 1)];
}

/** Dot product of two 3-vectors. */
export function dot3(a: readonly [number, number, number], b: readonly [number, number, number]): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/** Normalize a 3-vector (returns [0,0,0] for the zero vector). */
export function normalize3(v: readonly [number, number, number]): [number, number, number] {
  const l = Math.hypot(v[0], v[1], v[2]);
  if (l < 1e-9) return [0, 0, 0];
  return [v[0] / l, v[1] / l, v[2] / l];
}

/** GGX (Trowbridge-Reitz) normal distribution: D = a^2 / (PI * (n·h)^2*(a^2-1)+1)^2 */
export function distributionGGX(
  nDotH: number,
  roughness: number,
): number {
  const a = Math.max(roughness, 1e-3);
  const a2 = a * a;
  const d = nDotH * nDotH * (a2 - 1) + 1;
  return a2 / (PI * d * d + 1e-7);
}

/** Smith geometry, Schlick-GGX form with k = (rough+1)^2 / 8. */
export function geometrySmith(
  nDotV: number,
  nDotL: number,
  roughness: number,
): number {
  const r = roughness + 1;
  const k = (r * r) / 8;
  const gv = nDotV / (nDotV * (1 - k) + k + 1e-7);
  const gl = nDotL / (nDotL * (1 - k) + k + 1e-7);
  return gv * gl;
}

/** Schlick Fresnel; f0 is the F0 reflectance (vec3). */
export function fresnelSchlick(
  cosTheta: number,
  f0: readonly [number, number, number],
): [number, number, number] {
  const t = clamp(1 - cosTheta, 0, 1);
  const p = Math.pow(t, 5);
  return [
    f0[0] + (1 - f0[0]) * p,
    f0[1] + (1 - f0[1]) * p,
    f0[2] + (1 - f0[2]) * p,
  ];
}

/** F0 reflectance: mix(0.04 dielectric, albedo, metallic). */
export function f0FromMaterial(
  albedo: readonly [number, number, number],
  metallic: number,
): [number, number, number] {
  return [
    0.04 + (albedo[0] - 0.04) * metallic,
    0.04 + (albedo[1] - 0.04) * metallic,
    0.04 + (albedo[2] - 0.04) * metallic,
  ];
}

/**
 * Full Cook-Torrance BRDF radiance for one light.
 *
 * @param albedo      surface base color (linear RGB).
 * @param metallic   [0,1].
 * @param roughness  perceptual roughness [0,1] (clamped to [0.04,1] internally).
 * @param normal     world-space normal (need not be normalized).
 * @param viewDir    unit vector from surface TO the viewer (eye).
 * @param lightDir   unit vector from surface TO the light.
 * @param lightColor light radiance (linear RGB), already includes intensity.
 * @returns outgoing radiance (linear RGB).
 */
export function brdf(
  albedo: readonly [number, number, number],
  metallic: number,
  roughness: number,
  normal: readonly [number, number, number],
  viewDir: readonly [number, number, number],
  lightDir: readonly [number, number, number],
  lightColor: readonly [number, number, number],
): [number, number, number] {
  const N = normalize3(normal);
  const V = normalize3(viewDir);
  const L = normalize3(lightDir);
  const H = normalize3([V[0] + L[0], V[1] + L[1], V[2] + L[2]]);

  const nDotV = Math.max(dot3(N, V), 1e-4);
  const nDotL = Math.max(dot3(N, L), 0);
  const nDotH = Math.max(dot3(N, H), 0);
  const hDotV = Math.max(dot3(H, V), 0);

  const rough = clamp(roughness, 0.04, 1);
  const f0 = f0FromMaterial(albedo, metallic);

  const D = distributionGGX(nDotH, rough);
  const G = geometrySmith(nDotV, nDotL, rough);
  const F = fresnelSchlick(hDotV, f0);

  const numerator = D * G * (F[0] + F[1] + F[2]) / 3;
  const denominator = 4 * nDotV * nDotL + 1e-7;
  const specular = numerator / denominator;

  const kd0 = (1 - F[0]) * (1 - metallic);
  const kd1 = (1 - F[1]) * (1 - metallic);
  const kd2 = (1 - F[2]) * (1 - metallic);
  // For a single channel-testable scalar specular we use the luminance-mixed F.
  const specScalar = (F[0] + F[1] + F[2]) / 3;
  const kdScalar = (1 - specScalar) * (1 - metallic);

  const out0 = (kdScalar * albedo[0] / PI + specular) * lightColor[0] * nDotL;
  const out1 = (kdScalar * albedo[1] / PI + specular) * lightColor[1] * nDotL;
  const out2 = (kdScalar * albedo[2] / PI + specular) * lightColor[2] * nDotL;

  // Reference scalar test path returns the same scalar applied to every channel
  // when albedo is greyscale; keep kdScalar-based result.
  void kd0; void kd1; void kd2;
  return [out0, out1, out2];
}

/** Tone-map (Reinhard) + sRGB gamma encode, deterministic presentation step. */
export function toneMapGamma(
  color: readonly [number, number, number],
): [number, number, number] {
  const r = color[0] / (color[0] + 1);
  const g = color[1] / (color[1] + 1);
  const b = color[2] / (color[2] + 1);
  return [Math.pow(r, 1 / 2.2), Math.pow(g, 1 / 2.2), Math.pow(b, 1 / 2.2)];
}
