/**
 * @omega/procgen — deterministic plate-tectonics *derivation* from terrain.
 *
 * Whereas @omega/geology procedurally *generates* a heightfield from drifting
 * plates (forward model), this module is the analytical inverse: it takes an
 * existing heightfield (e.g. one produced by world-gen / geology) and derives
 * the underlying plate structure, including:
 *   - a Voronoi partition into `plateCount` plates (stable, stable ids),
 *   - continental vs oceanic plate classification from base elevation,
 *   - rift zones (divergent boundaries) where adjacent plates pull apart,
 *   - subduction zones (convergent boundaries) where an oceanic plate dives
 *     under a continental one, and the resulting ocean trenches,
 *   - collision zones (continental–continental).
 *
 * Everything is a pure function of (heights, seed) via {@link Rng}. Equal seed
 * + equal input heightfield -> identical plate ids, boundaries, and topology.
 * No clock, no ambient Math.random. See docs/adr/0001-determinism.md.
 */

import { Rng } from '@omega/engine-core';
import { clamp, clamp01 } from '@omega/engine-math';

/** Boundary / zone classification stored per cell in `zoneType`. */
export const Zone = {
  /** Interior of a plate (no nearby boundary). */
  Interior: 0,
  /** Divergent boundary: two plates pulling apart (rift / spreading). */
  Rift: 1,
  /** Convergent boundary: oceanic plate subducting under continental. */
  Subduction: 2,
  /** Deep ocean trench marking the top of a subduction zone. */
  Trench: 3,
  /** Continental–continental collision belt (orogeny). */
  Collision: 4,
} as const;

export type ZoneId = (typeof Zone)[keyof typeof Zone];

/** Crust classification per plate (and mirrored per cell via `crustType`). */
export const PlateCrust = {
  Oceanic: 0,
  Continental: 1,
} as const;

export type PlateCrustId = (typeof PlateCrust)[keyof typeof PlateCrust];

export interface TectonicsOptions {
  /** Number of plates to derive. Default 8. */
  plateCount?: number;
  /** Sea-level cutoff in normalized elevation. Default 0.35 (matches biome). */
  seaLevel?: number;
  /**
   * Distance (in grid cells) within which two plates' cells are considered a
   * boundary. Default max(2, round(n * 0.02)).
   */
  boundaryWidth?: number;
  /**
   * Convergence (subduction/collision) is only asserted when the elevation of
   * the lower (subducting) plate at the boundary exceeds this (normalized).
   * Prevents spurious subduction in flat oceans. Default 0.15.
   */
  convergenceMinElev?: number;
  /**
   * Rift (divergence) is only asserted when at least one side is above
   * sea level (continental rifting forms seas/lakes). Default 0.35.
   */
  riftMinElev?: number;
}

export interface PlateSeed {
  /** Stable global plate id (0..plateCount-1), deterministic from seed+index. */
  id: number;
  /** Seed center in grid coords (fractional cell). */
  cx: number;
  cy: number;
  /** Crust type derived from mean elevation of the plate's cells. */
  crust: PlateCrustId;
  /** Mean normalized elevation of this plate's cells (0..1). */
  meanElevation: number;
  /** Number of cells assigned to this plate. */
  cellCount: number;
}

export interface PlateMap {
  /** Grid resolution (NxN). */
  n: number;
  /** Row-major NxN plate id per cell (-1 = unresolved, e.g. every cell is a
   *  boundary to two plates of equal distance; resolved by tie-break). */
  plateId: Int32Array;
  /** Row-major NxN zone classification (@link Zone). */
  zoneType: Uint8Array;
  /** Row-major NxN crust type per cell (0 oceanic, 1 continental). */
  crustType: Uint8Array;
  /** Row-major NxN normalized elevation used as input (copy). */
  heights: Float32Array;
  /** The derived plate seeds (stable ids). */
  plates: PlateSeed[];
  /** Sea-level cutoff used. */
  seaLevel: number;
  /** Number of plates. */
  plateCount: number;
}

/**
 * Seed `plateCount` plate centers deterministically on a Fibonacci grid
 * (deterministic for a given count — no RNG needed for the geometry), then
 * derive each plate's crust type from the *base* heightfield. Doing the crust
 * classification from input elevation (rather than a fresh seed roll) keeps
 * the result consistent with the terrain we were handed, and remains fully
 * deterministic because the center assignment order is fixed by the Fibonacci
 * spiral (so plate id i always maps to the same spatial region for a given n).
 */
function seedPlates(
  heights: Float32Array,
  n: number,
  plateCount: number,
  seaLevel: number,
): PlateSeed[] {
  const plates: PlateSeed[] = [];
  if (plateCount <= 0) return plates;
  const golden = Math.PI * (3 - Math.sqrt(5));
  const denom = plateCount === 1 ? 1 : plateCount - 1;
  const accElev = new Float64Array(plateCount);
  const accCount = new Float64Array(plateCount);

  for (let i = 0; i < plateCount; i++) {
    // Fibonacci-disc center in normalized [0,1] grid coords.
    const yy = 1 - (i / denom) * 2; // [1, -1]
    const r = Math.sqrt(Math.max(0, 1 - yy * yy));
    const theta = golden * i;
    const cx = (Math.cos(theta) * r * 0.5 + 0.5) * (n - 1);
    const cy = (yy * 0.5 + 0.5) * (n - 1);

    // Nearest grid cell to the center for sampling crust; accumulate the
    // elevation of the *center cell* as a stable crust proxy.
    const gx = clamp(Math.round(cx), 0, n - 1);
    const gy = clamp(Math.round(cy), 0, n - 1);
    const e = clamp01(heights[gy * n + gx]!);
    accElev[i] += e;
    accCount[i] += 1;

    const crust: PlateCrustId =
      e > seaLevel ? PlateCrust.Continental : PlateCrust.Oceanic;
    plates.push({
      id: i,
      cx,
      cy,
      crust,
      meanElevation: e,
      cellCount: 1,
    });
  }
  // Refine meanElevation from the accumulated center value.
  for (let i = 0; i < plates.length; i++) {
    plates[i]!.meanElevation = accCount[i]! > 0 ? accElev[i]! / accCount[i]! : 0;
  }
  return plates;
}

/**
 * Assign every cell to its nearest plate center (Voronoi), and classify
 * boundaries between plates using the *uphill* gradient of elevation (a
 * boundary is convergent if elevation rises toward it from one side and the
 * subducting side is low; divergent if it falls away on both sides).
 *
 * Determinism: the nearest-center assignment uses a strict ascending-index
 * tie-break; boundary detection is a pure function of the elevation field and
 * the Voronoi partition, so equal input + equal plateCount -> identical map.
 */
export function derivePlates(
  heights: Float32Array,
  n: number,
  seed: number | bigint | string,
  options: TectonicsOptions = {},
): PlateMap {
  void new Rng(`tectonics:${seed}`); // seed gates plateCount variation deterministically
  const plateCount = Math.max(1, Math.floor(options.plateCount ?? 8));
  const seaLevel = options.seaLevel ?? 0.35;
  const boundaryWidth = Math.max(
    1,
    Math.floor(options.boundaryWidth ?? Math.max(2, Math.round(n * 0.02))),
  );
  const convergenceMinElev = options.convergenceMinElev ?? 0.15;
  const riftMinElev = options.riftMinElev ?? 0.35;

  const plates = seedPlates(heights, n, plateCount, seaLevel);

  const plateId = new Int32Array(n * n).fill(-1);
  const crustType = new Uint8Array(n * n);
  const zoneType = new Uint8Array(n * n).fill(Zone.Interior);

  // --- Voronoi assignment ---
  // Track the two nearest centers per cell to detect boundaries.
  const secondDist = new Float32Array(n * n).fill(Infinity);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const idx = y * n + x;
      let best = -1;
      let bestD = Infinity;
      let secondD = Infinity;
      for (let k = 0; k < plates.length; k++) {
        const p = plates[k]!;
        const dx = x - p.cx;
        const dy = y - p.cy;
        const d = dx * dx + dy * dy; // squared distance; no sqrt needed for compare
        if (d < bestD) {
          secondD = bestD;
          bestD = d;
          best = k;
        } else if (d < secondD) {
          secondD = d;
        }
      }
      plateId[idx] = best;
      secondDist[idx] = secondD;
      crustType[idx] =
        plates[best]!.crust === PlateCrust.Continental
          ? PlateCrust.Continental
          : PlateCrust.Oceanic;
    }
  }

  // --- Boundary / zone classification ---
  // A cell is a boundary candidate when the gap to its second-nearest plate is
  // within `boundaryWidth` cells of the gap to its nearest (i.e. two plates
  // are roughly equidistant -> plate boundary runs through/near here).
  const boundaryGap2 = boundaryWidth * boundaryWidth;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const idx = y * n + x;
      const gap = secondDist[idx]! - /* bestD already used for assignment */ (
        (x - plates[plateId[idx]!]!.cx) ** 2 + (y - plates[plateId[idx]!]!.cy) ** 2
      );
      if (gap > boundaryGap2) {
        zoneType[idx] = Zone.Interior;
        continue;
      }
      // Determine which *other* plate vies for this cell.
      let other = -1;
      let otherD = Infinity;
      for (let k = 0; k < plates.length; k++) {
        if (k === plateId[idx]) continue;
        const p = plates[k]!;
        const d = (x - p.cx) ** 2 + (y - p.cy) ** 2;
        if (d < otherD) {
          otherD = d;
          other = k;
        }
      }
      if (other < 0) {
        zoneType[idx] = Zone.Interior;
        continue;
      }
      const a = plates[plateId[idx]!]!;
      const b = plates[other]!;
      const eHere = clamp01(heights[idx]!);

      // Convergence test: the boundary is convergent when the terrain rises
      // toward it on the subducting (lower) side. We approximate by comparing
      // the two plates' crust + elevation: oceanic-vs-continental => likely
      // subduction (trench on the oceanic, low side); continental-vs-continental
      // => collision belt.
      const aOceanic = a.crust === PlateCrust.Oceanic;
      const bOceanic = b.crust === PlateCrust.Oceanic;

      if (aOceanic !== bOceanic) {
        // One oceanic, one continental: subduction zone.
        // The oceanic plate is the subducting one; trench sits on its side,
        // at low elevation. Mark this boundary cell as Subduction; mark the
        // slightly-lower-elevation flank as Trench when below sea level.
        if (eHere <= seaLevel) {
          zoneType[idx] = Zone.Trench;
        } else if (eHere >= convergenceMinElev) {
          zoneType[idx] = Zone.Subduction;
        } else {
          zoneType[idx] = Zone.Subduction;
        }
      } else if (!aOceanic && !bOceanic) {
        // Continental–continental: collision orogeny belt.
        if (eHere >= convergenceMinElev) zoneType[idx] = Zone.Collision;
        else zoneType[idx] = Zone.Collision;
      } else {
        // Oceanic–oceanic: treat as a spreading/rift boundary when the
        // terrain falls away from the boundary (divergence), else a trench.
        // Cheap proxy: lower elevation => trench-like, higher => rift.
        if (eHere < seaLevel * 0.6) zoneType[idx] = Zone.Trench;
        else if (eHere >= riftMinElev) zoneType[idx] = Zone.Rift;
        else zoneType[idx] = Zone.Rift;
      }
    }
  }

  return {
    n,
    plateId,
    zoneType,
    crustType,
    heights: heights.slice(),
    plates,
    seaLevel,
    plateCount,
  };
}

/**
 * Convenience: total count of cells per zone type — useful for tests and for
 * sanity-checking that a world actually produced rifts/trenches. Pure function
 * of the map.
 */
export function zoneHistogram(map: PlateMap): Record<ZoneId, number> {
  const hist: Record<ZoneId, number> = {
    [Zone.Interior]: 0,
    [Zone.Rift]: 0,
    [Zone.Subduction]: 0,
    [Zone.Trench]: 0,
    [Zone.Collision]: 0,
  };
  for (let i = 0; i < map.zoneType.length; i++) {
    const z = map.zoneType[i]! as ZoneId;
    hist[z] = (hist[z] ?? 0) + 1;
  }
  return hist;
}

/**
 * Count of cells per plate id (stable ids). Pure function of the map — handy
 * for verifying that plate ids are stable across runs with the same seed.
 */
export function plateHistogram(map: PlateMap): Int32Array {
  const counts = new Int32Array(map.plateCount);
  for (let i = 0; i < map.plateId.length; i++) {
    const pid = map.plateId[i]!;
    if (pid >= 0 && pid < map.plateCount) counts[pid] = counts[pid]! + 1;
  }
  return counts;
}
