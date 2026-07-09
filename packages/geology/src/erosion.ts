/**
 * @omega/geology — hydraulic erosion (particle/droplet model).
 *
 * Classic seeded droplet erosion over a heightfield: each of K droplets starts
 * at a random (seeded) cell, traces downhill along the gradient, carries
 * water + sediment, erodes where it moves fast, deposits where it slows, and
 * evaporates a little each step. The heightfield is mutated in place and a
 * sediment field is maintained. Uses {@link Rng} for full determinism.
 *
 * See docs/adr/0001-determinism.md for the determinism contract.
 */

import { Rng } from '@omega/engine-core';
import { clamp } from '@omega/engine-math';

export interface ErosionOptions {
  /** Number of droplets to simulate. Default 20000. */
  droplets?: number;
  /** Max simulation steps per droplet. Default 64. */
  maxSteps?: number;
  /** Water capacity factor: capacity = capacityFactor * speed * water. Default 4. */
  capacityFactor?: number;
  /** Fraction of sediment deposited per step when over capacity. Default 0.3. */
  depositionRate?: number;
  /** Fraction of soil eroded per step when under capacity. Default 0.3. */
  erosionRate?: number;
  /** Evaporation fraction per step. Default 0.02. */
  evaporation?: number;
  /** Surface tension / direction inertia in [0,1). Default 0.05. */
  inertia?: number;
  /** Add a tiny bit of noise to deposition to avoid lock-step artifacts. Default 0. */
  sedimentNoise?: number;
}

export interface ErosionResult {
  /** Mutated (eroded) heightfield. */
  heights: Float32Array;
  /** Per-cell accumulated sediment (deposited material). */
  sediment: Float32Array;
  /** Number of droplets simulated. */
  droplets: number;
  /** Number of cells in the grid. */
  n: number;
}

/**
 * Simulate hydraulic erosion over a heightfield.
 *
 * @param heights Row-major NxN elevation (mutated in place and returned).
 * @param n Grid resolution.
 * @param rng Deterministic RNG (its state advances as droplets are seeded).
 * @param options Erosion tuning.
 * @returns The eroded heights plus the maintained sediment field.
 */
export function simulate(
  heights: Float32Array,
  n: number,
  rng: Rng,
  options: ErosionOptions = {},
): ErosionResult {
  const dropletCount = Math.max(0, Math.floor(options.droplets ?? 20000));
  const maxSteps = Math.max(1, Math.floor(options.maxSteps ?? 64));
  const capacityFactor = options.capacityFactor ?? 4;
  const depositionRate = options.depositionRate ?? 0.3;
  const erosionRate = options.erosionRate ?? 0.3;
  const evaporation = options.evaporation ?? 0.02;
  const inertia = clamp(options.inertia ?? 0.05, 0, 0.99);
  const sedimentNoise = options.sedimentNoise ?? 0;

  const sediment = new Float32Array(n * n);

  // Height lookups use bilinear sampling; gradient via central differences.
  const H = heights;

  for (let d = 0; d < dropletCount; d++) {
    // Seeded start position (continuous grid coords, edge-padded by 1).
    let px = rng.nextRange(1, n - 2);
    let py = rng.nextRange(1, n - 2);

    let dirX = 0;
    let dirY = 0;
    let water = 1;
    let carry = 0;

    for (let step = 0; step < maxSteps && water > 1e-4; step++) {
      const ix = Math.floor(px);
      const iy = Math.floor(py);
      const fx = px - ix;
      const fy = py - iy;

      // Bilinear sample of height + gradient at the droplet position.
      const h00 = H[iy * n + ix]!;
      const h10 = H[iy * n + ix + 1]!;
      const h01 = H[(iy + 1) * n + ix]!;
      const h11 = H[(iy + 1) * n + ix + 1]!;

      const gradX =
        (h10 - h00) * (1 - fy) + (h11 - h01) * fy;
      const gradY =
        (h01 - h00) * (1 - fx) + (h11 - h10) * fx;

      // Update direction with inertia (blend old direction with steepest descent).
      dirX = dirX * inertia - gradX * (1 - inertia);
      dirY = dirY * inertia - gradY * (1 - inertia);
      const len = Math.hypot(dirX, dirY);
      if (len < 1e-9) {
        // Stuck on a flat: nudge downhill using raw gradient, else stop.
        if (Math.hypot(gradX, gradY) < 1e-9) break;
        dirX = -gradX;
        dirY = -gradY;
      } else {
        dirX /= len;
        dirY /= len;
      }

      const nx = px + dirX;
      const ny = py + dirY;

      // Out of bounds: droplet leaves the map.
      if (nx < 1 || nx >= n - 1 || ny < 1 || ny >= n - 1) break;

      // Height delta over this step.
      const newH = sampleBilinear(H, n, nx, ny);
      const deltaH = newH - sampleBilinear(H, n, px, py);

      const speed = Math.sqrt(Math.max(0, deltaH < 0 ? -deltaH : 0) + 0.01);
      const capacity = Math.max(0, capacityFactor * speed * water);

      if (carry > capacity) {
        // Deposit (deposit a bit more where slope is shallow).
        const toDrop = (carry - capacity) * depositionRate;
        deposit(H, sediment, n, px, py, toDrop);
        carry -= toDrop;
      } else {
        // Erode: remove soil bounded by the downhill height drop.
        const toErode = Math.min(
          (capacity - carry) * erosionRate,
          Math.max(0, -deltaH) * 0.5,
        );
        if (toErode > 0) {
          if (sedimentNoise > 0) {
            carry += toErode * (1 - sedimentNoise * rng.nextF64());
          } else {
            carry += toErode;
          }
          erode(H, n, px, py, toErode);
        }
      }

      // Evaporate and advance.
      water *= 1 - evaporation;
      px = nx;
      py = ny;
    }
  }

  return { heights: H, sediment, droplets: dropletCount, n };
}

/** Bilinear height sample at continuous (x, y). */
function sampleBilinear(
  H: Float32Array,
  n: number,
  x: number,
  y: number,
): number {
  const ix = clamp(Math.floor(x), 0, n - 2);
  const iy = clamp(Math.floor(y), 0, n - 2);
  const fx = clamp(x - ix, 0, 1);
  const fy = clamp(y - iy, 0, 1);
  const h00 = H[iy * n + ix]!;
  const h10 = H[iy * n + ix + 1]!;
  const h01 = H[(iy + 1) * n + ix]!;
  const h11 = H[(iy + 1) * n + ix + 1]!;
  const a = h00 + (h10 - h00) * fx;
  const b = h01 + (h11 - h01) * fx;
  return a + (b - a) * fy;
}

/** Deposit `amount` of sediment at (x, y) using a 2x2 bilinear footprint. */
function deposit(
  H: Float32Array,
  sediment: Float32Array,
  n: number,
  x: number,
  y: number,
  amount: number,
): void {
  const ix = clamp(Math.floor(x), 0, n - 2);
  const iy = clamp(Math.floor(y), 0, n - 2);
  const fx = clamp(x - ix, 0, 1);
  const fy = clamp(y - iy, 0, 1);
  const w00 = (1 - fx) * (1 - fy);
  const w10 = fx * (1 - fy);
  const w01 = (1 - fx) * fy;
  const w11 = fx * fy;
  const idx00 = iy * n + ix;
  const idx10 = iy * n + ix + 1;
  const idx01 = (iy + 1) * n + ix;
  const idx11 = (iy + 1) * n + ix + 1;
  H[idx00] = H[idx00]! + amount * w00;
  H[idx10] = H[idx10]! + amount * w10;
  H[idx01] = H[idx01]! + amount * w01;
  H[idx11] = H[idx11]! + amount * w11;
  sediment[idx00] = sediment[idx00]! + amount * w00;
  sediment[idx10] = sediment[idx10]! + amount * w10;
  sediment[idx01] = sediment[idx01]! + amount * w01;
  sediment[idx11] = sediment[idx11]! + amount * w11;
}

/** Erode `amount` from (x, y) using a 2x2 bilinear footprint. */
function erode(
  H: Float32Array,
  n: number,
  x: number,
  y: number,
  amount: number,
): void {
  const ix = clamp(Math.floor(x), 0, n - 2);
  const iy = clamp(Math.floor(y), 0, n - 2);
  const fx = clamp(x - ix, 0, 1);
  const fy = clamp(y - iy, 0, 1);
  const w00 = (1 - fx) * (1 - fy);
  const w10 = fx * (1 - fy);
  const w01 = (1 - fx) * fy;
  const w11 = fx * fy;
  const idx00 = iy * n + ix;
  const idx10 = iy * n + ix + 1;
  const idx01 = (iy + 1) * n + ix;
  const idx11 = (iy + 1) * n + ix + 1;
  H[idx00] = H[idx00]! - amount * w00;
  H[idx10] = H[idx10]! - amount * w10;
  H[idx01] = H[idx01]! - amount * w01;
  H[idx11] = H[idx11]! - amount * w11;
}

/** Total absolute gradient (roughness proxy) over a heightfield. */
export function roughness(H: Float32Array, n: number): number {
  let acc = 0;
  for (let y = 1; y < n - 1; y++) {
    for (let x = 1; x < n - 1; x++) {
      const c = H[y * n + x]!;
      acc += Math.abs(c - H[y * n + x - 1]!);
      acc += Math.abs(c - H[y * n + x + 1]!);
      acc += Math.abs(c - H[(y - 1) * n + x]!);
      acc += Math.abs(c - H[(y + 1) * n + x]!);
    }
  }
  return acc;
}

/** Convenience class wrapper around {@link simulate}. */
export class HydraulicErosion {
  private readonly opts: ErosionOptions;
  constructor(options: ErosionOptions = {}) {
    this.opts = options;
  }

  /** Run erosion over a heightfield and return the result. */
  simulate(heights: Float32Array, n: number, rng: Rng): ErosionResult {
    return simulate(heights, n, rng, this.opts);
  }
}
