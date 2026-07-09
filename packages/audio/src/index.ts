/**
 * @omega/audio — positional + procedural audio for PROJECT OMEGA.
 *
 * Public surface: structural types, a deterministic spatial mixer, a seeded
 * ambience generator, and pluggable reverb models. All building blocks are
 * Node-testable and free of Web Audio / DOM dependencies.
 */

export * from './types.js';
export * from './spatial.js';
export * from './ambience.js';
export * from './reverb.js';
