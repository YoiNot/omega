import type { MeshData } from './mesh.js';
import type { Camera } from './camera.js';
import type { ColorGradient } from './color.js';

/**
 * Backend-agnostic terrain renderer contract.
 *
 * Both {@link WebGPURenderer} and {@link WebGL2Renderer} implement this so the
 * rest of the engine can swap backends without changing call sites.
 */
export interface Renderer {
  /**
   * Render one frame: `mesh` drawn from `camera`, vertex-colored by `gradient`.
   * Pure-record implementations (Node tests) just log the high-level commands.
   */
  render(mesh: MeshData, camera: Camera, gradient: ColorGradient): void;

  /** Resize the drawing surface to `width` x `height` device pixels. */
  resize(width: number, height: number): void;

  /** Release any GPU resources / contexts held by the renderer. */
  dispose(): void;
}
