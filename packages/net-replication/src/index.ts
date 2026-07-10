/**
 * @omega/net-replication — ECS snapshot replication over @omega/net.
 *
 * Adapts @omega/ecs + @omega/sim for the @omega/net server-authoritative layer:
 * serialize a world into the `WorldSnapshot` the net layer already consumes, and
 * reconcile remote snapshots back onto a client world. No transport, commands,
 * or reconciliation are reimplemented here — only the ECS <-> snapshot glue.
 */

export {
  Codec,
  BinaryWriter,
  BinaryReader,
  worldToSnapshot,
  snapshotToWorld,
} from './codec.js';
export type {
  LogicalComponent,
  LogicalEntity,
  LogicalSnapshot,
} from './codec.js';
export type { WorldSnapshot } from '@omega/net';

export {
  ReplicatedServer,
  type ServerSystem,
  type ReplicatedServerOptions,
} from './server.js';

export {
  ReplicatedClient,
  type ReplicatedClientOptions,
} from './client.js';

export {
  rollback,
  hasDiverged,
  RollbackStage,
} from './rollback.js';

// Re-export the underlying net building blocks for convenience so consumers
// can build transports / snapshots without a second import line.
export {
  ServerAuthoritativeSim,
  type StepFn,
  type SeedFn,
  type SimOptions,
  type InputCommand,
  LoopbackTransport,
  type Transport,
  SnapshotBuffer,
  interpolate,
  encodeSnapshot,
  decodeSnapshot,
  asFloat32,
  makeSnapshot,
} from '@omega/net';

export { World, defineComponent, type ComponentDef, type EntityId } from '@omega/ecs';
export { Rng } from '@omega/engine-core';
export { Simulation } from '@omega/sim';
