/**
 * @omega/nav — A* grid pathfinding.
 *
 * A* over a {@link NavGrid} using the binary {@link MinHeap}. Supports 4- and
 * 8-neighbour movement, with optional corner-cut prevention for diagonals.
 *
 * Determinism: given the same grid, start, goal and options, A* always returns
 * the same path. Tie-breaking between open nodes of equal `f` is performed by
 * ascending heuristic `h` then by cell index, so the search order is fully
 * determined by the inputs (no insertion/heap-order nondeterminism).
 *
 * The returned path INCLUDES both the start and the goal cell. If `start ===
 * goal` the path is `[start]`. Returns `null` when the goal is unreachable.
 *
 * NOTE: the running `gScore` accumulator uses a Float64Array (not Float32),
 * because comparing the full-precision `g` carried on an open node against a
 * Float32-truncated value would make the optimal node appear "stale" and get
 * discarded. The grid cost layer itself stays Float32 (input data).
 */

import { MinHeap } from './heap.js';
import { NavGrid, type Cell } from './grid.js';

export interface AStarOptions {
  /** Allow diagonal (8-neighbour) moves. Default `false` (4-neighbour). */
  allowDiagonal?: boolean;
  /**
   * When diagonal moves are allowed, permit cutting through a blocked corner
   * (i.e. moving diagonally even if one shared orthogonal cell is blocked).
   * Default `false` — corner cutting is prevented.
   */
  cornerCut?: boolean;
  /**
   * Heuristic to use. `octile` (default, admissible for 8-neighbour) or
   * `euclidean` (admissible for both, slightly looser). For 4-neighbour
   * movement `octile` degrades to Manhattan automatically.
   */
  heuristic?: 'octile' | 'euclidean';
}

const SQRT2 = Math.SQRT2;

interface OpenNode {
  idx: number; // y * width + x
  f: number; // g + h
  g: number; // cost from start
  h: number; // heuristic to goal
}

/** Octile distance: admissible for 8-neighbour grids, Manhattan for 4-neighbour. */
function octile(dx: number, dy: number): number {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  return ax > ay ? ay * SQRT2 + (ax - ay) : ax * SQRT2 + (ay - ax);
}

/** Straight-line Euclidean distance. */
function euclidean(dx: number, dy: number): number {
  return Math.hypot(dx, dy);
}

// Orthogonal neighbours (constant, no allocation in the hot loop).
const ORTHO = [
  { dx: 1, dy: 0 },
  { dx: -1, dy: 0 },
  { dx: 0, dy: 1 },
  { dx: 0, dy: -1 },
];
// Diagonal neighbours.
const DIAG = [
  { dx: 1, dy: 1 },
  { dx: 1, dy: -1 },
  { dx: -1, dy: 1 },
  { dx: -1, dy: -1 },
];

/**
 * Find the shortest-cost path from `start` to `goal` on `grid`.
 * @returns the path as `{x,y}[]` (start → goal, inclusive) or `null`.
 */
export function astar(
  grid: NavGrid,
  start: Cell,
  goal: Cell,
  opts: AStarOptions = {},
): Cell[] | null {
  const allowDiagonal = opts.allowDiagonal ?? false;
  const cornerCut = opts.cornerCut ?? false;
  const heuristic = opts.heuristic ?? 'octile';

  const { width, height } = grid;
  const sx = start.x;
  const sy = start.y;
  const gx = goal.x;
  const gy = goal.y;

  if (!grid.inBounds(sx, sy) || !grid.inBounds(gx, gy)) return null;
  if (!grid.isWalkable(sx, sy) || !grid.isWalkable(gx, gy)) return null;
  if (sx === gx && sy === gy) return [{ x: sx, y: sy }];

  const n = width * height;
  // Float64 accumulator: see module note on float32 truncation vs. stale-skip.
  const gScore = new Float64Array(n).fill(Infinity);
  const cameFrom = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);

  const h = heuristic === 'euclidean'
    ? (x: number, y: number) => euclidean(x - gx, y - gy)
    : (x: number, y: number) => octile(x - gx, y - gy);

  const startIdx = sy * width + sx;
  const startH = h(sx, sy);
  gScore[startIdx] = 0;

  // Tie-break: lower f, then lower h, then lower cell index (fully deterministic).
  const open = new MinHeap<OpenNode>((a, b) => {
    if (a.f !== b.f) return a.f - b.f;
    if (a.h !== b.h) return a.h - b.h;
    return a.idx - b.idx;
  });
  open.push({ idx: startIdx, f: startH, g: 0, h: startH });

  const goalIdx = gy * width + gx;

  while (!open.isEmpty()) {
    const cur = open.pop()!;
    const ci = cur.idx;
    // Lazy deletion: skip stale entries superseded by a better g.
    // (gScore is Float64, so cur.g compares exactly against it.)
    if (cur.g > gScore[ci]) continue;
    if (closed[ci]) continue;
    closed[ci] = 1;

    if (ci === goalIdx) {
      return reconstruct(cameFrom, width, ci, sx, sy);
    }

    const cx = ci % width;
    const cy = (ci - cx) / width;

    // Orthogonal neighbours.
    for (let k = 0; k < 4; k++) {
      const nx = cx + ORTHO[k].dx;
      const ny = cy + ORTHO[k].dy;
      relax(grid, open, gScore, cameFrom, closed, width, ci, nx, ny, 1, h);
    }

    // Diagonal neighbours.
    if (allowDiagonal) {
      for (let k = 0; k < 4; k++) {
        const nx = cx + DIAG[k].dx;
        const ny = cy + DIAG[k].dy;
        if (cornerCut) {
          relax(grid, open, gScore, cameFrom, closed, width, ci, nx, ny, SQRT2, h);
        } else {
          // Require both shared orthogonal cells to be walkable (no corner cut).
          const ox = cx + DIAG[k].dx;
          const oy = cy;
          const ox2 = cx;
          const oy2 = cy + DIAG[k].dy;
          if (grid.isWalkable(ox, oy) && grid.isWalkable(ox2, oy2)) {
            relax(grid, open, gScore, cameFrom, closed, width, ci, nx, ny, SQRT2, h);
          }
        }
      }
    }
  }

  return null;
}

/** Try to improve the path to (nx, ny) via `from` at step cost `step`. */
function relax(
  grid: NavGrid,
  open: MinHeap<OpenNode>,
  gScore: Float64Array,
  cameFrom: Int32Array,
  closed: Uint8Array,
  width: number,
  from: number,
  nx: number,
  ny: number,
  step: number,
  h: (x: number, y: number) => number,
): void {
  if (!grid.isWalkable(nx, ny)) return;
  const nIdx = ny * width + nx;
  if (closed[nIdx]) return;
  const tentative = gScore[from] + step + grid.costs[nIdx];
  if (tentative < gScore[nIdx]) {
    gScore[nIdx] = tentative;
    cameFrom[nIdx] = from;
    const nh = h(nx, ny);
    open.push({ idx: nIdx, f: tentative + nh, g: tentative, h: nh });
  }
}

/** Walk `cameFrom` backwards from `goalIdx` to `start` and reverse. */
function reconstruct(
  cameFrom: Int32Array,
  width: number,
  goalIdx: number,
  sx: number,
  sy: number,
): Cell[] {
  const path: Cell[] = [];
  let idx = goalIdx;
  while (idx !== -1) {
    const x = idx % width;
    const y = (idx - x) / width;
    path.push({ x, y });
    if (x === sx && y === sy) break;
    idx = cameFrom[idx];
  }
  path.reverse();
  return path;
}
