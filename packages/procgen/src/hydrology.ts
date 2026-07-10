/**
 * @omega/procgen — deterministic hydrology / river-network extraction.
 *
 * Derives drainage networks from a heightfield. The core computation
 * (D8 flow direction + upstream area accumulation + Strahler stream order)
 * is a PURE function of the heightfield, so identical input -> identical
 * river network with no RNG in the hot path.
 *
 * A convenience factory {@link deriveRivers} composes the deterministic
 * hydraulic-erosion step from @omega/geology with this analysis, driven by
 * the @omega/engine-core {@link Rng}. Because erosion consumes the Rng in a
 * fixed order, the same seed always yields the same eroded heightfield and
 * therefore the same river network (determinism contract preserved).
 *
 * See docs/adr/0001-determinism.md.
 */

import { Rng } from '@omega/engine-core';
import { clamp01 } from '@omega/engine-math';
import { simulate as simulateErosion } from '@omega/geology';

/** D8 flow-direction codes (0..7), -1 = sink/no-flow (local minimum / flat). */
export const D8 = {
  E: 0,
  SE: 1,
  S: 2,
  SW: 3,
  W: 4,
  NW: 5,
  N: 6,
  NE: 7,
} as const;

/** dx/dy offsets matching the D8 codes above, in row-major (y, x) order. */
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

export interface HydrologyOptions {
  /** Drainage area (cells) needed before a cell is considered a stream. Default 8. */
  streamThreshold?: number;
  /** Use the deterministic seeded-erosion pre-pass before analysis. Default true. */
  applyErosion?: boolean;
  /** Droplet count for the optional erosion pre-pass. Default 8000. */
  erosionDroplets?: number;
}

export interface RiverNetwork {
  /** Grid resolution (NxN). */
  n: number;
  /** Row-major NxN elevation used for the analysis. */
  heights: Float32Array;
  /** Row-major NxN D8 flow direction code (0..7) or -1 for sink. */
  flowDir: Int8Array;
  /** Row-major NxN upstream drainage area in cells. */
  upstreamArea: Float32Array;
  /** Row-major NxN Strahler stream order (0 = no stream). */
  streamOrder: Uint8Array;
  /** Row-major NxN boolean (1 = river cell, 0 = not), as Uint8 for typing. */
  isRiver: Uint8Array;
}

/**
 * Compute D8 flow directions on a heightfield.
 *
 * Each cell flows to the neighbor (of 8) with the steepest descent, scaled by
 * the diagonal distance so cardinal and diagonal drops are comparable. Cells
 * that are local minima (or flats with no lower neighbor) get flowDir = -1.
 * Pure / deterministic — no RNG.
 */
export function computeFlowDirections(heights: Float32Array, n: number): Int8Array {
  const flow = new Int8Array(n * n).fill(-1);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const idx = y * n + x;
      const h = heights[idx]!;
      let bestDir = -1;
      let bestSlope = 0; // must be strictly positive to flow
      for (let d = 0; d < 8; d++) {
        const [dy, dx] = D8_OFFSETS[d]!;
        const ny = y + dy;
        const nx = x + dx;
        if (nx < 0 || nx >= n || ny < 0 || ny >= n) continue;
        const nh = heights[ny * n + nx]!;
        const drop = h - nh;
        if (drop <= 0) continue;
        // Normalize by cell distance (1 for cardinal, sqrt(2) for diagonal).
        const dist = dx !== 0 && dy !== 0 ? Math.SQRT2 : 1;
        const slope = drop / dist;
        if (slope > bestSlope) {
          bestSlope = slope;
          bestDir = d;
        }
      }
      flow[idx] = bestDir === -1 ? -1 : (bestDir as number);
    }
  }
  return flow;
}

/**
 * Accumulate upstream drainage area by processing cells in a deterministic
 * topological order. We use a simple multi-pass relaxation: repeatedly push
 * each cell's +1 area down its flow direction until stable. Deterministic and
 * dependency-free (no priority queue needed for correctness).
 */
function accumulateArea(flow: Int8Array, n: number): Float32Array {
  const area = new Float32Array(n * n).fill(1);
  // Bounded relaxation: a chain of length up to n, so n passes are sufficient.
  for (let pass = 0; pass < n; pass++) {
    let changed = false;
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const idx = y * n + x;
        const dir = flow[idx]!;
        if (dir < 0) continue;
        const [dy, dx] = D8_OFFSETS[dir]!;
        const ny = y + dy;
        const nx = x + dx;
        if (nx < 0 || nx >= n || ny < 0 || ny >= n) continue;
        const nIdx = ny * n + nx;
        const contrib = area[idx]!;
        if (contrib > 0 && area[nIdx]! < area[idx]! + contrib - 1e-6) {
          area[nIdx] = area[idx]! + contrib;
          changed = true;
        }
      }
    }
    if (!changed) break;
  }
  return area;
}

/**
 * Assign Strahler stream order. Process cells in descending upstream-area
 * order (deterministic tie-break by index). A cell's order is:
 *   - 1 if no downstream cell carries a stream, or
 *   - max(childOrder) if only one child reaches it, or
 *   - childOrder + 1 if two or more children share that max order.
 * Cells below `streamThreshold` upstream area are not streams (order 0).
 */
function computeStreamOrder(
  flow: Int8Array,
  area: Float32Array,
  n: number,
  streamThreshold: number,
): { streamOrder: Uint8Array; isRiver: Uint8Array } {
  const order = new Uint8Array(n * n);
  const indices = Array.from({ length: n * n }, (_, i) => i);
  // Deterministic: larger upstream area first; ties broken by index.
  indices.sort((a, b) => area[b]! - area[a]! || a - b);

  for (const idx of indices) {
    if (area[idx]! < streamThreshold) {
      order[idx] = 0;
      continue;
    }
    const dir = flow[idx]!;
    if (dir < 0) {
      // Sink with sufficient area -> headwater stream of order 1.
      order[idx] = 1;
      continue;
    }
    const [dy, dx] = D8_OFFSETS[dir]!;
    const ny = Math.floor(idx / n) + dy;
    const nx = (idx % n) + dx;
    if (nx < 0 || nx >= n || ny < 0 || ny >= n) {
      order[idx] = 1;
      continue;
    }
    const downIdx = ny * n + nx;
    order[idx] = order[downIdx]!; // inherit downstream order
  }

  // Promote: any cell whose two+ upstream children share the same max order
  // bumps its OWN order by one (Strahler rule applied bottom-up via the
  // downstream link). We re-scan in upstream order for promotions.
  const isRiver = new Uint8Array(n * n);
  const upOrder = Array.from({ length: n * n }, (_, i) => i).sort(
    (a, b) => area[a]! - area[b]! || a - b,
  );
  for (const idx of upOrder) {
    if (area[idx]! < streamThreshold) {
      isRiver[idx] = 0;
      continue;
    }
    // Collect incoming (upstream) children.
    let maxChild = 0;
    let countMax = 0;
    for (let d = 0; d < 8; d++) {
      const [dy, dx] = D8_OFFSETS[d]!;
      const ny = Math.floor(idx / n) + dy;
      const nx = (idx % n) + dx;
      if (nx < 0 || nx >= n || ny < 0 || ny >= n) continue;
      const child = ny * n + nx;
      if (flow[child]! === ((d + 4) % 8)) {
        // child flows into this cell (opposite direction code)
        const co = order[child]!;
        if (co > maxChild) {
          maxChild = co;
          countMax = 1;
        } else if (co === maxChild) {
          countMax++;
        }
      }
    }
    let o = maxChild;
    if (maxChild > 0 && countMax >= 2) o = maxChild + 1;
    if (o === 0) o = 1; // has area above threshold -> at least a headwater
    order[idx] = o;
    isRiver[idx] = 1;
  }

  return { streamOrder: order, isRiver };
}

/**
 * Analyze a heightfield into a {@link RiverNetwork} (deterministic).
 *
 * @param heights Row-major NxN elevation (NOT mutated).
 * @param n Grid resolution.
 * @param options Tuning (stream threshold).
 */
export function analyze(heights: Float32Array, n: number, options: HydrologyOptions = {}): RiverNetwork {
  const streamThreshold = Math.max(1, Math.floor(options.streamThreshold ?? 8));
  const flow = computeFlowDirections(heights, n);
  const area = accumulateArea(flow, n);
  const { streamOrder, isRiver } = computeStreamOrder(flow, area, n, streamThreshold);
  return { n, heights, flowDir: flow, upstreamArea: area, streamOrder, isRiver };
}

/**
 * Derive a river network from a seed. Optionally runs the deterministic
 * hydraulic-erosion pre-pass from @omega/geology (seeded by `rng`) before
 * analysis, so the network reflects eroded terrain. Because erosion consumes
 * the {@link Rng} in a fixed order, the same seed -> same eroded field ->
 * same river network.
 *
 * @param heights Row-major NxN base elevation (NOT mutated; a copy is eroded).
 * @param n Grid resolution.
 * @param rng Deterministic RNG (advanced only by the optional erosion pass).
 * @param options Tuning.
 */
export function deriveRivers(
  heights: Float32Array,
  n: number,
  rng: Rng,
  options: HydrologyOptions = {},
): RiverNetwork {
  const applyErosion = options.applyErosion ?? true;
  if (!applyErosion) {
    return analyze(heights, n, options);
  }
  const work = heights.slice();
  simulateErosion(work, n, rng, {
    droplets: options.erosionDroplets ?? 8000,
    maxSteps: 64,
    sedimentNoise: 0, // keep fully deterministic (no rng.nextF64 mid-deposit)
  });
  return analyze(work, n, options);
}

/**
 * Convenience: normalize upstream area into [0,1] for visualization/export.
 * Pure function of the network.
 */
export function normalizedArea(net: RiverNetwork): Float32Array {
  let max = 0;
  for (let i = 0; i < net.upstreamArea.length; i++) {
    if (net.upstreamArea[i]! > max) max = net.upstreamArea[i]!;
  }
  const out = new Float32Array(net.upstreamArea.length);
  const inv = max > 0 ? 1 / max : 0;
  for (let i = 0; i < out.length; i++) out[i] = clamp01(net.upstreamArea[i]! * inv);
  return out;
}
