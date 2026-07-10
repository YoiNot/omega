/**
 * @omega/modding — byte-compact, deterministic serialization of a
 * {@link ModManifest}.
 *
 * `loadModManifest` parses bytes produced by `saveModManifest`, and vice versa.
 * Both go through `@omega/save` `SaveWriter`/`SaveReader` (which RLE-compress a
 * canonical JSON payload) so the on-disk form is deterministic: same manifest ->
 * same bytes, independent of object-key insertion order (we canonicalize keys
 * before writing) and with no wall-clock in the header (`createdAt` is fixed at
 * 0 so a re-serialized manifest is byte-identical to the original file).
 */

import { SaveWriter, SaveReader } from '@omega/save';
import type { ModManifest } from './types.js';
import { canonicalStringify, canonicalize } from './canon.js';

const MANIFEST_SEED = 0x4d4f4423n; // 'MOD#' — content-addressed seed

/**
 * Serialize a manifest to a deterministic byte sequence.
 *
 * `createdAt` is fixed at 0 and the seed is constant, so re-serializing an
 * identical logical manifest yields byte-identical output (idempotent bytes).
 */
export function saveModManifest(manifest: ModManifest): Uint8Array {
  return SaveWriter.write(
    canonicalize(manifest), // key-sorted so bytes ignore insertion order
    0, // createdAt — never Date.now(); fixed for byte-stability
    MANIFEST_SEED,
    MANIFEST_SEED,
  );
}

/** Parse a manifest previously written by {@link saveModManifest}. */
export function loadModManifest(bytes: Uint8Array): ModManifest {
  const file = SaveReader.read<ModManifest>(bytes);
  const m = file.data;
  if (!m || typeof m !== 'object' || !('id' in m) || !('version' in m)) {
    throw new Error('loadModManifest: not a valid ModManifest');
  }
  // Normalize to canonical shape in case an older/foreign writer omitted arrays.
  return {
    id: m.id,
    version: m.version,
    rules: Array.isArray(m.rules) ? m.rules : [],
    content: Array.isArray(m.content) ? m.content : [],
  };
}

/** Canonical-JSON string form of a manifest (key-sorted, stable). */
export function manifestToCanonicalString(manifest: ModManifest): string {
  return canonicalStringify(manifest);
}
