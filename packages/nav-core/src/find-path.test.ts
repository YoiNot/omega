import { describe, it, expect } from 'vitest';
import { Vec2 } from '@omega/engine-math';
import { BooleanGrid } from './grid.js';
import { findPath } from './find-path.js';
import type { Grid } from './grid.js';

/** Brute-force 4/8-neighbour BFS over a free/blocked grid: shortest WALK COUNT. */
function bfsShortestLength(
  grid: Grid,
  sx: number,
  sy: number,
  gx: number,
  gy: number,
  allowDiagonal: boolean,
  cornerCut = false,
): number | null {
  const { width, height } = grid;
  if (sx < 0 || sy < 0 || sx >= width || sy >= height) return null;
  if (gx < 0 || gy < 0 || gx >= width || gy >= height) return null;
  if (grid.isBlocked(sx, sy) || grid.isBlocked(gx, gy)) return null;
  const dist = new Int32Array(width * height).fill(-1);
  const q: number[] = [];
  const startIdx = sy * width + sx;
  dist[startIdx] = 0;
  q.push(startIdx);
  const ortho = [
    [1, 0], [-1, 0], [0, 1], [0, -1],
  ];
  const diag = [
    [1, 1], [1, -1], [-1, 1], [-1, -1],
  ];
  let head = 0;
  while (head < q.length) {
    const ci = q[head++];
    if (ci === gy * width + gx) return dist[ci];
    const cx = ci % width;
    const cy = (ci - cx) / width;
    for (const [dx, dy] of ortho) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      if (grid.isBlocked(nx, ny)) continue;
      const ni = ny * width + nx;
      if (dist[ni] !== -1) continue;
      dist[ni] = dist[ci] + 1;
      q.push(ni);
    }
    if (allowDiagonal) {
      for (const [dx, dy] of diag) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        if (grid.isBlocked(nx, ny)) continue;
        // Mirror A*'s default: prevent cutting through a blocked corner.
        if (!cornerCut) {
          const ox = cx + dx;
          const oy = cy;
          const ox2 = cx;
          const oy2 = cy + dy;
          if (grid.isBlocked(ox, oy) || grid.isBlocked(ox2, oy2)) continue;
        }
        const ni = ny * width + nx;
        if (dist[ni] !== -1) continue;
        dist[ni] = dist[ci] + 1;
        q.push(ni);
      }
    }
  }
  return null;
}

function pathIsContiguous(grid: Grid, path: Vec2[], allowDiagonal: boolean): boolean {
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    const dx = Math.abs(b.x - a.x);
    const dy = Math.abs(b.y - a.y);
    if (allowDiagonal) {
      if (!((dx === 1 && dy === 0) || (dx === 0 && dy === 1) || (dx === 1 && dy === 1))) return false;
    } else {
      if (!(dx + dy === 1)) return false;
    }
    if (grid.isBlocked(b.x, b.y)) return false;
  }
  return true;
}

describe('findPath — 4-neighbour', () => {
  it('straight line on an open grid', () => {
    const g = new BooleanGrid(5, 1);
    const path = findPath(g, new Vec2(0, 0), new Vec2(4, 0));
    expect(path).not.toBeNull();
    expect(path!.length).toBe(5);
    expect(path![0]).toEqual(new Vec2(0, 0));
    expect(path![path!.length - 1]).toEqual(new Vec2(4, 0));
    for (let i = 1; i < path!.length; i++) {
      expect(path![i].y).toBe(0);
      expect(path![i].x).toBe(path![i - 1].x + 1);
    }
  });

  it('includes start and goal', () => {
    const g = new BooleanGrid(3, 3);
    const path = findPath(g, new Vec2(0, 0), new Vec2(2, 2));
    expect(path![0]).toEqual(new Vec2(0, 0));
    expect(path![path!.length - 1]).toEqual(new Vec2(2, 2));
  });

  it('routes around a wall', () => {
    const g = BooleanGrid.fromBooleans([
      [false, true, false, false, false],
      [false, true, false, false, false],
      [false, false, false, false, false],
    ]);
    const path = findPath(g, new Vec2(0, 0), new Vec2(4, 2));
    expect(path).not.toBeNull();
    expect(pathIsContiguous(g, path!, false)).toBe(true);
    expect(path![path!.length - 1]).toEqual(new Vec2(4, 2));
    // never on a blocked cell
    for (const c of path!) expect(g.isBlocked(c.x, c.y)).toBe(false);
  });

  it('returns null when goal unreachable', () => {
    const g = new BooleanGrid(3, 3);
    g.setBlocked(1, 0, true);
    g.setBlocked(1, 1, true);
    g.setBlocked(1, 2, true);
    expect(findPath(g, new Vec2(0, 0), new Vec2(2, 0))).toBeNull();
  });

  it('returns null when start blocked', () => {
    const g = new BooleanGrid(3, 3);
    g.setBlocked(0, 0, true);
    expect(findPath(g, new Vec2(0, 0), new Vec2(2, 2))).toBeNull();
  });

  it('returns null when goal blocked', () => {
    const g = new BooleanGrid(3, 3);
    g.setBlocked(2, 2, true);
    expect(findPath(g, new Vec2(0, 0), new Vec2(2, 2))).toBeNull();
  });

  it('returns null for out-of-bounds start/goal', () => {
    const g = new BooleanGrid(3, 3);
    expect(findPath(g, new Vec2(-1, 0), new Vec2(2, 2))).toBeNull();
    expect(findPath(g, new Vec2(0, 0), new Vec2(9, 9))).toBeNull();
  });

  it('single-cell path when start === goal', () => {
    const g = new BooleanGrid(3, 3);
    expect(findPath(g, new Vec2(1, 1), new Vec2(1, 1))).toEqual([new Vec2(1, 1)]);
  });
});

describe('findPath — 8-neighbour', () => {
  it('uses diagonal moves', () => {
    const g = new BooleanGrid(5, 5);
    const path = findPath(g, new Vec2(0, 0), new Vec2(4, 4), { allowDiagonal: true });
    expect(path).not.toBeNull();
    expect(path!.length).toBe(5); // 4 diagonal steps + start
    expect(pathIsContiguous(g, path!, true)).toBe(true);
    expect(path![path!.length - 1]).toEqual(new Vec2(4, 4));
  });

  it('prevents corner cutting by default', () => {
    const g = new BooleanGrid(2, 2);
    g.setBlocked(1, 0, true);
    g.setBlocked(0, 1, true);
    const path = findPath(g, new Vec2(0, 0), new Vec2(1, 1), { allowDiagonal: true });
    expect(path).toBeNull();
  });

  it('allows corner cut when cornerCut is true', () => {
    const g = new BooleanGrid(2, 2);
    g.setBlocked(1, 0, true);
    g.setBlocked(0, 1, true);
    const path = findPath(g, new Vec2(0, 0), new Vec2(1, 1), { allowDiagonal: true, cornerCut: true });
    expect(path).not.toBeNull();
    expect(path!.length).toBe(2);
  });
});

describe('DETERMINISM + OPTIMALITY', () => {
  it('identical inputs yield identical paths (stable tie-breaks)', () => {
    const g = BooleanGrid.fromBooleans([
      [false, false, false, false, false],
      [false, false, false, false, false],
      [false, false, false, false, false],
      [false, false, false, false, false],
      [false, false, false, false, false],
    ]);
    const a = findPath(g, new Vec2(0, 0), new Vec2(4, 4), { allowDiagonal: true });
    const b = findPath(g, new Vec2(0, 0), new Vec2(4, 4), { allowDiagonal: true });
    expect(a).toEqual(b);
    expect(a).not.toBeNull();
    for (const c of a!) expect(g.isBlocked(c.x, c.y)).toBe(false);
  });

  it('repeated runs on the same open grid are identical', () => {
    const g = new BooleanGrid(10, 10);
    const p1 = findPath(g, new Vec2(0, 0), new Vec2(9, 9), { allowDiagonal: true });
    const p2 = findPath(g, new Vec2(0, 0), new Vec2(9, 9), { allowDiagonal: true });
    expect(p1).toEqual(p2);
  });

  it('path length equals brute-force BFS shortest (4-neighbour, obstacle field)', () => {
    const g = BooleanGrid.fromBooleans([
      [false, false, true, false, false],
      [true, false, true, false, true],
      [false, false, false, false, false],
      [false, true, true, true, false],
      [false, false, false, false, false],
    ]);
    const path = findPath(g, new Vec2(0, 0), new Vec2(4, 4));
    const bf = bfsShortestLength(g, 0, 0, 4, 4, false);
    expect(bf).not.toBeNull();
    // A* path includes start, so its length is bfs-walk-count + 1.
    expect(path!.length).toBe(bf! + 1);
    expect(pathIsContiguous(g, path!, false)).toBe(true);
  });

  it('path length equals brute-force BFS shortest (8-neighbour, obstacle field)', () => {
    const g = BooleanGrid.fromBooleans([
      [false, false, true, false, false],
      [true, false, true, false, true],
      [false, false, false, false, false],
      [false, true, true, true, false],
      [false, false, false, false, false],
    ]);
    const path = findPath(g, new Vec2(0, 0), new Vec2(4, 4), { allowDiagonal: true });
    const bf = bfsShortestLength(g, 0, 0, 4, 4, true);
    expect(bf).not.toBeNull();
    expect(path!.length).toBe(bf! + 1);
    expect(pathIsContiguous(g, path!, true)).toBe(true);
  });

  it('exhaustive optimality: every free start/goal pair matches brute force', () => {
    const W = 6, H = 6;
    // seeded obstacle pattern (deterministic, no RNG)
    const g = new BooleanGrid(W, H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (((x * 3 + y * 5 + ((x * y) % 4)) % 7) === 0) g.setBlocked(x, y, true);
      }
    }
    for (let sy = 0; sy < H; sy++) {
      for (let sx = 0; sx < W; sx++) {
        if (g.isBlocked(sx, sy)) continue;
        for (let gy = 0; gy < H; gy++) {
          for (let gx = 0; gx < W; gx++) {
            if (g.isBlocked(gx, gy)) continue;
            const path = findPath(g, new Vec2(sx, sy), new Vec2(gx, gy), { allowDiagonal: true });
            const bf = bfsShortestLength(g, sx, sy, gx, gy, true);
            if (bf === null) {
              expect(path).toBeNull();
            } else {
              expect(path, `(${sx},${sy})->(${gx},${gy})`).not.toBeNull();
              expect(path!.length, `(${sx},${sy})->(${gx},${gy})`).toBe(bf + 1);
              expect(pathIsContiguous(g, path!, true), `(${sx},${sy})->(${gx},${gy})`).toBe(true);
            }
          }
        }
      }
    }
  });
});
