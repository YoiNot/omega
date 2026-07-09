import { describe, it, expect } from 'vitest';
import {
  SnapshotBuffer,
  WorldSnapshot,
  encodeSnapshot,
  decodeSnapshot,
  makeSnapshot,
  asFloat32,
  interpolate,
} from './snapshot.js';

const snap = (tick: number, f: number[]): WorldSnapshot => makeSnapshot(tick, f);

describe('snapshot encode/decode', () => {
  it('round-trips a Float32 snapshot exactly', () => {
    const src = [0.5, -1.25, 3.14159, 1000.0001];
    const s = snap(7, src);
    const bytes = encodeSnapshot(s);
    const back = decodeSnapshot(bytes);
    expect(back.tick).toBe(7);
    // Compare against the float32-truncated originals (float32 is lossy by design).
    const expected = Float32Array.from(src);
    const got = asFloat32(back);
    expect(got.length).toBe(expected.length);
    for (let i = 0; i < got.length; i++) expect(got[i]).toBe(expected[i]);
  });

  it('round-trips an empty field', () => {
    const s = snap(0, []);
    const back = decodeSnapshot(encodeSnapshot(s));
    expect(back.tick).toBe(0);
    expect(asFloat32(back)).toHaveLength(0);
  });

  it('throws on truncated input', () => {
    expect(() => decodeSnapshot(new Uint8Array([1, 2]))).toThrow();
    // header claims 3 floats but body is missing
    const bad = new Uint8Array(8);
    new DataView(bad.buffer).setUint32(4, 3, true);
    expect(() => decodeSnapshot(bad)).toThrow();
  });
});

describe('SnapshotBuffer', () => {
  it('keeps the last N snapshots and exposes oldest/newest', () => {
    const b = new SnapshotBuffer(3);
    b.push(snap(0, [0]));
    b.push(snap(1, [1]));
    b.push(snap(2, [2]));
    b.push(snap(3, [3])); // should evict tick 0
    expect(b.size).toBe(3);
    expect(b.oldest()!.tick).toBe(1);
    expect(b.latest()!.tick).toBe(3);
  });

  it('at() indexes from newest (age 0)', () => {
    const b = new SnapshotBuffer(4);
    b.push(snap(10, [0]));
    b.push(snap(11, [1]));
    expect(b.at(0)!.tick).toBe(11);
    expect(b.at(1)!.tick).toBe(10);
    expect(b.at(2)).toBeUndefined();
  });

  it('copies snapshot data on push (no external aliasing)', () => {
    const b = new SnapshotBuffer(2);
    const f = new Float32Array([1, 2, 3]);
    b.push(makeSnapshot(0, f));
    f[0] = 999;
    expect([...asFloat32(b.latest()!)]).toEqual([1, 2, 3]);
  });

  it('rejects capacity < 1', () => {
    expect(() => new SnapshotBuffer(0)).toThrow();
  });

  it('is empty before any push', () => {
    const b = new SnapshotBuffer(2);
    expect(b.size).toBe(0);
    expect(b.latest()).toBeUndefined();
    expect(b.oldest()).toBeUndefined();
  });
});

describe('interpolate', () => {
  it('alpha=0 returns a', () => {
    const a = snap(0, [1, 2, 3]);
    const b = snap(1, [4, 5, 6]);
    const r = interpolate(a, b, 0);
    expect([...asFloat32(r)]).toEqual([1, 2, 3]);
  });

  it('alpha=1 returns b', () => {
    const a = snap(0, [1, 2, 3]);
    const b = snap(1, [4, 5, 6]);
    const r = interpolate(a, b, 1);
    expect([...asFloat32(r)]).toEqual([4, 5, 6]);
  });

  it('midpoint lerps element-wise', () => {
    const a = snap(0, [0, 10]);
    const b = snap(1, [20, 30]);
    const r = interpolate(a, b, 0.5);
    expect([...asFloat32(r)]).toEqual([10, 20]);
  });

  it('clamps alpha below 0 to a', () => {
    const a = snap(0, [1]);
    const b = snap(1, [9]);
    expect([...asFloat32(interpolate(a, b, -5))]).toEqual([1]);
  });

  it('clamps alpha above 1 to b', () => {
    const a = snap(0, [1]);
    const b = snap(1, [9]);
    expect([...asFloat32(interpolate(a, b, 5))]).toEqual([9]);
  });

  it('blends only the common prefix when lengths differ', () => {
    const a = snap(0, [0, 0, 0]);
    const b = snap(1, [10, 10]);
    const r = interpolate(a, b, 0.5);
    expect(asFloat32(r)).toHaveLength(2);
    expect([...asFloat32(r)]).toEqual([5, 5]);
  });

  it('interpolated snapshot tick follows b', () => {
    const a = snap(0, [1]);
    const b = snap(99, [2]);
    expect(interpolate(a, b, 0.25).tick).toBe(99);
  });
});
