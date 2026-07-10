/**
 * @omega/save-incr — recovery from corrupt / truncated save files.
 *
 * Two failure modes are handled deterministically:
 *
 *  1. A *structural* problem in the file header (bad magic, unsupported
 *     version, truncated top-level framing). For an incremental file this is
 *     detected by `decodeIncrementalFile` (throws `CorruptSaveError` with
 *     `frameIndex === -1`). For a plain @omega/save file the magic/version
 *     check lives in `SaveReader`.
 *
 *  2. A *content* problem in a frame/body (bit-rot, truncated body, bad JSON).
 *     Each incremental frame carries an FNV-1a checksum; `recoverIncremental`
 *     folds frames in order and stops at the first bad one, returning the last
 *     fully-valid reconstructed state. It NEVER throws on content corruption
 *     and NEVER crashes the host — it returns `ok: false` with the best state
 *     it could recover, or `null` when nothing is usable.
 *
 * Determinism: given the same (possibly corrupt) bytes, recovery always returns
 * the same result — there is no randomness, no clock, no "best guess" beyond
 * the last valid frame.
 */

import {
  SaveReader,
  SAVE_MAGIC,
  SAVE_FORMAT_VERSION,
} from '@omega/save';
import {
  foldIncrementalBestEffort,
} from './incremental.js';

export interface PlainRecoveryResult {
  ok: boolean;
  /** Recovered data, or null if the file is unrecoverable. */
  data: unknown | null;
  /** Human-readable reason when `ok` is false. */
  reason: string;
  /** True if the magic/version header itself was bad (vs. a body problem). */
  fatalHeader: boolean;
}

export interface IncrementalRecoveryResult {
  ok: boolean;
  /** Last fully-valid reconstructed state, or null if nothing recovered. */
  state: unknown | null;
  /** Number of valid frames recovered (0..N). */
  validFrames: number;
  /** Total frames declared in the file. */
  totalFrames: number;
  /**
   * Index of the first corrupt frame, or -1 when the whole file is valid.
   * `state` is the reconstruction through `validFrames - 1`.
   */
  corruptAt: number;
  reason: string;
  fatalHeader: boolean;
}

/**
 * Attempt to recover the last valid state from a plain @omega/save file.
 *
 * Returns `ok: false` (never throws) when the magic/version header is bad or
 * the compressed body fails to decompress/parse. The latter is a content
 * problem but, because a plain save has no internal checkpoints, the single
 * state is either intact or lost — so `ok` reflects integrity and `data` is
 * null when it could not be read.
 */
export function recoverPlainSave(bytes: Uint8Array): PlainRecoveryResult {
  try {
    const file = SaveReader.read(bytes);
    if (file.header.magic !== SAVE_MAGIC) {
      return { ok: false, data: null, reason: 'bad magic', fatalHeader: true };
    }
    if (file.header.version > SAVE_FORMAT_VERSION) {
      return {
        ok: false,
        data: null,
        reason: `unsupported version ${file.header.version}`,
        fatalHeader: true,
      };
    }
    return { ok: true, data: file.data, reason: 'ok', fatalHeader: false };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // Distinguish a header/magic failure (fatal) from a body failure.
    const fatalHeader = /magic/i.test(msg);
    return {
      ok: false,
      data: null,
      reason: msg,
      fatalHeader,
    };
  }
}

/**
 * Attempt to recover the last valid state from an incremental save file.
 *
 * - Structural header error (bad magic/version/truncation at the top level):
 *   returns `state: null, totalFrames: 0, corruptAt: -1, fatalHeader: true`.
 * - Content corruption mid-file: folds valid frames and returns the last good
 *   reconstructed state with `validFrames`/`corruptAt` set, `ok: true` if at
 *   least one frame survived, else `ok: false`.
 *
 * Never throws for content corruption. (Only a `CorruptSaveError` from a truly
 * unparseable header is caught and reported as a non-throwing result.)
 */
export function recoverIncremental(bytes: Uint8Array): IncrementalRecoveryResult {
  const result = foldIncrementalBestEffort(bytes);
  const ok = result.state !== undefined;
  return {
    ok,
    state: result.state ?? null,
    validFrames: result.validFrames,
    totalFrames: result.totalFrames,
    corruptAt: result.corruptAt,
    reason:
      result.fatalHeader
        ? 'structural header error'
        : result.corruptAt === -1
          ? 'ok'
          : `corruption at frame ${result.corruptAt}`,
    fatalHeader: result.fatalHeader,
  };
}
