import { describe, it, expect } from 'vitest';
import { NavGrid } from './grid.js';

describe('NavGrid', () => {
  it('initialises all cells walkable (cost 0)', () => {
    const g = new NavGrid(4, 3);
    expect(g.width).toBe(4);
    expect(g.height).toBe(3);
    expect(g.costs.length).toBe(12);
    for (let y = 0; y < 3; y++) {
      for (let x = 0; x < 4; x++) {
        expect(g.get(x, y)).toBe(0);
        expect(g.isWalkable(x, y)).toBe(true);
      }
    }
  });

  it('set/get round-trips costs', () => {
    const g = new NavGrid(3, 3);
    g.set(1, 2, 5);
    expect(g.get(1, 2)).toBe(5);
    expect(g.get(0, 0)).toBe(0);
  });

  it('blocked cells use Infinity', () => {
    const g = new NavGrid(3, 3);
    g.set(2, 2, Infinity);
    expect(g.get(2, 2)).toBe(Infinity);
    expect(g.isWalkable(2, 2)).toBe(false);
    expect(Number.isFinite(g.get(2, 2))).toBe(false);
  });

  it('inBounds rejects out-of-range coordinates', () => {
    const g = new NavGrid(3, 3);
    expect(g.inBounds(0, 0)).toBe(true);
    expect(g.inBounds(2, 2)).toBe(true);
    expect(g.inBounds(-1, 0)).toBe(false);
    expect(g.inBounds(0, -1)).toBe(false);
    expect(g.inBounds(3, 0)).toBe(false);
    expect(g.inBounds(0, 3)).toBe(false);
  });

  it('get returns Infinity for out-of-bounds', () => {
    const g = new NavGrid(3, 3);
    expect(g.get(-1, 0)).toBe(Infinity);
    expect(g.get(3, 0)).toBe(Infinity);
    expect(g.get(0, 3)).toBe(Infinity);
  });

  it('set ignores out-of-bounds writes', () => {
    const g = new NavGrid(3, 3);
    g.set(-1, 0, 9);
    g.set(3, 3, 9);
    // unchanged
    expect(g.get(0, 0)).toBe(0);
  });

  it('clamps finite costs to maxCost when set', () => {
    const g = new NavGrid(2, 2, { maxCost: 10 });
    g.set(0, 0, 50);
    expect(g.get(0, 0)).toBe(10);
    g.set(1, 1, -5);
    expect(g.get(1, 1)).toBe(0);
  });

  it('preserves Infinity (blocked) even with maxCost clamp', () => {
    const g = new NavGrid(2, 2, { maxCost: 10 });
    g.set(0, 0, Infinity);
    expect(g.get(0, 0)).toBe(Infinity);
  });

  it('rejects invalid dimensions', () => {
    expect(() => new NavGrid(0, 3)).toThrow();
    expect(() => new NavGrid(3, 0)).toThrow();
    expect(() => new NavGrid(1.5, 2)).toThrow();
  });

  it('fromArray builds a grid from rows', () => {
    const g = NavGrid.fromArray([
      [0, 0, 0],
      [0, 9, 0],
      [0, 0, 0],
    ]);
    expect(g.width).toBe(3);
    expect(g.height).toBe(3);
    expect(g.get(1, 1)).toBe(9);
    expect(g.get(0, 0)).toBe(0);
  });

  it('clone is a deep, independent copy', () => {
    const g = new NavGrid(2, 2);
    g.set(0, 0, 7);
    const c = g.clone();
    expect(c.get(0, 0)).toBe(7);
    c.set(0, 0, 0);
    expect(g.get(0, 0)).toBe(7);
  });
});
