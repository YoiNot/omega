import { describe, it, expect } from 'vitest';
import {
  computeJsonDelta,
  applyJsonDelta,
  jsonEqual,
  IncrementalSaver,
  applyIncremental,
  encodeIncrementalFile,
  decodeIncrementalFile,
  INC_MAGIC,
  INC_FORMAT_VERSION,
} from './incremental.js';

interface Doc {
  name: string;
  level: number;
  inventory: Array<{ id: string; qty: number }>;
  meta: Record<string, number>;
}

function makeDoc(seed: number): Doc {
  const inventory = [];
  for (let i = 0; i < (seed % 4); i++) {
    inventory.push({ id: `item-${i}`, qty: (seed * 7 + i) % 50 });
  }
  const meta: Record<string, number> = {};
  for (let i = 0; i < (seed % 3); i++) meta[`k${i}`] = seed + i;
  return { name: `save-${seed}`, level: seed, inventory, meta };
}

describe('computeJsonDelta / applyJsonDelta', () => {
  it('is a pure function of inputs and round-trips exactly', () => {
    const a = makeDoc(3);
    const b = makeDoc(9);
    const d1 = computeJsonDelta(a, b);
    const d2 = computeJsonDelta(a, b);
    expect(d1).toEqual(d2); // deterministic ordering
    expect(applyJsonDelta(a, d1)).toEqual(b);
  });

  it('captures only the changed paths (created/updated/deleted)', () => {
    const base = { a: 1, nested: { x: 1 }, list: [1, 2, 3] };
    const next = { a: 1, nested: { x: 2, y: 9 }, list: [1, 2] };
    const d = computeJsonDelta(base, next);
    expect(d.created).toEqual([[['nested', 'y'], 9]]);
    expect(d.updated).toEqual([[['nested', 'x'], 2]]);
    expect(d.deleted).toEqual([['list', 2]]);
    expect(applyJsonDelta(base, d)).toEqual(next);
  });

  it('handles array insert/remove and type changes', () => {
    const base = { v: [1, 2] as number[] };
    const next = { v: [1, 2, 3] };
    const d = computeJsonDelta(base, next);
    expect(applyJsonDelta(base, d)).toEqual(next);

    const base2 = { v: 5 };
    const next2 = { v: [1, 2] };
    const d2 = computeJsonDelta(base2, next2);
    expect(applyJsonDelta(base2, d2)).toEqual(next2);
  });

  it('produces an empty delta for identical states', () => {
    const s = makeDoc(11);
    const d = computeJsonDelta(s, s);
    expect(d.created.length + d.updated.length + d.deleted.length).toBe(0);
  });
});

describe('IncrementalSaver + applyIncremental', () => {
  // A fixed snapshot sequence (no RNG in the test driver).
  function sequence(steps: number): Doc[] {
    const out: Doc[] = [];
    let s = makeDoc(1);
    out.push(s);
    for (let i = 1; i < steps; i++) {
      s = makeDoc(i * 3 + 1);
      out.push(s);
    }
    return out;
  }

  it('reconstructs the final state exactly via applyIncremental', () => {
    const states = sequence(10);
    const saver = new IncrementalSaver({ fullEvery: 4 });
    let at = 1000;
    for (const st of states) {
      saver.save(st, at++);
    }
    const bytes = saver.toBytes(999, 123n, 456n);
    const restored = applyIncremental<Doc>(bytes);
    expect(restored).toEqual(states[states.length - 1]);
  });

  it('is byte-deterministic: same sequence -> identical file', () => {
    const states = sequence(8);
    const fileOf = (): Uint8Array => {
      const saver = new IncrementalSaver({ fullEvery: 3 });
      let at = 500;
      for (const st of states) saver.save(st, at++);
      return saver.toBytes(777, 11n, 22n);
    };
    const a = fileOf();
    const b = fileOf();
    expect([...a]).toEqual([...b]);
  });

  it('two different sequences are NOT byte-identical', () => {
    const saverA = new IncrementalSaver();
    const saverB = new IncrementalSaver();
    saverA.save(makeDoc(1), 1);
    saverA.save(makeDoc(2), 2);
    saverB.save(makeDoc(1), 1);
    saverB.save(makeDoc(99), 2);
    expect([...saverA.toBytes(0, 0n, 0n)]).not.toEqual([...saverB.toBytes(0, 0n, 0n)]);
  });

  it('emits a full frame first, then partial deltas, and re-baselines per fullEvery', () => {
    const saver = new IncrementalSaver({ fullEvery: 3 });
    saver.save(makeDoc(1), 1);
    saver.save(makeDoc(2), 2);
    saver.save(makeDoc(3), 3);
    saver.save(makeDoc(4), 4); // 4th -> re-baseline (full) since 3 since full
    const bytes = saver.toBytes(0, 0n, 0n);
    const file = decodeIncrementalFile(bytes);
    expect(file.header.magic).toBe(INC_MAGIC);
    expect(file.header.version).toBe(INC_FORMAT_VERSION);
    // frames: full, partial, partial, full  => 2 full (mode 2)
    const fullCount = file.frames.filter((f) => f.mode === 2).length;
    const partialCount = file.frames.filter((f) => f.mode === 1).length;
    expect(fullCount).toBe(2);
    expect(partialCount).toBe(2);
    expect(applyIncremental(bytes)).toEqual(makeDoc(4));
  });

  it('write twice: encodeIncrementalFile of decodeIncrementalFile is stable', () => {
    const saver = new IncrementalSaver();
    saver.save(makeDoc(2), 1);
    saver.save(makeDoc(5), 2);
    const bytes = saver.toBytes(0, 0n, 0n);
    const file = decodeIncrementalFile(bytes);
    const reEncoded = encodeIncrementalFile(file);
    expect([...reEncoded]).toEqual([...bytes]);
  });

  it('jsonEqual compares structurally', () => {
    expect(jsonEqual({ a: [1, 2] }, { a: [1, 2] })).toBe(true);
    expect(jsonEqual({ a: [1, 2] }, { a: [1, 3] })).toBe(false);
    expect(jsonEqual(1, '1' as any)).toBe(false);
  });
});

describe('applyIncremental throws on real corruption', () => {
  it('throws CorruptSaveError when a frame checksum is flipped', () => {
    const saver = new IncrementalSaver();
    saver.save(makeDoc(1), 1);
    saver.save(makeDoc(2), 2);
    const bytes = saver.toBytes(0, 0n, 0n);
    // Flip a byte inside the file so a checksum fails.
    const corrupted = bytes.slice();
    corrupted[corrupted.length - 1] ^= 0xff;
    expect(() => applyIncremental(corrupted)).toThrow(/checksum/i);
  });
});
