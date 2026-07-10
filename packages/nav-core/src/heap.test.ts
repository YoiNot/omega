import { describe, it, expect } from 'vitest';
import { MinHeap } from './heap.js';

describe('MinHeap', () => {
  it('pops in ascending order', () => {
    const h = new MinHeap<number>((a, b) => a - b);
    for (const v of [5, 1, 3, 2, 4]) h.push(v);
    const out: number[] = [];
    while (!h.isEmpty()) out.push(h.pop()!);
    expect(out).toEqual([1, 2, 3, 4, 5]);
  });

  it('honours a custom comparator', () => {
    const h = new MinHeap<{ k: number }>((a, b) => a.k - b.k);
    h.push({ k: 3 });
    h.push({ k: 1 });
    h.push({ k: 2 });
    expect(h.pop()!.k).toBe(1);
    expect(h.pop()!.k).toBe(2);
    expect(h.pop()!.k).toBe(3);
  });

  it('isEmpty / peek behave', () => {
    const h = new MinHeap<number>((a, b) => a - b);
    expect(h.isEmpty()).toBe(true);
    expect(h.peek()).toBeUndefined();
    h.push(7);
    expect(h.isEmpty()).toBe(false);
    expect(h.peek()).toBe(7);
  });

  it('deterministic tie-break via cell index falls through', () => {
    // Equal f, equal h, differ only by idx -> lower idx pops first.
    const h = new MinHeap<{ f: number; h: number; idx: number }>((a, b) => {
      if (a.f !== b.f) return a.f - b.f;
      if (a.h !== b.h) return a.h - b.h;
      return a.idx - b.idx;
    });
    h.push({ f: 1, h: 1, idx: 5 });
    h.push({ f: 1, h: 1, idx: 2 });
    h.push({ f: 1, h: 1, idx: 9 });
    expect(h.pop()!.idx).toBe(2);
    expect(h.pop()!.idx).toBe(5);
    expect(h.pop()!.idx).toBe(9);
  });
});
