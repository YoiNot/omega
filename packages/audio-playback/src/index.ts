/**
 * @omega/audio-playback — the playback layer for PROJECT OMEGA's
 * deterministic spatial audio system (Roadmap §16).
 *
 * `@omega/audio-spatial` computes the *parameters* (gain/pan/distance per
 * source relative to a listener). This package consumes those parameters and
 * is the only layer that touches Web Audio. It is deterministic up to the
 * sample-output boundary: graph construction, gain/pan wiring, mixdown matrix,
 * and asset decode are all pure functions of their inputs and are Node-tested
 * via an injected `AudioContextLike` (mock / `OfflineAudioContext`).
 *
 * Public surface:
 *   - graph:      deterministic per-source node configuration types
 *   - adapter:    `buildPlaybackGraph` — spatial params -> Web Audio graph
 *   - mixdown:    `computeMixMatrix` — merge multiple model outputs
 *   - assets:     deterministic buffer-based sample decode/encode
 */

export * from './graph.js';
export * from './adapter.js';
export * from './mixdown.js';
export * from './assets.js';
