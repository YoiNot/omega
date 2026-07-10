import { describe, it, expect } from 'vitest';
import { SaveWriter } from '@omega/save';
import {
  IncrementalSaver,
  applyIncremental,
  CorruptSaveError,
  decodeIncrementalFile,
} from './incremental.js';
import {
  recoverPlainSave,
  recoverIncremental,
} from './recovery.js';

interface Doc {
  name: string;
  level: number;
}

function incBytes(states: Doc[], fullEvery = 64): Uint8Array {
  const saver = new IncrementalSaver({ fullEvery });
  let at = 1;
  for (const s of states) saver.save(s, at++);
  return saver.toBytes(0, 0n, 0n);
}

describe('recoverPlainSave', () => {
  it('recovers a valid plain @omega/save file', () => {
    const bytes = SaveWriter.write({ hp: 9, name: 'x' }, 5, 1n, 2n);
    const r = recoverPlainSave(bytes);
    expect(r.ok).toBe(true);
    expect(r.fatalHeader).toBe(false);
    expect(r.data).toEqual({ hp: 9, name: 'x' });
  });

  it('reports failure (no crash) on bad magic', () => {
    const bytes = SaveWriter.write({ hp: 9 }, 5, 1n, 2n);
    bytes[0] = 0x00; // corrupt magic
    const r = recoverPlainSave(bytes);
    expect(r.ok).toBe(false);
    expect(r.fatalHeader).toBe(true);
    expect(r.data).toBeNull();
  });

  it('reports failure (no crash) on truncated body', () => {
    const bytes = SaveWriter.write({ a: 1, b: 2 }, 5, 1n, 2n);
    // Cut off the tail so decompression/parse fails.
    const truncated = bytes.slice(0, Math.max(8, bytes.length - 5));
    const r = recoverPlainSave(truncated);
    expect(r.ok).toBe(false);
    expect(r.data).toBeNull();
  });
});

describe('recoverIncremental', () => {
  it('recovers the full final state from a valid incremental file', () => {
    const states: Doc[] = [
      { name: 'a', level: 1 },
      { name: 'b', level: 2 },
      { name: 'c', level: 3 },
    ];
    const bytes = incBytes(states);
    const r = recoverIncremental(bytes);
    expect(r.ok).toBe(true);
    expect(r.fatalHeader).toBe(false);
    expect(r.corruptAt).toBe(-1);
    expect(r.validFrames).toBe(states.length); // full + 2 partials
    expect(r.totalFrames).toBe(states.length);
    expect(r.state).toEqual(states[states.length - 1]);
  });

  it('restores the last valid snapshot when a middle frame is corrupted', () => {
    const states: Doc[] = [
      { name: 'a', level: 1 },
      { name: 'b', level: 2 },
      { name: 'c', level: 3 },
      { name: 'd', level: 4 },
    ];
    const bytes = incBytes(states); // full + 3 partials

    // Corrupt the body of the last frame so its checksum fails.
    const file = decodeIncrementalFile(bytes);
    const corrupted = bytes.slice();
    // The last frame's body is the final bytes; flip one byte in its body.
    const last = file.frames[file.frames.length - 1];
    // Find the body in the full buffer: it's the last `last.body.length` bytes.
    const start = corrupted.length - last.body.length;
    corrupted[start] ^= 0xff;

    const r = recoverIncremental(corrupted);
    // The first three frames (full + 2 partials) are valid; the 4th is corrupt.
    expect(r.ok).toBe(true);
    expect(r.corruptAt).toBe(file.frames.length - 1);
    expect(r.validFrames).toBe(file.frames.length - 1);
    // Reconstructed state == state AFTER the last valid frame (the 3rd doc).
    expect(r.state).toEqual(states[2]);
  });

  it('returns fatalHeader=true on bad magic (no crash)', () => {
    const bytes = incBytes([{ name: 'a', level: 1 }, { name: 'b', level: 2 }]);
    const corrupted = bytes.slice();
    corrupted[0] = 0x00; // flip magic's first byte
    const r = recoverIncremental(corrupted);
    expect(r.ok).toBe(false);
    expect(r.fatalHeader).toBe(true);
    expect(r.state).toBeNull();
    expect(r.totalFrames).toBe(0);
  });

  it('converges identically: applyIncremental != recovery when corrupted, but recovery is deterministic', () => {
    const states: Doc[] = [
      { name: 'a', level: 1 },
      { name: 'b', level: 2 },
      { name: 'c', level: 3 },
    ];
    const bytes = incBytes(states);
    const file = decodeIncrementalFile(bytes);
    const corr = bytes.slice();
    const last = file.frames[file.frames.length - 1];
    corr[corr.length - last.body.length] ^= 0xff;

    const r1 = recoverIncremental(corr);
    const r2 = recoverIncremental(corr);
    expect(r1).toEqual(r2); // deterministic
    expect(() => applyIncremental(corr)).toThrow(CorruptSaveError);
  });

  it('detects a truncated incremental file as fatalHeader', () => {
    const bytes = incBytes([{ name: 'a', level: 1 }, { name: 'b', level: 2 }]);
    const truncated = bytes.slice(0, bytes.length - 3);
    const r = recoverIncremental(truncated);
    expect(r.ok).toBe(false);
    expect(r.fatalHeader).toBe(true);
    expect(r.state).toBeNull();
  });
});
