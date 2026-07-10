/**
 * @omega/render-ecs — component definitions shared by the ECS<->Render bridge.
 *
 * These are plain ECS component types; they carry no rendering logic. They are
 * consumed by {@link extractDrawList} and {@link EcsRenderer} to turn world
 * state into deterministic draw calls.
 */

import { defineComponent } from '@omega/ecs';
import type { EntityId } from '@omega/ecs';
import type { RGBA, MeshData, Camera } from '@omega/render';
import type { Vec3, Mat4 } from '@omega/engine-math';

/** Re-exported render + math types so consumers import from one place. */
export type { RGBA, MeshData, Camera, Vec3, Mat4, EntityId };

/**
 * A renderable entity. `meshId` selects the mesh (stored/looked up by the
 * caller's mesh registry), `color` tints it, and `visible` (default true)
 * opts the entity out of the draw list when false.
 */
export interface RenderableData {
  meshId: string;
  color: RGBA;
  visible?: boolean;
}

/** Component marking an entity as renderable. */
export const Renderable = defineComponent<RenderableData>('Renderable');

/**
 * Optional local transform for a renderable entity. `rot` and `scale` default
 * to identity when absent. Position/rotation/scale are in world units.
 */
export interface TransformData {
  pos: Vec3;
  rot?: Vec3; // euler XYZ in radians
  scale?: Vec3;
}

/** Component carrying an entity's local transform. */
export const Transform = defineComponent<TransformData>('Transform');

/** A single resolved draw item produced from the world for one tick. */
export interface DrawItem {
  /** Ascending entity id (deterministic ordering). */
  entity: EntityId;
  /** Mesh selector, opaque to the bridge. */
  meshId: string;
  /** Vertex color tint of the item, in [0,255] RGBA. */
  color: RGBA;
  /** Model matrix transforming the mesh into world space. */
  transform: Mat4;
}
