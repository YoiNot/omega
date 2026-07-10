/**
 * @omega/procgen — deterministic fluvial (river-coupled) erosion.
 *
 * Unlike @omega/geology's droplet-based hydraulic erosion (which scatters
 * particles over the whole field), this model is *river-coupled*: it derives
 * the D8 drainage network from the current heightfield (using this package's
 * {@link analyze} from hydrology) and incises the terrain along active stream
 * cells, with incision power scaling with discharge (upstream area) and local
 * slope — the classic stream-power / fluvial erosion model. Material removed
 * uphill is deposited downstream (valley fill / sediment), conserving mass.
 *
 * Determinism: with `sedimentNoise = 0` (the default) the computation consumes
 * NO Rng and is a pure function of (heights, options). The optional Rng is only
 * touched when `sedimentNoise > 0`, and then strictly in upstream-area order, so
 * the same seed still reproduces the same field. Equal seed + equal input ->
 * identical eroded heightfield and identical post-erosion river network.
 *
 * See docs/adr/0001-determinism.md.
 */

import { Rng } from '@omega/engine-core';
import { clamp } from '@omega/engine-math';
import { analyze, type RiverNetwork } from './hydrology.js';

/** D8 flow-direction offsets, matching hydrology's D8 codes (row-major y,x). */
const D8_OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [0, 1], // E
  [1, 1], // SE
  [1, 0], // S
  [1, -1], // SW
  [0, -1], // W
  [-1, -1], // NW
  [-1, 0], // N
  [-1, 1], // NE
];

export interface FluvialErosionOptions {
  /** Number of full erosion passes (recompute network between passes). Default 3. */
  iterations?: number;
  /** Stream-power capacity factor (scales discharge*slope). Default 0.5. */
  capacityFactor?: number;
  /** Fraction of excess stream power converted to erosion per pass. Default 0.15. */
  erosionRate?: number;
  /** Fraction of eroded sediment deposited downstream per pass. Default 0.1. */
  depositionRate?: number;
  /** Max normalized elevation removed per cell per pass (stability cap). Default 0.05. */
  maxIncision?: number;
  /** Exponent on discharge in the stream-power law (Q^exp). Default 0.5. */
  streamPowerExp?: number;
  /** Tiny deterministic deposit-noise to break lock-step; 0 = fully deterministic. Default 0. */
  sedimentNoise?: number;
  /** Upstream-area threshold passed through to hydrology's analyze(). Default 8. */
  streamThreshold?: number;
}

export interface FluvialErosionResult {
  /** Row-major NxN eroded heightfield (mutated copy of input). */
  heights: Float32Array;
  /** Row-major NxN accumulated sediment (deposited material). */
  sediment: Float32Array;
  /** Grid resolution. */
  n: number;
  /** The D8 river network recomputed on the FINAL eroded field (coupled). */
  net: RiverNetwork;
  /** Number of passes actually run. */
  iterations: number;
}

/**
 * Erode a heightfield along its river network.
 *
 * @param heights Row-major NxN base elevation (NOT mutated; a copy is eroded).
 * @param n Grid resolution.
 * @param rng Optional deterministic RNG — only used when `sedimentNoise > 0`.
 *            If omitted, `sedimentNoise` is forced to 0 so the result is purely
 *            a function of the inputs (simplest determinism contract).
 * @param options Tuning (see {@link FluvialErosionOptions}).
 * @returns The eroded field, the sediment field, and the post-erosion network.
 */
export function erodeWithRivers(
  heights: Float32Array,
  n: number,
  rng?: Rng,
  options: FluvialErosionOptions = {},
): FluvialErosionResult {
  const iterations = Math.max(1, Math.floor(options.iterations ?? 3));
  const capacityFactor = options.capacityFactor ?? 0.5;
  const erosionRate = options.erosionRate ?? 0.15;
  const depositionRate = clamp(options.depositionRate ?? 0.1, 0, 1);
  const maxIncision = options.maxIncision ?? 0.05;
  const streamPowerExp = options.streamPowerExp ?? 0.5;
  const sedimentNoise = rng ? options.sedimentNoise ?? 0 : 0; // no rng -> no noise
  const streamThreshold = options.streamThreshold ?? 8;

  const H = heights.slice();
  const sediment = new Float32Array(n * n);
  let net = analyze(H, n, { streamThreshold });

  for (let it = 0; it < iterations; it++) {
    const { flowDir, upstreamArea, isRiver } = net;

    // Deterministic cell order: largest upstream area first; ties by index.
    const order = Array.from({ length: n * n }, (_, i) => i);
    order.sort((a, b) => upstreamArea[b]! - upstreamArea[a]! || a - b);

    for (const idx of order) {
      if (isRiver[idx]! === 0) continue; // only erode along active streams (river-coupled)
      const dir = flowDir[idx]!;
      if (dir < 0) continue; // local sink — nowhere to carry sediment
      const x = idx % n;
      const y = Math.floor(idx / n);
      const [dy, dx] = D8_OFFSETS[dir]!;
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || nx >= n || ny < 0 || ny >= n) continue;
      const dIdx = ny * n + nx;

      const slope = H[idx]! - H[dIdx]!; // positive = downhill
      if (slope <= 0) continue; // flat / uphill in current network -> skip

      const Q = Math.max(1, upstreamArea[idx]!);
      const power = capacityFactor * Math.pow(Q, streamPowerExp) * slope;

      let toErode = Math.min(erosionRate * power, maxIncision, slope * 0.5);
      if (toErode <= 0) continue;

      // Optional deterministic micro-noise (only if an Rng was supplied).
      if (sedimentNoise > 0) {
        toErode *= 1 - sedimentNoise * rng!.nextF64();
      }

      // Incise the cell; deposit a portion downstream (valley fill).
      H[idx] = H[idx]! - toErode;
      sediment[idx] = sediment[idx]! + toErode;
      const toDep = toErode * depositionRate;
      H[dIdx] = H[dIdx]! + toDep;
      sediment[dIdx] = sediment[dIdx]! + toDep;
    }

    // Recompute the drainage network on the eroded field for the next pass
    // (this is the "coupling": erosion reshapes terrain, river re-routes).
    net = analyze(H, n, { streamThreshold });
  }

  return { heights: H, sediment, n, net, iterations };
}

/**
 * Convenience: run {@link erodeWithRivers} from a seed. The Rng is only used
 * when `sedimentNoise > 0`. Deterministic for a fixed seed.
 */
export function erodeFromSeed(
  heights: Float32Array,
  n: number,
  seed: number | bigint | string,
  options: FluvialErosionOptions = {},
): FluvialErosionResult {
  return erodeWithRivers(heights, n, new Rng(`erosion:${seed}`), options);
}

/** Total eroded volume proxy (sum of removed material before deposition). */
export function erodedVolume(result: FluvialErosionResult): number {
  let acc = 0;
  for (let i = 0; i < result.sediment.length; i++) acc += result.sediment[i]!;
  return acc;
}
