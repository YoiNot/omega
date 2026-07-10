/**
 * apps/web — deterministic navigation tests (@omega/nav-core wiring).
 *
 * Proves the NAV half of the vertical slice:
 *  - a seeded terrain always yields the SAME nav grid + SAME A* path;
 *  - the A* path is the shortest solution, verified against an independent BFS
 *    oracle (walk-count on the 4-neighbour grid);
 *  - a blocked / unreachable goal returns a defined result (null, no crash);
 *  - the flow field to a goal is deterministic and consistent with A* distances.
 *
 * All headless (no DOM) — the nav layer is pure grid math.
 */

import { describe, it, expect } from 'vitest';
import { Vec2 } from '@omega/engine-math';
import { TerrainGenerator } from '@omega/world-gen';
import {
  BooleanGrid,
  buildNavGrid,
  pathBetween,
  goalFlowField,
  nearestFreeTile,
} from './nav';
import type { Grid } from './nav';

/** Independent BFS oracle: shortest 4-neighbour WALK COUNT (steps), or null. */
function bfsSteps(grid: Grid, sx: number, sy: number, gx: number, gy: number): number | null {
  const { width, height } = grid;
  if (grid.isBlocked(sx, sy) || grid.isBlocked(gx, gy)) return null;
  const dist = new Int32Array(width * height).fill(-1);
  const q: number[] = [];
  dist[sy * width + sx] = 0;
  q.push(sy * width + sx);
  const deltas = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];
  let head = 0;
  while (head < q.length) {
    const ci = q[head++]!;
    if (ci === gy * width + gx) return dist[ci]!;
    const cx = ci % width;
    const cy = (ci - cx) / width;
    for (const [dx, dy] of deltas) {
      const nx = cx + dx!;
      const ny = cy + dy!;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      if (grid.isBlocked(nx, ny)) continue;
      const ni = ny * width + nx;
      if (dist[ni] !== -1) continue;
      dist[ni] = dist[ci]! + 1;
      q.push(ni);
    }
  }
  return null;
}

describe('apps/web nav-core wiring', () => {
  const SEED = 'omega-demo';
  const SIZE = 40;

  function grid(seed = SEED): BooleanGrid {
    const terrain = new TerrainGenerator(seed, { size: SIZE }).generate();
    return buildNavGrid(terrain);
  }

  it('same seed => identical nav grid (deterministic terrain → grid)', () => {
    const a = grid();
    const b = grid();
    expect(Array.from(a.blocked)).toEqual(Array.from(b.blocked));
    expect(a.width).toBe(b.width);
    expect(a.height).toBe(b.height);
  });

  it('different seed => (generally) different nav grid', () => {
    const a = grid('omega-demo');
    const b = grid('totally-other-seed');
    expect(Array.from(a.blocked)).not.toEqual(Array.from(b.blocked));
  });

  it('same start + goal => identical A* path, and it is the shortest (vs BFS)', () => {
    const g = grid();
    const start = nearestFreeTile(g, 2, 2)!;
    const goal = nearestFreeTile(g, SIZE - 3, SIZE - 3)!;
    const p1 = pathBetween(g, start, goal, { allowDiagonal: false });
    const p2 = pathBetween(g, start, goal, { allowDiagonal: false });
    expect(p1).not.toBeNull();
    // Deterministic: identical path object shape both times.
    expect(p1!.map((v) => [v.x, v.y])).toEqual(p2!.map((v) => [v.x, v.y]));
    // Shortest: A* step count (nodes - 1) equals the BFS walk count.
    const oracle = bfsSteps(g, start.x, start.y, goal.x, goal.y);
    expect(oracle).not.toBeNull();
    expect(p1!.length - 1).toBe(oracle);
    // Path endpoints are exactly start and goal.
    expect([p1![0]!.x, p1![0]!.y]).toEqual([start.x, start.y]);
    const last = p1![p1!.length - 1]!;
    expect([last.x, last.y]).toEqual([goal.x, goal.y]);
  });

  it('blocked goal => null (defined behaviour, no crash)', () => {
    // A tiny hand-built grid with a walled-off goal cell.
    const g = BooleanGrid.fromBooleans([
      [false, false, false],
      [true, true, true],
      [false, false, false],
    ]);
    // start top-left free, goal bottom-left free but separated by a wall row.
    const p = pathBetween(g, new Vec2(0, 0), new Vec2(0, 2), { allowDiagonal: false });
    expect(p).toBeNull();
    // Goal on a blocked tile itself => also null, no throw.
    const p2 = pathBetween(g, new Vec2(0, 0), new Vec2(0, 1), { allowDiagonal: false });
    expect(p2).toBeNull();
  });

  it('flow field to a goal is deterministic and 0 at the goal', () => {
    const g = grid();
    const goal = nearestFreeTile(g, SIZE - 3, SIZE - 3)!;
    const f1 = goalFlowField(g, goal);
    const f2 = goalFlowField(g, goal);
    expect(f1).not.toBeNull();
    expect(f1).toEqual(f2);
    expect(f1![goal.y]![goal.x]).toBe(0);
  });

  it('flow field distance is finite exactly where an A* path exists', () => {
    const g = grid();
    const goal = nearestFreeTile(g, 3, 3)!;
    const field = goalFlowField(g, goal)!;
    const probe = nearestFreeTile(g, SIZE - 4, SIZE - 4)!;
    const reachableByAstar = pathBetween(g, probe, goal, { allowDiagonal: true }) !== null;
    const reachableByField = Number.isFinite(field[probe.y]![probe.x]!);
    expect(reachableByField).toBe(reachableByAstar);
  });
});
