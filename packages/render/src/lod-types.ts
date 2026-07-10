/**
 * @omega/render — Level-of-Detail mesh container.
 *
 * A {@link LodMesh} groups several {@link MeshLodLevel}s of the same geometry at
 * decreasing resolution. Index 0 is the HIGHEST detail. Distance-based selection
 * (see {@link selectLodLevel} in ./lod.js) picks an index; higher distance ->
 * higher index -> coarser mesh. The selection is a pure function of distance and
 * thresholds (no clock), so the same camera position always dispatches the same
 * level — a hard requirement for deterministic command encoding.
 */

import type { MeshData } from './mesh.js';
import type { Vec3 } from '@omega/engine-math';

/** One resolution level of an LOD chain. */
export interface MeshLodLevel {
  /** Concrete geometry for this level. */
  mesh: MeshData;
  /** Triangle count (indexCount / 3) — a cost metric, deterministic. */
  triangleCount: number;
  /** Grid edge length (== sqrt(vertexCount) for a regular heightfield). */
  detail: number;
}

/**
 * A distance-LOD chain of one logical mesh.
 *
 * `center` is the world-space point used for camera-distance dispatch (the
 * renderer computes |cameraPos - center| and selects a level).
 */
export interface LodMesh {
  /** Stable id of the logical mesh this chain represents. */
  baseId: string;
  /** World-space centre for LOD distance dispatch. */
  center: Vec3;
  /** Levels, ascending index = descending detail. Index 0 = full detail. */
  levels: MeshLodLevel[];
}
