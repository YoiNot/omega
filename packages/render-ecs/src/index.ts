/**
 * @omega/render-ecs — public surface.
 *
 * Integration package: makes the @omega/render `Renderer` consume an
 * @omega/ecs `World`. Queries over renderable components produce deterministic
 * draw calls, tick after tick.
 */

export {
  Renderable,
  Transform,
  type RenderableData,
  type TransformData,
  type DrawItem,
  type RGBA,
  type MeshData,
  type Camera,
  type Vec3,
  type Mat4,
  type EntityId,
} from './components.js';

export {
  extractDrawList,
  modelMatrix,
  projectModel,
  drawOrder,
  applyMatrix,
} from './drawlist.js';

export {
  EcsRenderer,
  type MeshResolver,
} from './ecs-renderer.js';
