/**
 * @omega/geology — deterministic plate tectonics & hydraulic erosion.
 *
 * Public API for the geology simulation package. Everything here is a pure
 * function of its seed / RNG state and free of ambient (non-deterministic)
 * sources. See docs/adr/0001-determinism.md.
 */

export * from './plates.js';
export * from './erosion.js';
