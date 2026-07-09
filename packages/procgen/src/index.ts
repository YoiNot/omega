/**
 * @omega/procgen — deterministic, seed-driven feature scattering.
 *
 * Built on top of @omega/world-gen heightmaps. Every output is a pure function
 * of its seed, so worlds are bit-for-bit reproducible.
 */

export * from './rng.js';
export * from './biome.js';
export * from './scatter.js';
