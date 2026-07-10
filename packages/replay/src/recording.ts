/**
 * @omega/replay — deterministic record/playback of an ECS simulation.
 *
 * A `Recording` is an ordered list of `RecordingFrame`s. Each frame captures a
 * full snapshot of the world (via @omega/save's `snapshotWorld`) at a specific
 * simulation tick, encoded with @omega/net's `encodeSnapshot`, plus an optional
 * engine-RNG state checkpoint (via `Rng.state()`).
 *
 * Determinism contract
 * --------------------
 * - No `Date.now()`, `Math.random()`, or wall-clock in the record/serialize/
 *   load/play path. `serializeRecording` takes `createdAt` as an explicit
 *   argument (forwarded to @omega/save's `SaveWriter`) so byte output is
 *   reproducible.
 * - World snapshots are captured by component *name*; the same names are used on
 *   restore, so entity ids are re-allocated identically from an empty world
 *   (see @omega/save's ecs-snapshot tests) and the replay is bit-for-bit.
 * - The engine RNG is NOT advanced by replay; only its captured state is
 *   exposed so a consumer can rewind the live RNG in lock-step if desired.
 */

import type { WorldSnapshot as EcsWorldSnapshot } from '@omega/save';
import type { WorldSnapshot as NetWorldSnapshot } from '@omega/net';
import { SaveWriter, SaveReader } from '@omega/save';
import {
  makeSnapshot,
  asFloat32,
} from '@omega/net';

/** 'RPLY' big-endian as a u32 constant. */
export const REPLAY_MAGIC = 0x52504c59;
/** Current on-disk format version. */
export const REPLAY_FORMAT_VERSION = 1;

/**
 * A single recorded tick.
 *
 * `worldSnapshot` stores the @omega/net-encoded bytes of the ECS snapshot as a
 * plain `number[]` so it survives JSON serialization and the @omega/save wire
 * format without precision loss. `dt` is the fixed timestep of the frame.
 * `rngState` is the engine `Rng.state()` snapshot at this tick, or undefined
 * when the sim recorded no RNG state.
 */
export interface RecordingFrame {
  tick: number;
  worldSnapshot: number[];
  dt: number;
  rngState?: string[];
}

/** A complete deterministic recording of a simulation run. */
export interface Recording {
  magic: number;
  version: number;
  /** Seed as a decimal string (JSON-safe; the u64 form is carried in the file header). */
  seedLow: string;
  seedHigh: string;
  componentNames: string[];
  frames: RecordingFrame[];
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

/**
 * Encode an ECS world snapshot into a @omega/net `WorldSnapshot`. The JSON
 * payload is length-prefixed and zero-padded to a multiple of 4 bytes so it
 * round-trips exactly through `encodeSnapshot`/`decodeSnapshot` (which treat
 * the payload as Float32) regardless of trailing zero bytes.
 */
export function ecsSnapshotToNet(snap: EcsWorldSnapshot, tick: number): NetWorldSnapshot {
  const payload = textEncoder.encode(JSON.stringify(snap));
  const body = new Uint8Array(4 + payload.length);
  new DataView(body.buffer).setUint32(0, payload.length, true);
  body.set(payload, 4);
  const paddedLen = Math.ceil(body.length / 4) * 4;
  const padded = new Uint8Array(paddedLen);
  padded.set(body);
  const f32 = new Float32Array(padded.buffer, padded.byteOffset, padded.byteLength / 4);
  return makeSnapshot(tick, f32);
}

/** Inverse of {@link ecsSnapshotToNet}. */
export function netSnapshotToEcs(snap: NetWorldSnapshot): EcsWorldSnapshot {
  const f = asFloat32(snap);
  const body = new Uint8Array(f.buffer, f.byteOffset, f.length * 4);
  const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
  const len = view.getUint32(0, true);
  if (body.length < 4 + len) {
    throw new RangeError('replay: truncated snapshot payload');
  }
  const payload = body.subarray(4, 4 + len);
  return JSON.parse(textDecoder.decode(payload)) as EcsWorldSnapshot;
}

/** Serialize a `Recording` to deterministic bytes (caller supplies `createdAt`). */
export function serializeRecording(rec: Recording, createdAt: number): Uint8Array {
  if (rec.magic !== REPLAY_MAGIC) throw new Error('replay: bad recording magic');
  // The recording DATA must be JSON-serializable (no BigInt), so seeds live in
  // it as decimal strings; the authoritative u64 seeds ride in the save header.
  return SaveWriter.write(rec, createdAt, BigInt(rec.seedLow), BigInt(rec.seedHigh));
}

/** Parse deterministic bytes back into a `Recording`. Throws on bad magic/version. */
export function loadRecording(bytes: Uint8Array): Recording {
  const file = SaveReader.read<Recording>(bytes);
  const rec = file.data;
  if (rec.magic !== REPLAY_MAGIC) {
    throw new Error(
      `replay: bad magic: expected 0x${REPLAY_MAGIC.toString(16)}, got 0x${rec.magic.toString(16)}`,
    );
  }
  if (rec.version !== REPLAY_FORMAT_VERSION) {
    throw new Error(
      `replay: unsupported version ${rec.version} (expected ${REPLAY_FORMAT_VERSION})`,
    );
  }
  if (!Array.isArray(rec.frames) || !Array.isArray(rec.componentNames)) {
    throw new Error('replay: malformed recording');
  }
  // Restore the seed from the (authoritative) save header as decimal strings.
  rec.seedLow = file.header.seedLow.toString();
  rec.seedHigh = file.header.seedHigh.toString();
  return rec;
}
