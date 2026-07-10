/**
 * @omega/save-incr — deterministic checksum utilities.
 *
 * Builds on @omega/save's `BinaryWriter`/`BinaryReader` (little-endian u32) so
 * the framing stays consistent with the rest of the save subsystem. We use a
 * 32-bit FNV-1a hash over a byte block — fast, dependency-free, and fully
 * deterministic (no RNG, no wall-clock). The hash is stored as a little-endian
 * u32 immediately before/after the protected bytes depending on the caller's
 * frame layout.
 *
 * Determinism contract
 * --------------------
 * `computeChecksum` is a pure function of the input bytes. Identical input
 * bytes always produce the identical 32-bit hash, on every platform.
 */

import { BinaryWriter, BinaryReader } from '@omega/save';

/** FNV offset basis and FNV prime for the 32-bit variant. */
const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/**
 * Compute a 32-bit FNV-1a checksum over `bytes`.
 *
 * The result is an unsigned 32-bit integer (0..2^32-1). Math.imul is used for
 * the multiply so it stays exact on every JS engine.
 */
export function computeChecksum(bytes: Uint8Array): number {
  let hash = FNV_OFFSET_BASIS;
  for (let i = 0; i < bytes.length; i++) {
    hash ^= bytes[i];
    // hash *= FNV_PRIME, kept in 32-bit range via Math.imul.
    hash = Math.imul(hash, FNV_PRIME);
  }
  // Force unsigned 32-bit.
  return hash >>> 0;
}

/**
 * Append a u32 checksum to `writer` computed over `protectedBytes`.
 * `protectedBytes` must be the exact byte sequence the checksum covers (e.g.
 * the body already written to a separate buffer).
 */
export function writeChecksum(writer: BinaryWriter, protectedBytes: Uint8Array): void {
  writer.writeU32(computeChecksum(protectedBytes));
}

/**
 * Read a u32 checksum from `reader` (the bytes are written by `writeChecksum`).
 * Caller is responsible for having read the protected body first.
 */
export function readChecksum(reader: BinaryReader): number {
  return reader.readU32();
}

/** Convenience: does `actual` match `expected`? */
export function checksumMatches(actual: number, expected: number): boolean {
  return actual >>> 0 === expected >>> 0;
}
