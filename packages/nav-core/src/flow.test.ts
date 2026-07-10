import { describe, it, expect } from 'vitest';
import { Vec2 } from '@omega/engine-math';
import { BooleanGrid } from './grid.js';
import { flowField } from './flow.js';
import { findPath } from './find-path.js';

describe('flowField', () => {
  it('goal cell has distance 0', () => {
    const g = new BooleanGrid(5, 5);
    const f = flowField(g, { x: 2, y: 2 });
    expect(f).not.toBeNull();
    expect(f![2][2]).toBe(0);
  });

  it('returns null for out-of-bounds goal', () => {
    const g = new BooleanGrid(5, 5);
    expect(flowField(g, { x: 9, y: 9 })).toBeNull();
  });

  it('returns null for blocked goal', () => {
    const g = new BooleanGrid(5, 5);
    g.setBlocked(2, 2, true);
    expect(flowField(g, { x: 2, y: 2 })).toBeNull();
  });

  it('distances increase by step cost away from goal (4-neighbour open grid)', () => {
    const g = new BooleanGrid(7, 1);
    const f = flowField(g, { x: 3, y: 0 })!;
    expect(f[0][0]).toBe(3); // 3 steps left
    expect(f[0][1]).toBe(2);
    expect(f[0][2]).toBe(1);
    expect(f[0][3]).toBe(0);
    expect(f[0][4]).toBe(1);
    expect(f[0][5]).toBe(2);
    expect(f[0][6]).toBe(3);
  });

  it('octile distances on an open 2D grid (8-neighbour Dijkstra)', () => {
    const g = new BooleanGrid(5, 5);
    const f = flowField(g, { x: 2, y: 2 })!;
    // (0,0) -> (2,2) is two diagonal steps = 2*√2
    expect(f[0][0]).toBeCloseTo(2 * Math.SQRT2, 10);
    expect(f[1][2]).toBe(1); // one orthogonal step
    expect(f[2][4]).toBe(2); // two orthogonal steps
    expect(f[4][2]).toBe(2);
  });

  it('unreachable cells are Infinity', () => {
    const g = new BooleanGrid(3, 3);
    // wall off the left column entirely
    g.setBlocked(1, 0, true);
    g.setBlocked(1, 1, true);
    g.setBlocked(1, 2, true);
    const f = flowField(g, { x: 2, y: 2 })!;
    // left column disconnected from goal
    expect(f[0][0]).toBe(Infinity);
    expect(f[2][0]).toBe(Infinity);
    expect(f[2][2]).toBe(0);
  });

  it('DETERMINISM: identical grid+goal yields identical field', () => {
    const g = new BooleanGrid(6, 6);
    for (let y = 0; y < 6; y++)
      for (let x = 0; x < 6; x++)
        if (((x * 2 + y * 3) % 5) === 0) g.setBlocked(x, y, true);
    const a = flowField(g, { x: 5, y: 5 })!;
    const b = flowField(g, { x: 5, y: 5 })!;
    expect(a).toEqual(b);
  });

  it('flow field cost-to-goal matches the A* path length at the start cell', () => {
    const g = new BooleanGrid(8, 8);
    for (let y = 0; y < 8; y++)
      for (let x = 0; x < 8; x++)
        if (((x + y * 2) % 6) === 0) g.setBlocked(x, y, true);
    const start = { x: 0, y: 0 };
    const goal = { x: 7, y: 7 };
    const f = flowField(g, goal);
    expect(f).not.toBeNull();
    const path = findPath(g, new Vec2(start.x, start.y), new Vec2(goal.x, goal.y));
    if (path === null) {
      expect(f![start.y][start.x]).toBe(Infinity);
    } else {
      // 4-neighbour step cost is 1, so cost-to-goal == walk count == path.length - 1.
      expect(f![start.y][start.x]).toBe(path.length - 1);
    }
  });
});
