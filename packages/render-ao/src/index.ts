/**
 * @omega/render-ao — public surface for the Spike.
 *
 * Three isolated, deterministic, $0 graphics building blocks:
 *   - determinism: det_* shader-math pins (the "same seed => same pixels" guarantee)
 *   - GBufferPass: minimal G-Buffer (depth + view normals) for screen-space AO
 *   - GTAO: Ground-Truth Ambient Occlusion fragment shader + CPU composite
 *   - bakeEnvMap / sampleEnv: procedural, seeded IBL environment (no HDRI asset)
 *
 * This package is the Spike for "build our own graphics solution" (roadmap
 * option a). It does NOT touch apps/web/src/renderer.ts; if the AO proof lands
 * we either wire it into @omega/render or port it into apps/web.
 */

export * from './determinism';
export * from './gbuffer';
export * from './gtao';
export * from './envmap';
