/**
 * @omega/save-incr — incremental (delta) snapshots over @omega/save.
 *
 * Problem: @omega/save stores a *full* JSON snapshot every time. For long
 * simulation sessions that is wasteful. This module stores only the *delta*
 * between consecutive snapshots, plus periodic full snapshots, in a single
 * deterministic file. Replaying the file reconstructs the final full state
 * exactly.
 *
 * Why a custom JSON delta (not @omega/net-delta)?
 * ------------------------------------------------
 * @omega/net-delta computes deltas over an ECS world projected through a
 * replication `Codec` (`LogicalSnapshot`/`LogicalComponent`), which requires a
 * concrete `World` + component registry. The save layer is intentionally
 * engine-agnostic: a "snapshot" is any JSON-able `unknown`. We therefore
 * implement a small, dependency-free structural JSON delta here and reuse
 * net-delta's *design* (a `full` vs `partial` mode, ascending id/path order,
 * byte-stable framing) rather than its ECS-coupled machinery.
 *
 * Determinism contract
 * --------------------
 * - No `Date.now()`, `Math.random()`, or wall-clock. `createdAt` is always
 *   passed in explicitly (forwarded to the file header / frame stamp).
 * - `computeJsonDelta(a, b)` is a pure function of its inputs and always
 *   produces the same sorted `created`/`updated`/`deleted` arrays (object keys
 *   are emitted in sorted order; array indices in ascending order).
 * - The on-disk frame body is `compress(JSON.stringify(delta))` (RLE from
 *   @omega/save), so two identical snapshot sequences produce byte-identical
 *   files. `applyIncremental(bytes)` reconstructs the final state exactly.
 * - A per-frame FNV-1a checksum (@omega/save-incr `checksum`) catches any
 *   corruption; the recovery module relies on it.
 */

import {
  BinaryWriter,
  BinaryReader,
  compress,
  decompress,
} from '@omega/save';
import { computeChecksum } from './checksum.js';

/** 'INCS' big-endian as a u32 constant. */
export const INC_MAGIC = 0x494e4353;
/** Current on-disk format version. */
export const INC_FORMAT_VERSION = 1;

/** A path into a JSON value: object keys (string) and array indices (number). */
export type JsonPath = Array<string | number>;

/** A structural delta between two JSON states. */
export interface JsonDelta {
  /** New paths (absent in base) and their new values. */
  created: Array<[JsonPath, unknown]>;
  /** Existing paths whose value changed (incl. type changes) and the new value. */
  updated: Array<[JsonPath, unknown]>;
  /** Paths removed from base (no value needed). */
  deleted: JsonPath[];
}

export interface IncrementalHeader {
  magic: number;
  version: number;
  createdAt: number;
  seedLow: bigint;
  seedHigh: bigint;
}

export interface IncrementalFrame {
  /** 0 = no-op (unused placeholder), 1 = partial delta, 2 = full snapshot. */
  mode: 0 | 1 | 2;
  /** The `createdAt` passed to the save call that produced this frame. */
  createdAt: number;
  /** FNV-1a of the (compressed) body bytes, stored for integrity checks. */
  checksum: number;
  /** Compressed body: JSON of `JsonDelta` (mode 1) or the full state (mode 2). */
  body: Uint8Array;
}

export interface IncrementalFile {
  header: IncrementalHeader;
  frames: IncrementalFrame[];
}

export class CorruptSaveError extends Error {
  /** Frame index at which corruption was detected, or -1 for a header error. */
  constructor(message: string, public readonly frameIndex: number = -1) {
    super(message);
    this.name = 'CorruptSaveError';
  }
}

// ---------------------------------------------------------------------------
// JSON helpers
// ---------------------------------------------------------------------------

/** Deep structural equality over JSON-able values (no ref cycles assumptions). */
export function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;
  if (typeof a === 'number' || typeof a === 'boolean' || typeof a === 'string') {
    return a === b;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!jsonEqual(a[i], b[i])) return false;
    return true;
  }
  if (isPlainRecord(a) && isPlainRecord(b)) {
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    for (const k of ka) {
      if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
      if (!jsonEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) {
        return false;
      }
    }
    return true;
  }
  return false;
}

function isPlainRecord(v: unknown): v is Record<string, unknown> {
  return (
    typeof v === 'object' &&
    v !== null &&
    !Array.isArray(v) &&
    typeof v !== 'function'
  );
}

/** Deterministic deep clone via JSON round-trip (states are JSON-clean). */
export function deepCloneJson<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

// ---------------------------------------------------------------------------
// JSON delta computation / application
// ---------------------------------------------------------------------------

/**
 * Compute a structural delta from `base` to `next`. The result is fully
 * ordered: object keys are visited in ascending string order, array indices in
 * ascending numeric order, so the produced `JsonDelta` is byte-stable.
 */
export function computeJsonDelta(base: unknown, next: unknown): JsonDelta {
  const delta: JsonDelta = { created: [], updated: [], deleted: [] };
  diffInto(base, next, [], delta);
  return delta;
}

function diffInto(a: unknown, b: unknown, path: JsonPath, out: JsonDelta): void {
  if (jsonEqual(a, b)) return;

  if (isPlainRecord(a) && isPlainRecord(b)) {
    const ra = a as Record<string, unknown>;
    const rb = b as Record<string, unknown>;
    const keys = [...new Set([...Object.keys(ra), ...Object.keys(rb)])].sort();
    for (const k of keys) {
      const inA = Object.prototype.hasOwnProperty.call(ra, k);
      const inB = Object.prototype.hasOwnProperty.call(rb, k);
      if (inA && inB) {
        diffInto(ra[k], rb[k], [...path, k], out);
      } else if (inB) {
        out.created.push([[...path, k], rb[k]] as [JsonPath, unknown]);
      } else {
        out.deleted.push([...path, k]);
      }
    }
    return;
  }

  if (Array.isArray(a) && Array.isArray(b)) {
    const n = Math.max(a.length, b.length);
    for (let i = 0; i < n; i++) {
      const inA = i < a.length;
      const inB = i < b.length;
      if (inA && inB) {
        diffInto(a[i], b[i], [...path, i], out);
      } else if (inB) {
        out.created.push([[...path, i], b[i]] as [JsonPath, unknown]);
      } else {
        out.deleted.push([...path, i]);
      }
    }
    return;
  }

  // Leaf (incl. type mismatch between a and b): treat whole value as replaced.
  out.updated.push([path, b] as [JsonPath, unknown]);
}

/**
 * Apply `delta` onto a deep clone of `base`, returning the reconstructed state.
 * Pure: `base` is never mutated. Array deletions are applied in descending
 * index order so splices do not shift later targets.
 */
export function applyJsonDelta<T>(base: T, delta: JsonDelta): T {
  const result = deepCloneJson(base) as unknown;

  // Created and updated set their values (created = new path, updated = changed).
  for (const [path, value] of delta.created) setIn(result, path, value);
  for (const [path, value] of delta.updated) setIn(result, path, value);

  // Deleted: apply in descending path order so nested/array splices are stable.
  const sortedDeleted = delta.deleted.slice().sort((p, q) => comparePaths(q, p));
  for (const path of sortedDeleted) removeIn(result, path);

  return result as T;
}

function setIn(root: unknown, path: JsonPath, value: unknown): void {
  let cur = root as Record<string | number, unknown>;
  for (let i = 0; i < path.length; i++) {
    const key = path[i];
    if (i === path.length - 1) {
      cur[key] = value;
      return;
    }
    if (cur[key] === undefined || cur[key] === null) {
      const nextKey = path[i + 1];
      cur[key] = typeof nextKey === 'number' ? [] : {};
    }
    cur = cur[key] as Record<string | number, unknown>;
  }
}

function removeIn(root: unknown, path: JsonPath): void {
  if (path.length === 0) return;
  let cur = root as Record<string | number, unknown>;
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i];
    if (cur[key] === undefined || cur[key] === null) return;
    cur = cur[key] as Record<string | number, unknown>;
  }
  const last = path[path.length - 1];
  if (Array.isArray(cur)) {
    cur.splice(last as number, 1);
  } else if (isPlainRecord(cur) && Object.prototype.hasOwnProperty.call(cur, last as string)) {
    delete cur[last as string];
  }
}

/** Ascending path comparison with numeric-aware segments. */
export function comparePaths(a: JsonPath, b: JsonPath): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a[i];
    const y = b[i];
    if (typeof x === 'number' && typeof y === 'number') {
      if (x !== y) return x - y;
    } else {
      const xs = String(x);
      const ys = String(y);
      if (xs !== ys) return xs < ys ? -1 : 1;
    }
  }
  return a.length - b.length;
}

// ---------------------------------------------------------------------------
// Incremental file encode / decode
// ---------------------------------------------------------------------------

/** Determinism probe: two identical snapshot sequences yield identical bytes. */
export function encodeIncrementalFile(
  file: IncrementalFile,
): Uint8Array {
  const w = new BinaryWriter();
  w.writeU32(file.header.magic);
  w.writeU32(file.header.version);
  w.writeF64(file.header.createdAt);
  w.writeU64(file.header.seedLow);
  w.writeU64(file.header.seedHigh);
  w.writeU32(file.frames.length);
  for (const f of file.frames) {
    w.writeU8(f.mode);
    w.writeF64(f.createdAt);
    w.writeU32(f.checksum);
    w.writeU32(f.body.length);
    w.writeBytes(f.body);
  }
  return w.toUint8Array();
}

/**
 * Decode the structural layout of an incremental file WITHOUT verifying
 * checksums. Throws `CorruptSaveError` only on a bad magic, bad version, or a
 * truncated/short read (structural corruption). Per-frame integrity must be
 * checked by the caller (see `recovery`).
 */
export function decodeIncrementalFile(bytes: Uint8Array): IncrementalFile {
  let r: BinaryReader;
  try {
    r = new BinaryReader(bytes);
    const magic = r.readU32();
    if (magic !== INC_MAGIC) {
      throw new CorruptSaveError(
        `Bad incremental magic: expected 0x${INC_MAGIC.toString(16)}, got 0x${magic.toString(16)}`,
      );
    }
    const version = r.readU32();
    if (version !== INC_FORMAT_VERSION) {
      throw new CorruptSaveError(`Unsupported incremental version ${version}`);
    }
    const createdAt = r.readF64();
    const seedLow = r.readU64();
    const seedHigh = r.readU64();
    const frameCount = r.readU32();

    const frames: IncrementalFrame[] = [];
    for (let i = 0; i < frameCount; i++) {
      const mode = r.readU8() as 0 | 1 | 2;
      const frameCreatedAt = r.readF64();
      const checksum = r.readU32();
      const bodyLen = r.readU32();
      const body = r.readBytes(bodyLen);
      frames.push({ mode, createdAt: frameCreatedAt, checksum, body });
    }
    return {
      header: { magic, version, createdAt, seedLow, seedHigh },
      frames,
    };
  } catch (e) {
    if (e instanceof CorruptSaveError) throw e;
    if (e instanceof RangeError) {
      throw new CorruptSaveError(`Truncated incremental file: ${e.message}`);
    }
    throw e;
  }
}

function readFrameState(frame: IncrementalFrame): unknown {
  const jsonBytes = decompress(frame.body);
  return JSON.parse(new TextDecoder().decode(jsonBytes));
}

// ---------------------------------------------------------------------------
// Apply (replay) — strict and best-effort
// ---------------------------------------------------------------------------

/**
 * Reconstruct the final full state from an incremental file. Throws
 * `CorruptSaveError` on the first frame whose checksum or payload is invalid.
 *
 * Determinism: replaying identical bytes always yields the identical final
 * state (deep-equal to the last snapshot originally saved).
 */
export function applyIncremental<T = unknown>(bytes: Uint8Array): T {
  const file = decodeIncrementalFile(bytes);
  let state: unknown;
  for (let i = 0; i < file.frames.length; i++) {
    const f = file.frames[i];
    if (computeChecksum(f.body) !== f.checksum) {
      throw new CorruptSaveError(`Frame ${i} checksum mismatch`, i);
    }
    if (f.mode === 2) {
      state = readFrameState(f);
    } else if (f.mode === 1) {
      if (state === undefined) {
        throw new CorruptSaveError(`Partial frame ${i} has no base state`, i);
      }
      const delta = readFrameState(f) as JsonDelta;
      state = applyJsonDelta(state, delta);
    }
    // mode 0 (no-op) carries no state change.
  }
  return state as T;
}

/**
 * Best-effort reconstruction used by the recovery module: fold frames in order
 * and stop at the first frame that fails its checksum or fails to decode,
 * returning the last fully-valid reconstructed state together with metadata.
 * Never throws for content corruption (only for structural header errors).
 */
export function foldIncrementalBestEffort(
  bytes: Uint8Array,
): {
  state: unknown | undefined;
  validFrames: number;
  totalFrames: number;
  corruptAt: number; // -1 if fully valid
  fatalHeader: boolean; // structural magic/version/truncation error
} {
  let file: IncrementalFile;
  try {
    file = decodeIncrementalFile(bytes);
  } catch (e) {
    if (e instanceof CorruptSaveError) {
      // Header/magic/version problem: nothing usable.
      return { state: undefined, validFrames: 0, totalFrames: 0, corruptAt: -1, fatalHeader: true };
    }
    throw e;
  }

  let state: unknown;
  let validFrames = 0;
  for (let i = 0; i < file.frames.length; i++) {
    const f = file.frames[i];
    if (computeChecksum(f.body) !== f.checksum) {
      return { state, validFrames, totalFrames: file.frames.length, corruptAt: i, fatalHeader: false };
    }
    try {
      if (f.mode === 2) {
        state = readFrameState(f);
      } else if (f.mode === 1) {
        if (state === undefined) {
          return { state: undefined, validFrames, totalFrames: file.frames.length, corruptAt: i, fatalHeader: false };
        }
        state = applyJsonDelta(state, readFrameState(f) as JsonDelta);
      }
    } catch {
      return { state, validFrames, totalFrames: file.frames.length, corruptAt: i, fatalHeader: false };
    }
    validFrames++;
  }
  return { state, validFrames, totalFrames: file.frames.length, corruptAt: -1, fatalHeader: false };
}

// ---------------------------------------------------------------------------
// Stateful builder
// ---------------------------------------------------------------------------

export interface IncrementalSaverOptions {
  /**
   * Emit a fresh full snapshot every N frames (in addition to the first).
   * `fullEvery <= 1` means "never re-baseline" (first frame is full, rest are
   * deltas). Default 64 keeps files self-contained and bounds delta chains.
   */
  fullEvery?: number;
  /** Explicit base state for the first delta (advanced use). */
  base?: unknown;
}

/**
 * Builds an incremental save file incrementally. Feed it full snapshots via
 * `save(state, createdAt)`; it appends a full frame on the first call, and a
 * partial delta frame thereafter whenever `state` differs from the previous
 * one. `toBytes` produces the deterministic on-disk file.
 *
 * Determinism: given the same sequence of (state, createdAt) inputs, `toBytes`
 * returns byte-identical output every time.
 */
export class IncrementalSaver {
  private readonly fullEvery: number;
  private frames: IncrementalFrame[] = [];
  private lastState: unknown;
  private frameCountSinceFull = 0;
  private hasBase = false;

  constructor(opts: IncrementalSaverOptions = {}) {
    this.fullEvery = opts.fullEvery ?? 64;
    if (opts.base !== undefined) {
      this.lastState = opts.base;
      this.hasBase = true;
    }
  }

  /** Append a snapshot. Returns true if a frame was written (false = no change). */
  save(state: unknown, createdAt: number): boolean {
    // First real frame (or a forced re-baseline) is always a full snapshot.
    if (!this.hasBase || this.frameCountSinceFull >= this.fullEvery) {
      this.appendFull(state, createdAt);
      this.lastState = deepCloneJson(state);
      this.hasBase = true;
      this.frameCountSinceFull = 1;
      return true;
    }
    const delta = computeJsonDelta(this.lastState, state);
    if (delta.created.length + delta.updated.length + delta.deleted.length === 0) {
      // No change — do not append a frame (keeps the file minimal + deterministic).
      return false;
    }
    this.appendPartial(delta, createdAt);
    this.lastState = deepCloneJson(state);
    this.frameCountSinceFull++;
    return true;
  }

  /** Force a full snapshot frame regardless of the re-baseline schedule. */
  forceFull(state: unknown, createdAt: number): void {
    this.appendFull(state, createdAt);
    this.lastState = deepCloneJson(state);
    this.hasBase = true;
    this.frameCountSinceFull = 1;
  }

  private appendFull(state: unknown, createdAt: number): void {
    const body = compress(new TextEncoder().encode(JSON.stringify(state)));
    this.frames.push({
      mode: 2,
      createdAt,
      checksum: computeChecksum(body),
      body,
    });
  }

  private appendPartial(delta: JsonDelta, createdAt: number): void {
    const body = compress(new TextEncoder().encode(JSON.stringify(delta)));
    this.frames.push({
      mode: 1,
      createdAt,
      checksum: computeChecksum(body),
      body,
    });
  }

  /** Number of frames currently buffered. */
  get frameCount(): number {
    return this.frames.length;
  }

  /** Serialize all buffered frames into a deterministic incremental file. */
  toBytes(
    createdAt: number,
    seedLow: bigint,
    seedHigh: bigint,
  ): Uint8Array {
    return encodeIncrementalFile({
      header: {
        magic: INC_MAGIC,
        version: INC_FORMAT_VERSION,
        createdAt,
        seedLow,
        seedHigh,
      },
      frames: this.frames,
    });
  }
}
