/**
 * @omega/world-gen — seeded deterministic noise.
 *
 * Both `ValueNoise` and `GradientNoise` derive their permutation tables from a
 * seeded {@link Rng}, so identical seeds always produce identical output and
 * different seeds produce different output. No ambient state, no Math.random.
 * See docs/adr/0001-determinism.md.
 */

import { Rng } from '@omega/engine-core';
import { clamp, fade, lerp } from '@omega/engine-math';

/** Build a doubled (512-entry) permutation table seeded by `seed`. */
function buildPermTable(seed: number | bigint | string): Uint8Array {
  const rng = new Rng(seed);
  const order = Array.from({ length: 256 }, (_, i) => i);
  rng.shuffle(order);
  const perm = new Uint8Array(512);
  for (let i = 0; i < 512; i++) perm[i] = order[i & 255]!;
  return perm;
}

/** Classic Ken Perlin 3D gradient (improved noise), returns a dot product. */
function grad3(hash: number, x: number, y: number, z: number): number {
  const h = hash & 15;
  const u = h < 8 ? x : y;
  const v = h < 4 ? y : h === 12 || h === 14 ? x : z;
  return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
}

/** 2D gradient (8 directions), returns a dot product. */
function grad2(hash: number, x: number, y: number): number {
  const h = hash & 7;
  const u = h < 4 ? x : y;
  const v = h < 4 ? y : x;
  return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
}

/**
 * Common surface for all noise generators. `sample2D`/`sample3D` return a value
 * in [-1, 1]; `fbm2D`/`fbm3D` sum octaves (frequency * lacunarity, amplitude *
 * persistence) and renormalize back into [-1, 1].
 */
export abstract class Noise {
  protected readonly perm: Uint8Array;

  constructor(seed: number | bigint | string) {
    this.perm = buildPermTable(seed);
  }

  abstract sample2D(x: number, y: number): number;
  abstract sample3D(x: number, y: number, z: number): number;

  /** Fractal Brownian motion in 2D, normalized to [-1, 1]. */
  fbm2D(
    x: number,
    y: number,
    octaves = 4,
    persistence = 0.5,
    lacunarity = 2,
  ): number {
    let amp = 1;
    let freq = 1;
    let sum = 0;
    let norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum += amp * this.sample2D(x * freq, y * freq);
      norm += amp;
      amp *= persistence;
      freq *= lacunarity;
    }
    return norm > 0 ? sum / norm : 0;
  }

  /** Fractal Brownian motion in 3D, normalized to [-1, 1]. */
  fbm3D(
    x: number,
    y: number,
    z: number,
    octaves = 4,
    persistence = 0.5,
    lacunarity = 2,
  ): number {
    let amp = 1;
    let freq = 1;
    let sum = 0;
    let norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum += amp * this.sample3D(x * freq, y * freq, z * freq);
      norm += amp;
      amp *= persistence;
      freq *= lacunarity;
    }
    return norm > 0 ? sum / norm : 0;
  }
}

/**
 * Value noise: lattice corners are seeded pseudo-random values in [-1, 1],
 * smoothly interpolated (bilinear in 2D, trilinear in 3D).
 */
export class ValueNoise extends Noise {
  private valueAt(ix: number, iy: number): number {
    const h = this.perm[(this.perm[ix & 255] + (iy & 255)) & 255]!;
    return (h / 255) * 2 - 1;
  }

  private valueAt3(ix: number, iy: number, iz: number): number {
    const h = this.perm[
      (this.perm[(this.perm[ix & 255] + (iy & 255)) & 255] + (iz & 255)) & 255
    ]!;
    return (h / 255) * 2 - 1;
  }

  sample2D(x: number, y: number): number {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const u = fade(xf);
    const v = fade(yf);
    const v00 = this.valueAt(xi, yi);
    const v10 = this.valueAt(xi + 1, yi);
    const v01 = this.valueAt(xi, yi + 1);
    const v11 = this.valueAt(xi + 1, yi + 1);
    return lerp(lerp(v00, v10, u), lerp(v01, v11, u), v);
  }

  sample3D(x: number, y: number, z: number): number {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const zi = Math.floor(z);
    const xf = x - xi;
    const yf = y - yi;
    const zf = z - zi;
    const u = fade(xf);
    const v = fade(yf);
    const w = fade(zf);
    const c000 = this.valueAt3(xi, yi, zi);
    const c100 = this.valueAt3(xi + 1, yi, zi);
    const c010 = this.valueAt3(xi, yi + 1, zi);
    const c110 = this.valueAt3(xi + 1, yi + 1, zi);
    const c001 = this.valueAt3(xi, yi, zi + 1);
    const c101 = this.valueAt3(xi + 1, yi, zi + 1);
    const c011 = this.valueAt3(xi, yi + 1, zi + 1);
    const c111 = this.valueAt3(xi + 1, yi + 1, zi + 1);
    const x00 = lerp(c000, c100, u);
    const x10 = lerp(c010, c110, u);
    const x01 = lerp(c001, c101, u);
    const x11 = lerp(c011, c111, u);
    const y0 = lerp(x00, x10, v);
    const y1 = lerp(x01, x11, v);
    return lerp(y0, y1, w);
  }
}

/**
 * Gradient (Perlin-style) noise: lattice corners carry gradient vectors;
 * the output is the smoothly-interpolated dot product of the gradient with the
 * offset to the sample point.
 */
export class GradientNoise extends Noise {
  private gradAt(ix: number, iy: number): number {
    return this.perm[(this.perm[ix & 255] + (iy & 255)) & 255]!;
  }

  private gradAt3(ix: number, iy: number, iz: number): number {
    return this.perm[
      (this.perm[(this.perm[ix & 255] + (iy & 255)) & 255] + (iz & 255)) & 255
    ]!;
  }

  sample2D(x: number, y: number): number {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const u = fade(xf);
    const v = fade(yf);
    const n00 = grad2(this.gradAt(xi, yi), xf, yf);
    const n10 = grad2(this.gradAt(xi + 1, yi), xf - 1, yf);
    const n01 = grad2(this.gradAt(xi, yi + 1), xf, yf - 1);
    const n11 = grad2(this.gradAt(xi + 1, yi + 1), xf - 1, yf - 1);
    return lerp(lerp(n00, n10, u), lerp(n01, n11, u), v);
  }

  sample3D(x: number, y: number, z: number): number {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const zi = Math.floor(z);
    const xf = x - xi;
    const yf = y - yi;
    const zf = z - zi;
    const u = fade(xf);
    const v = fade(yf);
    const w = fade(zf);
    const n000 = grad3(this.gradAt3(xi, yi, zi), xf, yf, zf);
    const n100 = grad3(this.gradAt3(xi + 1, yi, zi), xf - 1, yf, zf);
    const n010 = grad3(this.gradAt3(xi, yi + 1, zi), xf, yf - 1, zf);
    const n110 = grad3(this.gradAt3(xi + 1, yi + 1, zi), xf - 1, yf - 1, zf);
    const n001 = grad3(this.gradAt3(xi, yi, zi + 1), xf, yf, zf - 1);
    const n101 = grad3(this.gradAt3(xi + 1, yi, zi + 1), xf - 1, yf, zf - 1);
    const n011 = grad3(this.gradAt3(xi, yi + 1, zi + 1), xf, yf - 1, zf - 1);
    const n111 = grad3(this.gradAt3(xi + 1, yi + 1, zi + 1), xf - 1, yf - 1, zf - 1);
    const x00 = lerp(n000, n100, u);
    const x10 = lerp(n010, n110, u);
    const x01 = lerp(n001, n101, u);
    const x11 = lerp(n011, n111, u);
    const y0 = lerp(x00, x10, v);
    const y1 = lerp(x01, x11, v);
    return lerp(y0, y1, w);
  }
}

export type NoiseKind = 'value' | 'gradient';

/** Convenience factory. `createNoise('gradient', seed)` is equivalent to `new GradientNoise(seed)`. */
export function createNoise(kind: NoiseKind, seed: number | bigint | string): Noise {
  return kind === 'value' ? new ValueNoise(seed) : new GradientNoise(seed);
}

/** Clamp a noise sample to its theoretical [-1, 1] range (guards against fp drift). */
export function clampSample(s: number): number {
  return clamp(s, -1, 1);
}
