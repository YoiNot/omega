/**
 * @omega/procgen — deterministic feature scattering.
 *
 * `scatterField` places `count` features (biomes/vegetation/rocks) over a
 * rectangular area using Bridson's Poisson-disk sampling. The minimum-distance
 * constraint produces evenly-spaced, non-clumped points; the sequence is fully
 * driven by a seeded {@link Rng}, so identical seed + params => identical
 * points, bit-for-bit.
 */

import { makeRng } from './rng.js';
import { TAU } from '@omega/engine-math';

/** A single scattered feature. */
export interface ScatterPoint {
  x: number;
  y: number;
  kind: string;
  scale: number;
}

/** A weighted kind for the scatter mix. */
export interface KindWeight {
  kind: string;
  weight: number;
}

/** Rectangular scatter region (inclusive bounds). */
export interface ScatterBounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ScatterFieldOptions {
  /** Seed for the underlying Rng (number | bigint | string). */
  seed: number | bigint | string;
  /** Desired number of points. */
  count: number;
  /** Scatter region. Defaults to the unit square {x:0,y:0,w:1,h:1}. */
  bounds?: ScatterBounds;
  /** Weighted kind mix; defaults to a single `feature` kind. */
  kinds?: KindWeight[];
  /** Minimum feature scale. Default 0.5. */
  minScale?: number;
  /** Maximum feature scale. Default 1.5. */
  maxScale?: number;
  /**
   * Explicit Poisson-disk radius (minimum distance between samples). If
   * omitted it is derived from `count` and the area so the packing can hold at
   * least `count` points, which are then truncated to exactly `count`.
   */
  radius?: number;
}

const DEFAULT_BOUNDS: ScatterBounds = { x: 0, y: 0, w: 1, h: 1 };

/**
 * Scatter `count` features over `bounds` using seeded Poisson-disk sampling.
 *
 * Determinism: the active-list order, candidate angles/distances, and the
 * kind/scale assignment are all drawn from the seeded Rng in a fixed sequence,
 * so the output is a pure function of the options.
 *
 * Returns exactly `count` points when the area is large enough to hold them at
 * the chosen spacing; if the minimum-distance constraint cannot place `count`
 * points (very small area), fewer points are returned — this is the documented
 * spacing cap, never a randomness bug.
 */
export function scatterField(opts: ScatterFieldOptions): ScatterPoint[] {
  const { seed, count } = opts;
  if (count <= 0) return [];

  const bounds = opts.bounds ?? DEFAULT_BOUNDS;
  const minScale = opts.minScale ?? 0.5;
  const maxScale = opts.maxScale ?? 1.5;
  const kinds =
    opts.kinds && opts.kinds.length > 0
      ? opts.kinds
      : [{ kind: 'feature', weight: 1 }];

  const area = bounds.w * bounds.h;
  if (area <= 0) return [];

  // Minimum distance between samples (Poisson-disk radius). Derived so the disk
  // packing can hold at least `count` points; the active-list generation is
  // then truncated to exactly `count`.
  const r =
    opts.radius && opts.radius > 0
      ? opts.radius
      : Math.sqrt(area / (count * 2.5));
  const cellSize = r / Math.SQRT2;
  const gw = Math.max(1, Math.ceil(bounds.w / cellSize));
  const gh = Math.max(1, Math.ceil(bounds.h / cellSize));
  const grid = new Int32Array(gw * gh).fill(-1);
  const px: number[] = [];
  const py: number[] = [];
  const active: number[] = [];

  const rng = makeRng(seed);

  const fits = (nx: number, ny: number): boolean => {
    const cx = Math.floor((nx - bounds.x) / cellSize);
    const cy = Math.floor((ny - bounds.y) / cellSize);
    const loX = Math.max(0, cx - 2);
    const hiX = Math.min(gw - 1, cx + 2);
    const loY = Math.max(0, cy - 2);
    const hiY = Math.min(gh - 1, cy + 2);
    for (let gy = loY; gy <= hiY; gy++) {
      for (let gx = loX; gx <= hiX; gx++) {
        const gi = grid[gy * gw + gx]!;
        if (gi !== -1) {
          const dx = px[gi]! - nx;
          const dy = py[gi]! - ny;
          if (dx * dx + dy * dy < r * r) return false;
        }
      }
    }
    return true;
  };

  const add = (nx: number, ny: number): void => {
    const cx = Math.floor((nx - bounds.x) / cellSize);
    const cy = Math.floor((ny - bounds.y) / cellSize);
    const gi = px.length;
    px.push(nx);
    py.push(ny);
    grid[cy * gw + cx] = gi;
    active.push(gi);
  };

  // Seed point.
  add(
    rng.nextRange(bounds.x, bounds.x + bounds.w),
    rng.nextRange(bounds.y, bounds.y + bounds.h),
  );

  const k = 30;
  while (active.length > 0 && px.length < count) {
    const ai = rng.nextInt(0, active.length - 1);
    const baseIdx = active[ai]!;
    const bx = px[baseIdx]!;
    const by = py[baseIdx]!;
    let placed = false;
    for (let i = 0; i < k; i++) {
      const ang = rng.nextF64() * TAU;
      const rad = r * (1 + rng.nextF64());
      const nx = bx + Math.cos(ang) * rad;
      const ny = by + Math.sin(ang) * rad;
      if (
        nx >= bounds.x &&
        nx <= bounds.x + bounds.w &&
        ny >= bounds.y &&
        ny <= bounds.y + bounds.h &&
        fits(nx, ny)
      ) {
        add(nx, ny);
        placed = true;
        break;
      }
    }
    if (!placed) {
      active[ai] = active[active.length - 1]!;
      active.pop();
    }
  }

  // Truncate to exactly `count` if we overshot (safe; normally px.length === count).
  const n = Math.min(px.length, count);

  // Assign weighted kinds + scales deterministically, in placement order.
  const totalWeight = kinds.reduce((s, kd) => s + Math.max(0, kd.weight), 0);
  const result: ScatterPoint[] = [];
  for (let i = 0; i < n; i++) {
    const x = px[i]!;
    const y = py[i]!;
    let kind = kinds[0]!.kind;
    if (totalWeight > 0 && kinds.length > 1) {
      let roll = rng.nextF64() * totalWeight;
      for (const kd of kinds) {
        roll -= Math.max(0, kd.weight);
        if (roll <= 0) {
          kind = kd.kind;
          break;
        }
      }
    }
    const scale = rng.nextRange(minScale, maxScale);
    result.push({ x, y, kind, scale });
  }
  return result;
}
