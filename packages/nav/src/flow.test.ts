import { describe, it, expect } from 'vitest';
import { NavGrid } from './grid.js';
import { flowField, flowStep, DIR_OFFSETS } from './flow.js';

describe('flowField', () => {
  it('returns null when goal is blocked', () => {
    const g = new NavGrid(3, 3);
    g.set(2, 2, Infinity);
    expect(flowField(g, { x: 2, y: 2 })).toBeNull();
  });

  it('returns null when goal is out of bounds', () => {
    const g = new NavGrid(3, 3);
    expect(flowField(g, { x: 9, y: 9 })).toBeNull();
  });

  it('goal has distance 0 and direction -1', () => {
    const g = new NavGrid(3, 3);
    const f = flowField(g, { x: 1, y: 1 })!;
    expect(f.distance[1 * 3 + 1]).toBe(0);
    expect(f.direction[1 * 3 + 1]).toBe(-1);
  });

  it('field points downhill toward the goal', () => {
    const g = new NavGrid(5, 1);
    const f = flowField(g, { x: 4, y: 0 })!;
    // walk from the start along the field and arrive at the goal
    let pos = { x: 0, y: 0 };
    const seen = new Set<number>();
    let steps = 0;
    while (!(pos.x === 4 && pos.y === 0)) {
      const key = pos.y * 5 + pos.x;
      expect(seen.has(key)).toBe(false); // no cycles
      seen.add(key);
      const next = flowStep(f, pos.x, pos.y);
      expect(next).not.toBeNull();
      // distance must strictly decrease
      const dBefore = f.distance[pos.y * 5 + pos.x];
      const dAfter = f.distance[next!.y * 5 + next!.x];
      expect(dAfter).toBeLessThan(dBefore);
      pos = next!;
      if (++steps > 100) throw new Error('flow field did not terminate');
    }
  });

  it('marks unreachable cells with Infinity distance and -1 direction', () => {
    const g = new NavGrid(3, 3);
    g.set(1, 0, Infinity);
    g.set(1, 1, Infinity);
    g.set(1, 2, Infinity);
    const f = flowField(g, { x: 2, y: 0 })!;
    // left column is disconnected from the goal on the right column
    expect(f.distance[0 * 3 + 0]).toBe(Infinity);
    expect(f.direction[0 * 3 + 0]).toBe(-1);
    // right column reachable
    expect(f.distance[0 * 3 + 2]).toBe(0);
    expect(Number.isFinite(f.distance[2 * 3 + 2])).toBe(true);
  });

  it('flowStep returns null at goal and for unreachable cells', () => {
    const g = new NavGrid(3, 3);
    g.set(0, 0, Infinity);
    const f = flowField(g, { x: 2, y: 2 })!;
    expect(flowStep(f, 2, 2)).toBeNull(); // at goal
    expect(flowStep(f, 0, 0)).toBeNull(); // unreachable
  });

  it('DETERMINISM: identical grid+goal yield identical fields', () => {
    const g = NavGrid.fromArray([
      [0, 0, 9, 0, 0],
      [9, 0, 9, 0, 9],
      [0, 0, 0, 0, 0],
      [0, 9, 9, 9, 0],
      [0, 0, 0, 0, 0],
    ]);
    const a = flowField(g, { x: 4, y: 4 })!;
    const b = flowField(g, { x: 4, y: 4 })!;
    expect(Array.from(a.distance)).toEqual(Array.from(b.distance));
    expect(Array.from(a.direction)).toEqual(Array.from(b.direction));
  });

  it('steps follow compass offsets', () => {
    // direction 0 is E (+1,0)
    expect(DIR_OFFSETS[0]).toEqual({ dx: 1, dy: 0 });
    // direction 2 is N (0,-1)
    expect(DIR_OFFSETS[2]).toEqual({ dx: 0, dy: -1 });
  });
});
