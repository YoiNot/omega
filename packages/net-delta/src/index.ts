/**
 * @omega/net-delta — deterministic ECS snapshot delta compression for PROJECT
 * OMEGA multiplayer. Built on top of @omega/net-replication's `Codec` (which
 * owns the ECS <-> wire mapping) so the delta layer stays encoder-agnostic and
 * never re-implements component (de)serialization.
 */

export {
  computeDelta,
  fullDelta,
  encodeDelta,
  decodeDelta,
  applyDeltaTo,
  DeltaCompressor,
} from './delta.js';
export type { Delta, UpdatedEntity } from './delta.js';
