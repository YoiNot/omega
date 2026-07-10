/**
 * @omega/render — deterministic LOD selection.
 *
 * `selectLodLevel` is a pure function of (distance to mesh centre, split
 * thresholds, level count). No clock/ambient state is read, so identical inputs
 * always yield the identical level — required for stable, replayable command
 * encodings. The selection is monotonically non-decreasing in distance (farther
 * => coarser level) which the package tests assert.
 *
 * Thresholds are *intervals*: a level L is used while
 *   thresholds[L-1] <= distance < thresholds[L]   (thresholds[-1] = 0)
 * Beyond the last threshold the coarsest level (levels.length - 1) is used.
 */

import type { LodMesh, MeshLodLevel } from './lod-types.js';

/**
 * Pick an LOD index for `distance` (camera-to-centre, world units).
 *
 * @param distance   non-negative distance from camera to mesh centre.
 * @param thresholds per-level upper bounds (ascending). Length should be
 *                   `levels - 1` (the coarsest level needs no bound — it is the
 *                   catch-all). Values are clamped to be ascending at runtime so a
 *                   mis-authored list never produces a non-monotonic mapping.
 * @param levelCount total number of levels (>= 1).
 * @returns index in [0, levelCount-1].
 */
export function selectLodLevel(
  distance: number,
  thresholds: readonly number[],
  levelCount: number,
): number {
  if (levelCount <= 1) return 0;
  const d = distance < 0 ? 0 : distance;
  let idx = 0;
  let prev = 0;
  // Walk thresholds in ascending order; promote `idx` while d exceeds bound.
  for (let i = 0; i < thresholds.length && i < levelCount - 1; i++) {
    const bound = thresholds[i]!;
    // Guard against non-monotonic authoring: never let a bound drop below prev.
    const eff = bound > prev ? bound : prev;
    if (d >= eff) {
      idx = i + 1;
      prev = eff;
    } else {
      break;
    }
  }
  return idx;
}

/** Convenience: select a level for a whole {@link LodMesh}. */
export function selectLod(mesh: LodMesh, distance: number): number {
  return selectLodLevel(distance, defaultThresholds(mesh.levels.length), mesh.levels.length);
}

/**
 * Deterministic default thresholds for `n` levels: an exponential ramp so the
 * first cascade keeps lots of detail and coarser bands widen with distance. The
 * exact formula is fixed (no RNG/time) so tests can pin it.
 */
export function defaultThresholds(n: number): number[] {
  const out: number[] = [];
  for (let i = 1; i < n; i++) {
    out.push(Math.round(8 * Math.pow(1.7, i - 1) * 10) / 10);
  }
  return out;
}

/**
 * Build an {@link LodMesh} from 2+ heightmaps of descending resolution that all
 * describe the same logical surface. Index 0 is the finest (largest) heightmap.
 * `center` is in world space (col= x, row= z centring adopted by the caller).
 * Pure & deterministic.
 */
export function buildLodMesh(
  baseId: string,
  center: { x: number; y: number; z: number },
  levels: { mesh: MeshLodLevel['mesh']; heightScale?: number }[],
): LodMesh {
  const lods: MeshLodLevel[] = levels.map((lv) => ({
    mesh: lv.mesh,
    triangleCount: lv.mesh.indexCount / 3,
    detail: Math.sqrt(lv.mesh.vertexCount),
  }));
  return {
    baseId,
    center: { x: center.x, y: center.y, z: center.z } as any,
    levels: lods,
  };
}

/** Triangle-count reduction of a coarser level relative to the finest. */
export function lodReductionFactor(mesh: LodMesh): number {
  if (mesh.levels.length < 2) return 1;
  const fine = mesh.levels[0]!.triangleCount;
  const coarse = mesh.levels[mesh.levels.length - 1]!.triangleCount;
  return fine > 0 ? fine / coarse : 1;
}
