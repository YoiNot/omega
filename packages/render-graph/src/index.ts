/**
 * @omega/render-graph — public surface.
 *
 * Composable post-FX graph for the browser renderer: passes are wired by id,
 * executed in topological order, against a deterministic FBO pool. The actual
 * GL draw calls live in the backend (apps/web or @omega/render); this package
 * is the orchestration layer — pure, Node-testable, seed-deterministic.
 */
export type { RenderPass, PassContext, PassTarget, TextureRef } from './pass.js';
export { FramebufferPool, type FboSpec, type PooledFbo } from './fbo.js';
export { RenderGraph } from './graph.js';
export { ComposePass, type ComposeInput } from './compose.js';
