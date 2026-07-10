/**
 * @omega/render-pbr — apply helpers (glue onto the @omega/render Renderer).
 *
 * These are the deterministic, backend-agnostic "apply" functions the task asks
 * for: given a mesh/LOD/particle/cloud + a `Renderer`, they drive the
 * correct `render`-family call. They never spawn a wall clock or RNG of their
 * own — particle/cloud state is supplied by the deterministic `ParticleSystem`
 * / `CloudField`. So the command encodings remain a pure function of world
 * state, satisfying the "same world => same commands" contract.
 */

import type { Renderer, PbrRenderInput, LodMesh, MeshData } from '@omega/render';
import {
  defaultPbrMaterial,
  defaultSun,
  defaultEnvironment,
  type PbrMaterial,
  type DirectionalLight,
  type EnvironmentLight,
} from '@omega/render';

/** A fully-defaulted PBR input (sensible sun + ambient + grey material). */
export function defaultPbrInput(
  overrides: Partial<{
    material: PbrMaterial;
    sun: DirectionalLight;
    environment: EnvironmentLight;
  }> = {},
): PbrRenderInput {
  return {
    material: overrides.material ?? defaultPbrMaterial(),
    sun: overrides.sun ?? defaultSun(),
    environment: overrides.environment ?? defaultEnvironment(),
  };
}

/** Apply a single PBR mesh through the renderer. */
export function applyPbr(
  renderer: Renderer,
  mesh: MeshData,
  camera: import('@omega/render').Camera,
  input: PbrRenderInput,
): void {
  renderer.renderPbr(mesh, camera, input);
}

/** Apply a LOD chain: select a level (pure) then PBR-render it. */
export function applyLod(
  renderer: Renderer,
  lod: LodMesh,
  camera: import('@omega/render').Camera,
  input: PbrRenderInput,
): void {
  renderer.renderLod(lod, camera, input);
}
