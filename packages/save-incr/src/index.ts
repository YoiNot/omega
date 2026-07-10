/**
 * @omega/save-incr — incremental snapshots, recovery, and cloud-sync adapter
 * for PROJECT OMEGA (Roadmap §10).
 *
 * Builds on @omega/save (SaveWriter/Reader, BinaryWriter/Reader, RLE compress,
 * snapshotWorld/restoreWorld) and adds:
 *  - deterministic JSON delta snapshots (`incremental.ts`)
 *  - corruption recovery (`recovery.ts`)
 *  - a transport-agnostic sync adapter + in-memory stub (`sync.ts`)
 *
 * Determinism contract: no `Date.now()`/`Math.random()` in any code path; all
 * time-like inputs (createdAt, generation) are passed in explicitly by the
 * caller. Identical inputs always produce byte-identical outputs.
 */

export {
  computeChecksum,
  writeChecksum,
  readChecksum,
  checksumMatches,
} from './checksum.js';

export {
  INC_MAGIC,
  INC_FORMAT_VERSION,
  CorruptSaveError,
  computeJsonDelta,
  applyJsonDelta,
  jsonEqual,
  deepCloneJson,
  comparePaths,
  encodeIncrementalFile,
  decodeIncrementalFile,
  applyIncremental,
  foldIncrementalBestEffort,
  IncrementalSaver,
} from './incremental.js';
export type {
  JsonPath,
  JsonDelta,
  IncrementalHeader,
  IncrementalFrame,
  IncrementalFile,
  IncrementalSaverOptions,
} from './incremental.js';

export {
  recoverPlainSave,
  recoverIncremental,
} from './recovery.js';
export type {
  PlainRecoveryResult,
  IncrementalRecoveryResult,
} from './recovery.js';

export {
  contentChecksum,
  reconcile,
  synchronize,
  MemorySyncAdapter,
} from './sync.js';
export type {
  SyncedSnapshot,
  SyncResult,
  SaveSyncAdapter,
} from './sync.js';
