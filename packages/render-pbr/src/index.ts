/**
 * @omega/render-pbr — public surface.
 *
 * Deterministic, backend-agnostic PBR + particles + volumetric clouds + LOD
 * helper math. The package owns NO GL context; it produces data (BRDF radiance,
 * particle buffers, cloud density fields, cascade matrices) that a WebGL2 or
 * WebGPU `Renderer` consumes. Everything is a pure function of its inputs.
 */

export * from './brdf.js';
export * from './shadows.js';
export * from './particles.js';
export * from './clouds.js';
export * from './apply.js';
