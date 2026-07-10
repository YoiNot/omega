/**
 * @omega/render-pbr — volumetric clouds (raymarched density field).
 *
 * A 3D density field is built from layered value-ish noise (deterministic,
 * seeded via `@omega/engine-core` `Rng` for the lattice permutation). The
 * raymarch is a pure function of (origin, dir, density field) — no clock,
 * no RNG at march time — so the same world yields identical transmittance
 * and the field itself is reproducible tick-for-tick.
 *
 * Backend-agnostic: `CloudField.sample` + `raymarchClouds` are plain math
 * a WebGL2/WebGPU shader would mirror; the package tests pin the exact
 * density grid + march result.
 */

import { Vec3, clamp01, lerp, smootherstep } from '@omega/engine-math';
import { Rng } from '@omega/engine-core';

/** A sampled cloud column result along one view ray. */
export interface CloudSample {
  /** accumulated cloud color (linear RGB). */
  color: [number, number, number];
  /** transmittance (1 = clear, 0 = fully occluded). */
  transmittance: number;
  /** mean density hit (for debugging / tests). */
  meanDensity: number;
}

/** Cloud volume configuration (pure data). */
export interface CloudConfig {
  /** grid resolution per axis. */
  res: number;
  /** world-space size of the cubic volume. */
  size: number;
  /** base of the cloud slab (world Y). */
  baseY: number;
  /** thickness of the slab (world Y). */
  thickness: number;
  /** number of fBm octaves. */
  octaves: number;
  /** fBm lacunarity. */
  lacunarity: number;
  /** fBm gain. */
  gain: number;
  /** density multiplier. */
  density: number;
  /** ambient/sun tint. */
  sunColor: [number, number, number];
  ambientColor: [number, number, number];
}

export function defaultCloudConfig(): CloudConfig {
  return {
    res: 16,
    size: 80,
    baseY: 18,
    thickness: 10,
    octaves: 4,
    lacunarity: 2.0,
    gain: 0.5,
    density: 1.4,
    sunColor: [1.0, 0.95, 0.85],
    ambientColor: [0.5, 0.55, 0.65],
  };
}

/** Hash a 3D lattice coordinate to [0,1) deterministically. */
function hash3(ix: number, iy: number, iz: number, perm: Uint8Array): number {
  const h = (ix * 374761393 + iy * 668265263 + iz * 2147483647) >>> 0;
  const idx = (h ^ perm[h & 255]) & 255;
  return idx / 255;
}

/** Smooth value noise at a lattice point using the permutation table. */
function valueNoise(x: number, y: number, z: number, perm: Uint8Array): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  const fx = smootherstep(0, 1, x - ix);
  const fy = smootherstep(0, 1, y - iy);
  const fz = smootherstep(0, 1, z - iz);
  const c000 = hash3(ix, iy, iz, perm);
  const c100 = hash3(ix + 1, iy, iz, perm);
  const c010 = hash3(ix, iy + 1, iz, perm);
  const c110 = hash3(ix + 1, iy + 1, iz, perm);
  const c001 = hash3(ix, iy, iz + 1, perm);
  const c101 = hash3(ix + 1, iy, iz + 1, perm);
  const c011 = hash3(ix, iy + 1, iz + 1, perm);
  const c111 = hash3(ix + 1, iy + 1, iz + 1, perm);
  const x00 = lerp(c000, c100, fx);
  const x10 = lerp(c010, c110, fx);
  const x01 = lerp(c001, c101, fx);
  const x11 = lerp(c011, c111, fx);
  const y0 = lerp(x00, x10, fy);
  const y1 = lerp(x01, x11, fy);
  return lerp(y0, y1, fz);
}

/** Fractional Brownian motion over value noise (deterministic). */
function fbm(x: number, y: number, z: number, perm: Uint8Array, cfg: CloudConfig): number {
  let amp = 0.5;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let o = 0; o < cfg.octaves; o++) {
    sum += amp * valueNoise(x * freq, y * freq, z * freq, perm);
    norm += amp;
    amp *= cfg.gain;
    freq *= cfg.lacunarity;
  }
  return norm > 0 ? sum / norm : 0;
}

/**
 * A 3D cloud density field. Densities are precomputed into a flat grid;
 * `sample` tri-linearly interpolates. Construction is seeded (permutation
 * table shuffled by a deterministic RNG) so identical (seed, cfg) => identical
 * field — the package test asserts this byte-for-byte.
 */
export class CloudField {
  readonly res: number;
  readonly size: number;
  readonly baseY: number;
  readonly thickness: number;
  readonly density: Float32Array;
  readonly cfg: CloudConfig;

  constructor(seed: string | number | bigint, cfg: CloudConfig = defaultCloudConfig()) {
    this.res = cfg.res;
    this.size = cfg.size;
    this.baseY = cfg.baseY;
    this.thickness = cfg.thickness;
    this.cfg = cfg;
    this.density = new Float32Array(cfg.res * cfg.res * cfg.res);

    // Deterministic permutation table (Fisher-Yates with seeded Rng).
    const perm = new Uint8Array(256);
    for (let i = 0; i < 256; i++) perm[i] = i;
    const rng = new Rng(seed);
    rng.shuffle(Array.from(perm)).forEach((v, i) => { perm[i] = v; });

    const n = cfg.res;
    const cell = cfg.size / n;
    const noiseScale = 3 / cfg.size; // ~3 noise periods across the volume
    let maxD = 1e-6;
    for (let zi = 0; zi < n; zi++) {
      for (let yi = 0; yi < n; yi++) {
        for (let xi = 0; xi < n; xi++) {
          const wx = xi * cell;
          const wy = cfg.baseY + (yi / (n - 1)) * cfg.thickness;
          const wz = zi * cell;
          // Vertical falloff: clouds denser mid-slab, fade at top/bottom.
          const hN = (wy - cfg.baseY) / Math.max(1e-6, cfg.thickness);
          const heightFall = Math.sin(clamp01(hN) * Math.PI); // 0 at edges, 1 mid
          const nval = fbm(wx * noiseScale, wy * noiseScale, wz * noiseScale, perm, cfg);
          const d = Math.max(0, (nval - 0.45) * 2) * heightFall * cfg.density;
          const idx = (zi * n + yi) * n + xi;
          this.density[idx] = d;
          if (d > maxD) maxD = d;
        }
      }
    }
    // Normalize so peak density is ~1 (stable raymarch).
    for (let i = 0; i < this.density.length; i++) {
      this.density[i] = clamp01(this.density[i] / maxD);
    }
  }

  /** Tri-linearly sample density at a world point (0 outside the volume). */
  sample(p: Vec3): number {
    const n = this.res;
    const cell = this.size / n;
    const lx = p.x / cell;
    const ly = (p.y - this.baseY) / (this.thickness / (n - 1));
    const lz = p.z / cell;
    if (lx < 0 || lx > n - 1 || ly < 0 || ly > n - 1 || lz < 0 || lz > n - 1) {
      return 0;
    }
    const x0 = Math.floor(lx), y0 = Math.floor(ly), z0 = Math.floor(lz);
    const x1 = Math.min(x0 + 1, n - 1), y1 = Math.min(y0 + 1, n - 1), z1 = Math.min(z0 + 1, n - 1);
    const fx = lx - x0, fy = ly - y0, fz = lz - z0;
    const at = (x: number, y: number, z: number) => this.density[(z * n + y) * n + x]!;
    const c000 = at(x0, y0, z0), c100 = at(x1, y0, z0);
    const c010 = at(x0, y1, z0), c110 = at(x1, y1, z0);
    const c001 = at(x0, y0, z1), c101 = at(x1, y0, z1);
    const c011 = at(x0, y1, z1), c111 = at(x1, y1, z1);
    const x00 = lerp(c000, c100, fx), x10 = lerp(c010, c110, fx);
    const x01 = lerp(c001, c101, fx), x11 = lerp(c011, c111, fx);
    const sy0 = lerp(x00, x10, fy), sy1 = lerp(x01, x11, fy);
    return lerp(sy0, sy1, fz);
  }
}

/**
 * Raymarch a cloud field from `origin` along unit `dir` for `steps` samples
 * over `stepLen` world units. Returns accumulated color + transmittance.
 * Pure function of inputs (no clock / RNG). Front-to-back compositing.
 */
export function raymarchClouds(
  field: CloudField,
  origin: Vec3,
  dir: Vec3,
  steps = 48,
  stepLen = 1.0,
): CloudSample {
  const d = field.density;
  void d;
  const sun = field.cfg.sunColor;
  const amb = field.cfg.ambientColor;
  let transmittance = 1;
  let r = 0, g = 0, b = 0;
  let mean = 0;
  const p = origin.clone();
  // Light direction for cheap self-shadowing: straight up-ish.
  const lightDir = new Vec3(0.3, 1.0, 0.2).normalize();
  for (let i = 0; i < steps; i++) {
    const dens = field.sample(p);
    mean += dens / steps;
    if (dens > 0.01) {
      // Cheap lighting: brighter where density above is lower (toward sun).
      const lit = field.sample(p.clone().addScaled(lightDir, stepLen)) * 0.5 + dens * 0.5;
      const densityAtSample = dens * stepLen;
      const absorption = 1 - Math.exp(-densityAtSample);
      const scatter = absorption * transmittance;
      r += scatter * lerp(amb[0], sun[0], lit);
      g += scatter * lerp(amb[1], sun[1], lit);
      b += scatter * lerp(amb[2], sun[2], lit);
      transmittance *= 1 - absorption;
      if (transmittance < 0.01) break;
    }
    p.addScaled(dir, stepLen);
  }
  return {
    color: [clamp01(r), clamp01(g), clamp01(b)],
    transmittance: clamp01(transmittance),
    meanDensity: mean,
  };
}
