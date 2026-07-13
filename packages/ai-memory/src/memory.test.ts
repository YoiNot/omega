import { describe, it, expect } from 'vitest';
import { MemoryStore, foldValue, mergeStates, type MemorySnapshot } from './index.js';

/** A fixed event sequence generator so two stores fed the same way are trivially comparable. */
function feed(store: MemoryStore): void {
  store.record('see', { enemy: 1, hp: 10 });
  store.record('see', { enemy: 1, hp: 8 });
  store.record('hear', { alarm: 1 });
  store.record('infer', { enemy: 0, hp: 0 });
  store.record('see', { ally: 1 });
}

describe('fold helpers', () => {
  it('last keeps the most recent value', () => {
    expect(foldValue('last', 3, 9)).toBe(9);
    expect(foldValue('last', 9, 3)).toBe(3);
  });
  it('max / min take the extremum', () => {
    expect(foldValue('max', 3, 9)).toBe(9);
    expect(foldValue('max', 9, 3)).toBe(9);
    expect(foldValue('min', 3, 9)).toBe(3);
    expect(foldValue('min', 9, 3)).toBe(3);
  });
  it('sum accumulates, starting from 0 for an absent key', () => {
    expect(foldValue('sum', 0, 4)).toBe(4);
    expect(foldValue('sum', 4, 4)).toBe(8);
  });
  it('mergeStates folds every feature under the op', () => {
    const t: Record<string, number> = { a: 1, b: 5 };
    mergeStates(t, { a: 3, c: 2 }, 'max');
    expect(t).toEqual({ a: 3, b: 5, c: 2 });
  });
});

describe('MemoryStore — determinism (same sequence => identical state)', () => {
  it('two stores fed the same sequence have identical belief, events, seq', () => {
    const a = new MemoryStore(8, 'last');
    const b = new MemoryStore(8, 'last');
    feed(a);
    feed(b);
    expect(a.getBelief()).toEqual(b.getBelief());
    expect(a.recent()).toEqual(b.recent());
    expect(a.nextSeq).toBe(b.nextSeq);
    expect(a.serialize()).toEqual(b.serialize());
  });

  it('is stable across many repeated rebuilds', () => {
    const base = new MemoryStore(8, 'last');
    feed(base);
    const ref = base.serialize();
    for (let i = 0; i < 30; i++) {
      const s = new MemoryStore(8, 'last');
      feed(s);
      expect(s.serialize()).toEqual(ref);
    }
  });

  it('merge op changes the belief reproducibly (sum)', () => {
    const a = new MemoryStore(8, 'sum');
    a.record('x', { hp: 10 });
    a.record('x', { hp: 5 });
    a.record('x', { hp: 3 });
    expect(a.getBelief()).toEqual({ hp: 18 });
    // byte-identical rebuild
    expect(MemoryStore.fromSnapshot(a.serialize()).getBelief()).toEqual({ hp: 18 });
  });

  it('merge op changes the belief reproducibly (max/min)', () => {
    const mx = new MemoryStore(8, 'max');
    mx.record('x', { v: 2 });
    mx.record('x', { v: 9 });
    mx.record('x', { v: 4 });
    expect(mx.getBelief()).toEqual({ v: 9 });

    const mn = new MemoryStore(8, 'min');
    mn.record('x', { v: 2 });
    mn.record('x', { v: 9 });
    mn.record('x', { v: 4 });
    expect(mn.getBelief()).toEqual({ v: 2 });
  });
});

describe('ring buffer', () => {
  it('drops oldest events FIFO once over capacity', () => {
    const m = new MemoryStore(3, 'last');
    m.record('a', { t: 1 });
    m.record('b', { t: 2 });
    m.record('c', { t: 3 });
    m.record('d', { t: 4 }); // drops 'a'
    const r = m.recent();
    expect(r.map((e) => e.kind)).toEqual(['b', 'c', 'd']);
    expect(r.map((e) => e.seq)).toEqual([1, 2, 3]);
  });

  it('recent(n) returns the last n in insertion order', () => {
    const m = new MemoryStore(8, 'last');
    feed(m);
    expect(m.recent(2).map((e) => e.kind)).toEqual(['infer', 'see']);
    expect(m.recent(0)).toEqual([]);
  });
});

describe('snapshot stack (speculative reasoning)', () => {
  it('pushSnapshot then record then popSnapshot restores belief exactly', () => {
    const m = new MemoryStore(8, 'last');
    m.record('see', { enemy: 1 });
    m.pushSnapshot();
    m.record('see', { enemy: 0 }); // speculative override
    expect(m.getBelief()).toEqual({ enemy: 0 });
    const popped = m.popSnapshot();
    expect(popped).toEqual({ enemy: 1 });
    expect(m.getBelief()).toEqual({ enemy: 1 });
    expect(m.snapshotCount).toBe(0);
  });

  it('popSnapshot on empty stack returns null and leaves belief unchanged', () => {
    const m = new MemoryStore(8, 'last');
    m.record('see', { x: 1 });
    expect(m.popSnapshot()).toBeNull();
    expect(m.getBelief()).toEqual({ x: 1 });
  });
});

describe('serialize / restore is byte-identical', () => {
  it('fromSnapshot reconstructs events, belief, seq, snapshots', () => {
    const m = new MemoryStore(4, 'last');
    feed(m);
    m.pushSnapshot();
    m.record('see', { enemy: 1 });
    const snap: MemorySnapshot = m.serialize();
    const r = MemoryStore.fromSnapshot(snap);
    expect(r.serialize()).toEqual(snap);
    expect(r.capacity).toBe(4);
    expect(r.nextSeq).toBe(m.nextSeq);
  });
});

describe('asWorldState', () => {
  it('returns the belief for use as a planner state source', () => {
    const m = new MemoryStore(8, 'last');
    m.record('see', { hasAxe: 1 });
    expect(m.asWorldState()).toEqual({ hasAxe: 1 });
  });
});
