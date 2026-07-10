/**
 * @omega/replay — deterministic record/playback of an ECS simulation.
 *
 * Builds on @omega/save (world serialization) and @omega/net (snapshot
 * encode/decode + wire format). See recording.ts / recorder.ts / playback.ts
 * for the determinism contract.
 */

export {
  REPLAY_MAGIC,
  REPLAY_FORMAT_VERSION,
  ecsSnapshotToNet,
  netSnapshotToEcs,
  serializeRecording,
  loadRecording,
} from './recording.js';
export type {
  Recording,
  RecordingFrame,
} from './recording.js';

export { Recorder } from './recorder.js';
export type { RecorderOptions } from './recorder.js';

export { Playback } from './playback.js';
