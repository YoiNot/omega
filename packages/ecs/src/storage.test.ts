import { describe, it, expect } from 'vitest';
import { SparseSet, ComponentStore, defineComponent } from './storage.js';

describe('SparseSet', () => {
  it('add/remove/has/get are correct and O(1)-shaped', () => {
    const s = new SparseSet<number>();
    expect(s.size).toBe(0);
    expect(s.has(5)).toBe(false);

    s.add(5, 50);
    s.add(2, 20);
    s.add(9, 90);
    expect(s.size).toBe(3);
    expect(s.has(5)).toBe(true);
    expect(s.get(5)).toBe(50);
    expect(s.get(2)).toBe(20);
    expect(s.get(9)).toBe(90);
    expect(s.get(999)).toBeUndefined();
  });

  it('overwrite keeps insertion position', () => {
    const s = new SparseSet<string>();
    s.add(3, 'a');
    s.add(1, 'b');
    s.add(3, 'c');
    expect(s.size).toBe(2);
    expect(s.get(3)).toBe('c');
    // insertion order untouched: [3, 1]
    expect([...s.ids]).toEqual([3, 1]);
  });

  it('remove via swap does not leave dangling entries', () => {
    const s = new SparseSet<number>();
    s.add(1, 10);
    s.add(2, 20);
    s.add(3, 30);
    expect(s.remove(2)).toBe(true);
    expect(s.has(2)).toBe(false);
    expect(s.get(2)).toBeUndefined();
    expect(s.size).toBe(2);
    // the moved element (3) still resolves correctly after swap-remove
    expect(s.get(3)).toBe(30);
    expect(s.get(1)).toBe(10);
    expect(s.remove(2)).toBe(false);
  });

  it('removing the last element is clean', () => {
    const s = new SparseSet<number>();
    s.add(7, 70);
    expect(s.remove(7)).toBe(true);
    expect(s.size).toBe(0);
    expect(s.ids).toEqual([]);
    expect(s.values).toEqual([]);
  });

  it('iteration order follows insertion (id) order, not id magnitude', () => {
    const s = new SparseSet<number>();
    const order = [9, 1, 5, 3, 7];
    for (const id of order) s.add(id, id * 10);
    // ids appear in the order they were inserted
    expect([...s.ids]).toEqual(order);
    expect([...s.values]).toEqual(order.map((n) => n * 10));
  });

  it('clear empties everything', () => {
    const s = new SparseSet<number>();
    s.add(1, 1);
    s.add(2, 2);
    s.clear();
    expect(s.size).toBe(0);
    expect(s.has(1)).toBe(false);
  });
});

describe('ComponentStore', () => {
  const Pos = defineComponent<{ x: number; y: number }>('position');
  const Vel = defineComponent<{ dx: number }>('velocity');

  it('add/get/has/remove per type', () => {
    const store = new ComponentStore();
    expect(store.has(Pos, 1)).toBe(false);
    store.add(Pos, 1, { x: 1, y: 2 });
    expect(store.has(Pos, 1)).toBe(true);
    expect(store.get(Pos, 1)).toEqual({ x: 1, y: 2 });
    expect(store.get(Vel, 1)).toBeUndefined();
    expect(store.remove(Pos, 1)).toBe(true);
    expect(store.has(Pos, 1)).toBe(false);
    expect(store.remove(Pos, 1)).toBe(false);
  });

  it('keeps types independent', () => {
    const store = new ComponentStore();
    store.add(Pos, 1, { x: 0, y: 0 });
    store.add(Vel, 1, { dx: 5 });
    expect(store.has(Pos, 1)).toBe(true);
    expect(store.has(Vel, 1)).toBe(true);
    expect(store.get(Vel, 1)).toEqual({ dx: 5 });
    store.remove(Vel, 1);
    expect(store.has(Vel, 1)).toBe(false);
    expect(store.has(Pos, 1)).toBe(true);
  });

  it('entitiesWith returns only entities with that component (insertion order)', () => {
    const store = new ComponentStore();
    store.add(Pos, 3, { x: 0, y: 0 });
    store.add(Pos, 1, { x: 0, y: 0 });
    store.add(Pos, 2, { x: 0, y: 0 });
    expect([...store.entitiesWith(Pos)]).toEqual([3, 1, 2]);
  });
});
