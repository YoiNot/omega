/**
 * @omega/audio-spatial — deterministic 3D audio parameter model for PROJECT OMEGA.
 *
 * Public surface: the {@link SpatialAudioModel} (pure math: gain / pan / distance
 * from entity positions relative to a listener) and optional ECS integration
 * (an `AudioSource` component + a deterministic system that writes computed
 * params back into a component store). No Web Audio / DOM, no nondeterministic
 * inputs in core logic.
 */

export * from './model.js';
export * from './ecs.js';
