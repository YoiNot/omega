import { describe, it, expect } from 'vitest';
import { NavGrid } from './grid.js';
import { astar } from './astar.js';

describe('astar', () => {
  it('finds a straight-line path on an open grid (4-neighbour)', () => {
    const g = new NavGrid(5, 1);
    const path = astar(g, { x: 0, y: 0 }, { x: 4, y: 0 });
    expect(path).not.toBeNull();
    expect(path!.length).toBe(5);
    expect(path![0]).toEqual({ x: 0, y: 0 });
    expect(path![path!.length - 1]).toEqual({ x: 4, y: 0 });
    // strictly evolving +x, y constant
    for (let i = 1; i < path!.length; i++) {
      expect(path![i].y).toBe(0);
      expect(path![i].x).toBe(path![i - 1].x + 1);
    }
  });

  it('path includes start and goal', () => {
    const g = new NavGrid(3, 3);
    const path = astar(g, { x: 0, y: 0 }, { x: 2, y: 2 });
    expect(path![0]).toEqual({ x: 0, y: 0 });
    expect(path![path!.length - 1]).toEqual({ x: 2, y: 2 });
  });

  it('routes around a wall', () => {
    const g = NavGrid.fromArray([
      [0, Infinity, 0, 0, 0],
      [0, Infinity, 9, 9, 0],
      [0, 0, 0, 0, 0],
    ]);
    const path = astar(g, { x: 0, y: 0 }, { x: 4, y: 2 });
    expect(path).not.toBeNull();
    // never crosses a blocked cell
    for (const c of path!) {
      expect(g.isWalkable(c.x, c.y)).toBe(true);
      expect(g.get(c.x, c.y)).not.toBe(Infinity);
    }
    // ends at goal
    expect(path![path!.length - 1]).toEqual({ x: 4, y: 2 });
  });

  it('returns null when the goal is unreachable', () => {
    const g = new NavGrid(3, 3);
    g.set(1, 0, Infinity);
    g.set(1, 1, Infinity);
    g.set(1, 2, Infinity);
    // goal on the far side of a full-height wall
    const path = astar(g, { x: 0, y: 0 }, { x: 2, y: 0 });
    expect(path).toBeNull();
  });

  it('returns null when start is blocked', () => {
    const g = new NavGrid(3, 3);
    g.set(0, 0, Infinity);
    expect(astar(g, { x: 0, y: 0 }, { x: 2, y: 2 })).toBeNull();
  });

  it('returns null when goal is blocked', () => {
    const g = new NavGrid(3, 3);
    g.set(2, 2, Infinity);
    expect(astar(g, { x: 0, y: 0 }, { x: 2, y: 2 })).toBeNull();
  });

  it('returns null for out-of-bounds start/goal', () => {
    const g = new NavGrid(3, 3);
    expect(astar(g, { x: -1, y: 0 }, { x: 2, y: 2 })).toBeNull();
    expect(astar(g, { x: 0, y: 0 }, { x: 9, y: 9 })).toBeNull();
  });

  it('returns single-cell path when start === goal', () => {
    const g = new NavGrid(3, 3);
    expect(astar(g, { x: 1, y: 1 }, { x: 1, y: 1 })).toEqual([{ x: 1, y: 1 }]);
  });

  it('uses diagonal moves when allowDiagonal is set', () => {
    const g = new NavGrid(5, 5);
    const path = astar(g, { x: 0, y: 0 }, { x: 4, y: 4 }, { allowDiagonal: true });
    expect(path).not.toBeNull();
    // diagonal-only grid: optimal length is 5 (Manhattan+1 for incl start)
    expect(path!.length).toBe(5);
    expect(path![path!.length - 1]).toEqual({ x: 4, y: 4 });
  });

  it('respects corner-cut prevention by default', () => {
    // Diagonal squeezed between two blocked cells: must not cut the corner.
    const g = new NavGrid(2, 2);
    g.set(1, 0, Infinity);
    g.set(0, 1, Infinity);
    // Without corner cut, (0,0)->(1,1) is impossible (both shared orthogonals blocked).
    const path = astar(g, { x: 0, y: 0 }, { x: 1, y: 1 }, { allowDiagonal: true });
    expect(path).toBeNull();
  });

  it('allows corner cut when cornerCut is true', () => {
    const g = new NavGrid(2, 2);
    g.set(1, 0, Infinity);
    g.set(0, 1, Infinity);
    const path = astar(g, { x: 0, y: 0 }, { x: 1, y: 1 }, { allowDiagonal: true, cornerCut: true });
    expect(path).not.toBeNull();
    expect(path!.length).toBe(2);
  });

  it('DETERMINISM: identical inputs yield identical paths (deep equal)', () => {
    const g = NavGrid.fromArray([
      [0, 0, 9, 0, 0],
      [9, 0, 9, 0, 9],
      [0, 0, 0, 0, 0],
      [0, 9, 9, 9, 0],
      [0, 0, 0, 0, 0],
    ]);
    const a = astar(g, { x: 0, y: 0 }, { x: 4, y: 4 }, { allowDiagonal: true });
    const b = astar(g, { x: 0, y: 0 }, { x: 4, y: 4 }, { allowDiagonal: true });
    expect(a).toEqual(b);
    expect(a).not.toBeNull();
    // and both are valid paths on walkable cells
    for (const c of a!) expect(g.isWalkable(c.x, c.y)).toBe(true);
  });

  it('DETERMINISM: repeated runs on the same open grid are identical', () => {
    const g = new NavGrid(10, 10);
    const p1 = astar(g, { x: 0, y: 0 }, { x: 9, y: 9 }, { allowDiagonal: true });
    const p2 = astar(g, { x: 0, y: 0 }, { x: 9, y: 9 }, { allowDiagonal: true });
    expect(p1).toEqual(p2);
  });
});
