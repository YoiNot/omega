import { describe, it, expect } from 'vitest';
import * as nav from './index.js';
import { NavGrid } from './grid.js';

describe('index exports', () => {
  it('exports NavGrid', () => {
    expect(typeof nav.NavGrid).toBe('function');
  });

  it('exports MinHeap', () => {
    expect(typeof nav.MinHeap).toBe('function');
  });

  it('exports astar', () => {
    expect(typeof nav.astar).toBe('function');
  });

  it('exports flowField and flowStep', () => {
    expect(typeof nav.flowField).toBe('function');
    expect(typeof nav.flowStep).toBe('function');
  });

  it('exports DIR_OFFSETS', () => {
    expect(Array.isArray(nav.DIR_OFFSETS)).toBe(true);
    expect(nav.DIR_OFFSETS).toHaveLength(8);
  });

  it('end-to-end: astar + flowField agree on reachability', () => {
    const g = new NavGrid(10, 10);
    expect(nav.astar(g, { x: 0, y: 0 }, { x: 9, y: 9 }, { allowDiagonal: true })).not.toBeNull();
    const f = nav.flowField(g, { x: 9, y: 9 })!;
    expect(Number.isFinite(f.distance[0 * 10 + 0])).toBe(true);
  });
});
