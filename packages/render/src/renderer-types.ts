import type { MeshData } from './mesh.js';
import type { Camera } from './camera.js';
import type { ColorGradient } from './color.js';
import type { LodMesh } from './lod-types.js';
import type { PbrMaterial, DirectionalLight, EnvironmentLight } from './pbr-types.js';

/** Lighting + material payload for a PBR draw (pure data, no clock). */
export interface PbrRenderInput {
  material: PbrMaterial;
  sun: DirectionalLight;
  environment: EnvironmentLight;
}

/**
 * Backend-agnostic terrain renderer contract.
 *
 * Both {@link WebGPURenderer} and {@link WebGL2Renderer} implement this so the
 * rest of the engine can swap backends without changing call sites.
 *
 * Two draw families share the contract:
 *  - `render`       vertex-colored gradient path (existing, kept for parity).
 *  - `renderPbr`    physically-based path (albedo/metallic/roughness/normal +
 *                     directional sun + ambient/environment) from a single
 *                     {@link PbrRenderInput}.
 *  - `renderLod`    dispatches a {@link LodMesh} by distance — selects a level
 *                     (pure function of camera-to-centre distance) and forwards to
 *                     `renderPbr`. Distance selection is clock-free, so the same
 *                     camera always produces the same command encoding.
 */
export interface Renderer {
  /** Vertex-colored gradient render (legacy parity path). */
  render(mesh: MeshData, camera: Camera, gradient: ColorGradient): void;

  /** Physically-based render of one mesh with the supplied material/lights. */
  renderPbr(mesh: MeshData, camera: Camera, input: PbrRenderInput): void;

  /** LOD dispatch: pick a level by camera distance, then PBR-render it. */
  renderLod(lod: LodMesh, camera: Camera, input: PbrRenderInput): void;

  /** Resize the drawing surface to `width` x `height` device pixels. */
  resize(width: number, height: number): void;

  /** Release any GPU resources / contexts held by the renderer. */
  dispose(): void;
}
