/**
 * @omega/nav — flow field (distance + integration field) from a goal.
 *
 * A flow field is a single-source multi-target navigation aid: run one
 * Dijkstra/BFS pass outward from the goal, producing a {@link FlowField} that
 * maps every reachable cell to its distance-to-goal and the direction of its
 * best next step. Many agents can then follow the same field to a shared
 * target for the cost of a single traversal — cheaper than per-agent A*.
 *
 * Determinism: the distances are unique and the Dijkstra expansion is driven by
 * the same deterministic {@link MinHeap} tie-breaking as A*, so identical grid +
 * goal always yield an identical field.
 *
 * Direction encoding (one byte per cell, `Int8Array` length `width*height`):
 *   -1  → unreachable / no step (blocked or disconnected from goal)
 *   0..7 → step via the 8-neighbour compass: 0=E,1=NE,2=N,3=NW,4=W,5=SW,6=S,7=SE
 *
 * NOTE: the internal `distance` accumulator uses Float64 (not Float32). The
 * grid cost layer is Float32 input data, but accumulated path distances need
 * full precision so the lazy-deletion / relaxation comparisons stay exact.
 */

import { MinHeap } from './heap.js';
import { NavGrid } from './grid.js';

/** Compass step offsets indexed by direction byte (0..7). */
export const DIR_OFFSETS: ReadonlyArray<{ dx: number; dy: number }> = [
  { dx: 1, dy: 0 }, // 0 E
  { dx: 1, dy: -1 }, // 1 NE
  { dx: 0, dy: -1 }, // 2 N
  { dx: -1, dy: -1 }, // 3 NW
  { dx: -1, dy: 0 }, // 4 W
  { dx: -1, dy: 1 }, // 5 SW
  { dx: 0, dy: 1 }, // 6 S
  { dx: 1, dy: 1 }, // 7 SE
];

const SQRT2 = Math.SQRT2;

export interface FlowField {
  width: number;
  height: number;
  /**
   * Distance (accumulated cost) from each cell to the goal. `Infinity` for
   * unreachable cells (and out-of-bounds by construction). Float64 precision.
   */
  distance: Float64Array;
  /**
   * Best next-step direction for each cell, encoded as a direction byte (0..7)
   * per {@link DIR_OFFSETS}, or `-1` when the cell is unreachable / the goal.
   */
  direction: Int8Array;
  /** The goal cell this field was computed from. */
  goalX: number;
  goalY: number;
}

/**
 * Compute a flow field from `goal`. Returns `null` if the goal cell is
 * out-of-bounds or blocked.
 */
export function flowField(grid: NavGrid, goal: { x: number; y: number }): FlowField | null {
  const { width, height } = grid;
  const gx = goal.x;
  const gy = goal.y;
  if (!grid.inBounds(gx, gy) || !grid.isWalkable(gx, gy)) return null;

  const n = width * height;
  const distance = new Float64Array(n).fill(Infinity);
  const direction = new Int8Array(n).fill(-1);

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

    // Expand to all 8 neighbours (Dijkstra over a uniform diagonal-capable graph).
    for (let d = 0; d < 8; d++) {
      const { dx, dy } = DIR_OFFSETS[d];
      const nx = cx + dx;
      const ny = cy + dy;
      if (!grid.isWalkable(nx, ny)) continue;
      const nIdx = ny * width + nx;
      const step = d % 2 === 0 ? 1 : SQRT2; // orthogonal=1, diagonal=√2
      const nd = distance[ci] + step + grid.costs[nIdx];
      if (nd < distance[nIdx]) {
        distance[nIdx] = nd;
        // Encode the step FROM this cell TOWARD the goal: reverse of the
        // expansion direction `d` (which points goal→cell). Opposite compass
        // byte is (d + 4) % 8.
        direction[nIdx] = (d + 4) % 8;
        open.push({ idx: nIdx, d: nd });
      }
    }
  }

  return { width, height, distance, direction, goalX: gx, goalY: gy };
}

/**
 * Step once along a flow field from a cell, returning the next cell or `null`
 * when at the goal / unreachable. Pure helper for agents.
 */
export function flowStep(field: FlowField, x: number, y: number): { x: number; y: number } | null {
  if (x < 0 || y < 0 || x >= field.width || y >= field.height) return null;
  const idx = y * field.width + x;
  const dir = field.direction[idx];
  if (dir < 0) return null;
  const { dx, dy } = DIR_OFFSETS[dir];
  return { x: x + dx, y: y + dy };
}
