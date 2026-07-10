/**
 * @omega/nav-core — flow field (distance field) from a goal.
 *
 * A flow field is a single-source multi-target navigation aid: run one
 * Dijkstra/BFS pass outward from the goal, producing a field that maps every
 * reachable cell to its distance-to-goal. Many agents can then consult the same
 * field to reach a shared target for the cost of a single traversal — cheaper
 * than per-agent A*.
 *
 * The field is returned as `number[][]` (row-major `field[y][x]`), matching the
 * requested API. Unreachable / out-of-bounds cells store `Infinity`.
 *
 * Determinism: distances are unique and the Dijkstra expansion is driven by the
 * same deterministic {@link MinHeap} tie-breaking as A*, so identical grid +
 * goal always yield an identical field.
 *
 * NOTE: the internal distance accumulator uses Float64; the `number[][]` result
 * is built from it (Infinity survives the conversion). The grid only reports
 * blocked/free, so there is no cost layer to truncate.
 */

import { MinHeap } from './heap.js';
import type { Grid } from './grid.js';

/** A row-major distance field: `field[y][x]` = cost distance to the goal. */
export type DistanceField = number[][];

// 8-neighbour expansion offsets (E, NE, N, NW, W, SW, S, SE), orthogonal=1,
// diagonal=√2. Order is fixed and part of the deterministic contract.
const NEIGHBOURS = [
  { dx: 1, dy: 0, step: 1 },
  { dx: 1, dy: -1, step: Math.SQRT2 },
  { dx: 0, dy: -1, step: 1 },
  { dx: -1, dy: -1, step: Math.SQRT2 },
  { dx: -1, dy: 0, step: 1 },
  { dx: -1, dy: 1, step: Math.SQRT2 },
  { dx: 0, dy: 1, step: 1 },
  { dx: 1, dy: 1, step: Math.SQRT2 },
];

/**
 * Compute the distance field from `goal` over `grid`.
 * @returns a `number[][]` (row-major) of cost distances, or `null` if the goal
 *          cell is out of bounds or blocked. Unreachable cells are `Infinity`.
 */
export function flowField(grid: Grid, goal: { x: number; y: number }): DistanceField | null {
  const { width, height } = grid;
  const gx = goal.x;
  const gy = goal.y;
  if (gx < 0 || gy < 0 || gx >= width || gy >= height) return null;
  if (grid.isBlocked(gx, gy)) return null;

  const n = width * height;
  const distance = new Float64Array(n).fill(Infinity);

  const goalIdx = gy * width + gx;
  distance[goalIdx] = 0;

  const open = new MinHeap<{ idx: number; d: number }>((a, b) => {
    if (a.d !== b.d) return a.d - b.d;
    return a.idx - b.idx;
  });
  open.push({ idx: goalIdx, d: 0 });

  while (!open.isEmpty()) {
    const cur = open.pop()!;
    const ci = cur.idx;
    if (cur.d > distance[ci]) continue;

    const cx = ci % width;
    const cy = (ci - cx) / width;

    for (let d = 0; d < 8; d++) {
      const { dx, dy, step } = NEIGHBOURS[d];
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      if (grid.isBlocked(nx, ny)) continue;
      const nIdx = ny * width + nx;
      const nd = distance[ci] + step;
      if (nd < distance[nIdx]) {
        distance[nIdx] = nd;
        open.push({ idx: nIdx, d: nd });
      }
    }
  }

  // Materialise as row-major number[][].
  const field: DistanceField = new Array(height);
  for (let y = 0; y < height; y++) {
    const row = new Array<number>(width);
    for (let x = 0; x < width; x++) {
      row[x] = distance[y * width + x];
    }
    field[y] = row;
  }
  return field;
}
