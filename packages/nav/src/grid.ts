/**
 * @omega/nav — NavGrid: a 2D cost grid for pathfinding.
 *
 * Costs are stored in a flat `Float32Array` (row-major: index = y * width + x).
 * By convention:
 *   - `cost === 0`      → free / walkable
 *   - `cost > 0`        → a movement penalty (higher = more expensive)
 *   - `cost === Infinity` → blocked (impassable)
 *
 * Deterministic by construction: there is no randomness and no clock access.
 * The grid is the pure shared substrate consumed by `astar` and `flowField`.
 */

/** A grid coordinate. */
export interface Cell {
  x: number;
  y: number;
}

export interface NavGridOptions {
  /**
   * Maximum walkable cost. Any finite cost passed to `set` is clamped to
   * `[0, maxCost]`. `Infinity` (blocked) is always preserved. Defaults to
   * `Infinity` (no clamping of finite costs).
   */
  maxCost?: number;
}

export class NavGrid {
  readonly width: number;
  readonly height: number;
  readonly costs: Float32Array;
  readonly maxCost: number;

  /**
   * @param width  grid width in cells (>= 1)
   * @param height grid height in cells (>= 1)
   * @param opts   optional maxCost clamp
   */
  constructor(width: number, height: number, opts: NavGridOptions = {}) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
      throw new Error(`NavGrid: invalid dimensions ${width}x${height}`);
    }
    this.width = width;
    this.height = height;
    this.costs = new Float32Array(width * height);
    this.maxCost = opts.maxCost === undefined ? Infinity : opts.maxCost;
  }

  /** Convert (x, y) to the flat array index. Assumes in-bounds. */
  private idx(x: number, y: number): number {
    return y * this.width + x;
  }

  /** True when (x, y) lies inside the grid. */
  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  /**
   * Set the cost of cell (x, y).
   * @param cost `0` walkable, `>0` penalty, `Infinity` blocked.
   *             Finite costs are clamped to `[0, maxCost]`.
   */
  set(x: number, y: number, cost: number): void {
    if (!this.inBounds(x, y)) return;
    const c = cost === Infinity ? Infinity : Math.min(Math.max(cost, 0), this.maxCost);
    this.costs[this.idx(x, y)] = c;
  }

  /** Get the cost of cell (x, y). Out-of-bounds returns `Infinity` (blocked). */
  get(x: number, y: number): number {
    if (!this.inBounds(x, y)) return Infinity;
    return this.costs[this.idx(x, y)];
  }

  /**
   * True when a cell is traversable (finite, non-negative cost).
   * Out-of-bounds is never walkable.
   */
  isWalkable(x: number, y: number): boolean {
    return Number.isFinite(this.get(x, y));
  }

  /** Build a fresh NavGrid from a 2D array of costs (row-major rows[y][x]). */
  static fromArray(rows: number[][], opts: NavGridOptions = {}): NavGrid {
    const height = rows.length;
    if (height === 0) throw new Error('NavGrid.fromArray: empty grid');
    const width = rows[0].length;
    const g = new NavGrid(width, height, opts);
    for (let y = 0; y < height; y++) {
      const row = rows[y];
      for (let x = 0; x < width; x++) {
        g.set(x, y, row[x]);
      }
    }
    return g;
  }

  /** Return a defensive copy of the cost layer. */
  clone(): NavGrid {
    const g = new NavGrid(this.width, this.height, { maxCost: this.maxCost });
    g.costs.set(this.costs);
    return g;
  }
}
