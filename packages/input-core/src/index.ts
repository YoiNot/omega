/**
 * @omega/input-core — public API.
 *
 * Deterministic, frame-stable input snapshots decoupled from DOM time.
 */

export type { InputFrame, Windowish } from './types.js';
export { InputState, collectFrame, keyId } from './state.js';
export { InputBuffer } from './buffer.js';
export { createInputSource } from './source.js';
export type { InputSource } from './source.js';
