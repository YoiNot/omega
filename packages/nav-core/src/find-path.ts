/**
 * @omega/nav-core — deterministic A* pathfinding.
 *
 * A* over a {@link Grid} using the binary {@link MinHeap}. Supports 4- and
 * 8-neighbour movement, with optional corner-cut prevention for diagonals.
 *
 * Determinism: given the same grid, start, goal and options, A* always returns
 * the same path. Tie-breaking between open nodes of equal `f` (= g + h) falls
 * through to ascending heuristic `h` and finally to ascending cell index, so
 * the expansion order is fully determined by the inputs — there is no
 * insertion-order or heap-shape nondeterminism.
 *
 * The returned path INCLUDES both the start and the goal as {@link Vec2}. If
 * `start === goal` the path is `[start]`. Returns `null` when the goal is
 * unreachable, the start/goal is out of bounds, or either is blocked.
 *
 * `gScore` uses Float64Array (not Float32): comparing the full-precision `g`
 * carried on an open node against a truncated value could make the optimal node
 * look "stale" and be discarded. The grid itself only reports blocked/free, so
 * there is no cost layer to truncate here.
 */

import { Vec2 } from '@omega/engine-math';
import { MinHeap } from './heap.js';
import type { Grid, Path } from './grid.js';

export interface FindPathOptions {
  /** Allow diagonal (8-neighbour) moves. Default `false` (4-neighbour). */
  allowDiagonal?: boolean;
  /**
   * When diagonal moves are allowed, permit cutting through a blocked corner
   * (i.e. moving diagonally even if one shared orthogonal cell is blocked).
   * Default `false` — corner cutting is prevented.
   */
  cornerCut?: boolean;
}

const SQRT2 = Math.SQRT2;

interface OpenNode {
  idx: number; // y * width + x
  g: number; // cost from start
  f: number; // g + h
  h: number; // heuristic to goal
}

// Orthogonal neighbours. Order is fixed and part of the deterministic contract.
const ORTHO = [
  { dx: 1, dy: 0 },
  { dx: -1, dy: 0 },
  { dx: 0, dy: 1 },
  { dx: 0, dy: -1 },
];
// Diagonal neighbours (matching ORTHO orientation order).
const DIAG = [
  { dx: 1, dy: 1 },
  { dx: 1, dy: -1 },
  { dx: -1, dy: 1 },
  { dx: -1, dy: -1 },
];

/** Manhattan distance — admissible for 4-neighbour movement. */
function manhattan(dx: number, dy: number): number {
  return Math.abs(dx) + Math.abs(dy);
}

/** Octile distance — admissible for 8-neighbour movement. */
function octile(dx: number, dy: number): number {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  return ax > ay ? ay * SQRT2 + (ax - ay) : ax * SQRT2 + (ay - ax);
}

/**
 * Find the shortest path from `start` to `goal` on `grid`.
 * @returns the path as `Vec2[]` (start → goal, inclusive) or `null`.
 */
export function findPath(
  grid: Grid,
  start: Vec2,
  goal: Vec2,
  opts: FindPathOptions = {},
): Path | null {
  const allowDiagonal = opts.allowDiagonal ?? false;
  const cornerCut = opts.cornerCut ?? false;
  const heuristic = allowDiagonal ? octile : manhattan;

  const { width, height } = grid;
  const sx = start.x;
  const sy = start.y;
  const gx = goal.x;
  const gy = goal.y;

  if (sx < 0 || sy < 0 || sx >= width || sy >= height) return null;
  if (gx < 0 || gy < 0 || gx >= width || gy >= height) return null;
  if (grid.isBlocked(sx, sy) || grid.isBlocked(gx, gy)) return null;
  if (sx === gx && sy === gy) return [new Vec2(sx, sy)];

  const n = width * height;
  const gScore = new Float64Array(n).fill(Infinity);
  const cameFrom = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);

  const startIdx = sy * width + sx;
  const startH = heuristic(sx - gx, sy - gy);
  gScore[startIdx] = 0;

  // Tie-break: lower f, then lower h, then lower cell index (fully deterministic).
  const open = new MinHeap<OpenNode>((a, b) => {
    if (a.f !== b.f) return a.f - b.f;
    if (a.h !== b.h) return a.h - b.h;
    return a.idx - b.idx;
  });
  open.push({ idx: startIdx, g: 0, f: startH, h: startH });

  const goalIdx = gy * width + gx;

  while (!open.isEmpty()) {
    const cur = open.pop()!;
    const ci = cur.idx;
    // Lazy deletion: skip stale entries superseded by a better g.
    if (cur.g > gScore[ci]) continue;
    if (closed[ci]) continue;
    closed[ci] = 1;

    if (ci === goalIdx) {
      return reconstruct(cameFrom, width, ci, sx, sy);
    }

    const cx = ci % width;
    const cy = (ci - cx) / width;

    for (let k = 0; k < 4; k++) {
      const nx = cx + ORTHO[k].dx;
      const ny = cy + ORTHO[k].dy;
      relax(grid, open, gScore, cameFrom, closed, width, ci, nx, ny, 1, heuristic, gx, gy);
    }

    if (allowDiagonal) {
      for (let k = 0; k < 4; k++) {
        const nx = cx + DIAG[k].dx;
        const ny = cy + DIAG[k].dy;
        if (cornerCut) {
          relax(grid, open, gScore, cameFrom, closed, width, ci, nx, ny, SQRT2, heuristic, gx, gy);
        } else {
          // Require both shared orthogonal cells to be free (no corner cut).
          const ox = cx + DIAG[k].dx;
          const oy = cy;
          const ox2 = cx;
          const oy2 = cy + DIAG[k].dy;
          if (!grid.isBlocked(ox, oy) && !grid.isBlocked(ox2, oy2)) {
            relax(grid, open, gScore, cameFrom, closed, width, ci, nx, ny, SQRT2, heuristic, gx, gy);
          }
        }
      }
    }
  }

  return null;
}

/** Try to improve the path to (nx, ny) via `from` at step cost `step`. */
function relax(
  grid: Grid,
  open: MinHeap<OpenNode>,
  gScore: Float64Array,
  cameFrom: Int32Array,
  closed: Uint8Array,
  width: number,
  from: number,
  nx: number,
  ny: number,
  step: number,
  heuristic: (dx: number, dy: number) => number,
  gx: number,
  gy: number,
): void {
  if (nx < 0 || ny < 0 || nx >= width || ny >= grid.height) return;
  if (grid.isBlocked(nx, ny)) return;
  const nIdx = ny * width + nx;
  if (closed[nIdx]) return;
  const tentative = gScore[from] + step;
  if (tentative < gScore[nIdx]) {
    gScore[nIdx] = tentative;
    cameFrom[nIdx] = from;
    const nh = heuristic(nx - gx, ny - gy);
    open.push({ idx: nIdx, g: tentative, f: tentative + nh, h: nh });
  }
}

/** Walk `cameFrom` backwards from `goalIdx` to `start` and reverse. */
function reconstruct(
  cameFrom: Int32Array,
  width: number,
  goalIdx: number,
  sx: number,
  sy: number,
): Path {
  const path: Path = [];
  let idx = goalIdx;
  while (idx !== -1) {
    const x = idx % width;
    const y = (idx - x) / width;
    path.push(new Vec2(x, y));
    if (x === sx && y === sy) break;
    idx = cameFrom[idx];
  }
  path.reverse();
  return path;
}
