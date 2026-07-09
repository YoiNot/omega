import { describe, it, expect } from 'vitest';
import { MinHeap } from './heap.js';

const byNum = (a: number, b: number) => a - b;

describe('MinHeap', () => {
  it('pops elements in ascending order', () => {
    const h = new MinHeap<number>(byNum);
    for (const v of [5, 3, 8, 1, 9, 2, 7, 4, 0, 6]) h.push(v);
    const out: number[] = [];
    while (!h.isEmpty()) out.push(h.pop()!);
    expect(out).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('pop on empty returns undefined', () => {
    const h = new MinHeap<number>(byNum);
    expect(h.pop()).toBeUndefined();
    expect(h.peek()).toBeUndefined();
    expect(h.size).toBe(0);
    expect(h.isEmpty()).toBe(true);
  });

  it('peek does not remove', () => {
    const h = new MinHeap<number>(byNum);
    h.push(3);
    h.push(1);
    expect(h.peek()).toBe(1);
    expect(h.size).toBe(2);
  });

  it('supports duplicate priorities', () => {
    const h = new MinHeap<number>(byNum);
    for (const v of [2, 2, 2, 1, 1]) h.push(v);
    const out: number[] = [];
    while (!h.isEmpty()) out.push(h.pop()!);
    expect(out).toEqual([1, 1, 2, 2, 2]);
  });

  it('is deterministic for a fixed push order + comparator', () => {
    const data = [4, 1, 7, 2, 9, 3, 8, 5, 6, 0];
    const run = () => {
      const h = new MinHeap<number>(byNum);
      for (const v of data) h.push(v);
      const out: number[] = [];
      while (!h.isEmpty()) out.push(h.pop()!);
      return out;
    };
    expect(run()).toEqual(run());
  });

  it('orders by an object comparator (f, then idx tie-break)', () => {
    interface N { f: number; idx: number; }
    const h = new MinHeap<N>((a, b) => (a.f !== b.f ? a.f - b.f : a.idx - b.idx));
    h.push({ f: 1, idx: 5 });
    h.push({ f: 1, idx: 2 });
    h.push({ f: 0, idx: 9 });
    expect(h.pop()).toEqual({ f: 0, idx: 9 });
    expect(h.pop()).toEqual({ f: 1, idx: 2 });
    expect(h.pop()).toEqual({ f: 1, idx: 5 });
  });

  it('single element behaves correctly', () => {
    const h = new MinHeap<number>(byNum);
    h.push(42);
    expect(h.pop()).toBe(42);
    expect(h.isEmpty()).toBe(true);
  });

  it('handles floating-point priorities deterministically', () => {
    interface F { f: number; idx: number; }
    const h = new MinHeap<F>((a, b) => (a.f !== b.f ? a.f - b.f : a.idx - b.idx));
    const pushes: F[] = [
      { f: 1.414, idx: 3 },
      { f: 2.0, idx: 2 },
      { f: 2.0, idx: 1 },
      { f: 1.0, idx: 0 },
    ];
    for (const p of pushes) h.push(p);
    const order: number[] = [];
    while (!h.isEmpty()) order.push(h.pop()!.idx);
    expect(order).toEqual([0, 3, 1, 2]);
  });
});
