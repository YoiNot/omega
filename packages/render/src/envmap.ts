/**
 * @omega/render — procedural, seed-deterministic environment map (IBL).
 *
 * Image-Based Lighting normally needs an HDRI asset. We have a $0 budget and a
 * determinism contract, so instead we BAKE a small procedural sky+ground
 * environment cube/equirect from our own seeded noise (world-gen). Identical
 * seed => identical env map on every machine => IBL that strengthens the
 * "same seed => same world" claim instead of breaking it.
 *
 * This is the IBL counterpart to GTAO: together they lift the PBR terrain from
 * "flat lambert + hardcoded ambient" (current apps/web) to real image-based
 * indirect lighting with no external assets.
 *
 * The bake runs on CPU (TS mirror of the GLSL intent) so it is testable in
 * Node without a GPU, and produces an RGBA Float32 equirectangular buffer that
 * the renderer uploads as a sampler. A GPU version (prefiltered mips for
 * roughness) is future work (option C / render-graph).
 */

import { Rng } from '@omega/engine-core';
import { createNoise, Noise } from '@omega/world-gen';

export interface EnvMap {
  width: number;
  height: number;
  /** RGBA float, row-major, length = width*height*4, linear-ish HDR. */
  data: Float32Array;
  /** Simple analytic irradiance constant (hemisphere ambient weight). */
  irradiance: [number, number, number];
}

/** Deterministic banded sky gradient + noise-driven cloud bands, seeded. */
export function bakeEnvMap(seed: number | bigint | string, width = 64, height = 32): EnvMap {
  const rng = new Rng(seed);
  const noise: Noise = createNoise('gradient', seed);
  const data = new Float32Array(width * height * 4);

  // Two seeded tint colors for sky/ground (HDR-ish, >1 allowed for bloom later).
  const skyTint: [number, number, number] = [
    0.5 + rng.nextF64() * 0.5,
    0.6 + rng.nextF64() * 0.4,
    1.0 + rng.nextF64() * 0.6,
  ];
  const groundTint: [number, number, number] = [
    0.4 + rng.nextF64() * 0.3,
    0.35 + rng.nextF64() * 0.25,
    0.25 + rng.nextF64() * 0.2,
  ];

  for (let y = 0; y < height; y++) {
    const v = y / (height - 1); // 0 top .. 1 bottom
    const up = 1 - v * 2; // +1 top, -1 bottom
    const hemi = up * 0.5 + 0.5; // 0 ground .. 1 sky
    for (let x = 0; x < width; x++) {
      const u = x / (width - 1);
      // Latitude/longitude-ish sample for noise to add cloud bands.
      const nx = Math.cos(u * Math.PI * 2) * (1 - Math.abs(up));
      const ny = up;
      const nz = Math.sin(u * Math.PI * 2) * (1 - Math.abs(up));
      const n = noise.sample3D(nx * 3 + 10, ny * 3, nz * 3 - 5);
      const cloud = Math.max(0, n); // 0..1 bands

      const skyW = Math.pow(hemi, 0.6);
      const r = skyTint[0] * skyW + groundTint[0] * (1 - skyW) + cloud * 0.6;
      const g = skyTint[1] * skyW + groundTint[1] * (1 - skyW) + cloud * 0.6;
      const b = skyTint[2] * skyW + groundTint[2] * (1 - skyW) + cloud * 0.7;

      const idx = (y * width + x) * 4;
      data[idx] = r;
      data[idx + 1] = g;
      data[idx + 2] = b;
      data[idx + 3] = 1;
    }
  }

  // Irradiance ~ average of upper hemisphere (cheap analytic stand-in).
  const irr: [number, number, number] = [0, 0, 0];
  let cnt = 0;
  for (let y = 0; y < height; y++) {
    const up = 1 - (y / (height - 1)) * 2;
    if (up <= 0) continue;
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      irr[0] += data[idx]!;
      irr[1] += data[idx + 1]!;
      irr[2] += data[idx + 2]!;
      cnt++;
    }
  }
  if (cnt > 0) {
    irr[0] /= cnt;
    irr[1] /= cnt;
    irr[2] /= cnt;
  }

  return { width, height, data, irradiance: irr };
}

/** Sample the env map at a normalized direction (used by IBL spec/diffuse). */
export function sampleEnv(env: EnvMap, dir: [number, number, number]): [number, number, number] {
  // Equirect: u = atan2(z,x)/(2pi)+0.5, v = acos(y)/pi (y up).
  const len = Math.hypot(dir[0], dir[1], dir[2]) || 1;
  const y = dir[1] / len;
  const u = Math.atan2(dir[2], dir[0]) / (Math.PI * 2) + 0.5;
  const v = Math.acos(Math.max(-1, Math.min(1, y))) / Math.PI;
  const x = Math.min(env.width - 1, Math.max(0, Math.floor(u * (env.width - 1))));
  const yy = Math.min(env.height - 1, Math.max(0, Math.floor(v * (env.height - 1))));
  const idx = (yy * env.width + x) * 4;
  return [env.data[idx]!, env.data[idx + 1]!, env.data[idx + 2]!];
}
