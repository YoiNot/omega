/**
 * @omega/nav-core — Grid abstraction.
 *
 * The navigation layer is intentionally decoupled from the ECS: it operates
 * purely on integer tile coordinates, never on entities or components. A
 * {@link Grid} is anything that reports its dimensions and whether a tile is
 * blocked. Concrete grids (e.g. {@link BooleanGrid}, backed by a flat boolean
 * array) implement this interface; higher layers (A*, flow fields) consume the
 * abstraction without knowing how blocked-ness is stored.
 *
 * Deterministic by construction: no randomness, no clock access.
 */

import { Vec2 } from '@omega/engine-math';

/** A path as an ordered list of tile coordinates (start → goal, inclusive). */
export type Path = Vec2[];

/**
 * Minimal navigation grid interface. Coordinates are integer tile indices with
 * `(0, 0)` at the top-left, `x` increasing to the right and `y` downward.
 */
export interface Grid {
  /** Grid width in tiles (>= 1). */
  readonly width: number;
  /** Grid height in tiles (>= 1). */
  readonly height: number;
  /**
   * True when tile `(x, y)` is blocked (impassable). Out-of-bounds tiles are
   * always treated as blocked by the search algorithms; this method's contract
   * is for in-bounds coordinates, but implementers may return `true` for
   * out-of-bounds to be safe.
   */
  isBlocked(x: number, y: number): boolean;
}

/**
 * A simple grid backed by a flat `Uint8Array` (row-major: `index = y * width + x`).
 * Blocked tiles are stored as `1`, free tiles as `0`. This is the canonical
 * concrete {@link Grid} used by tests and small maps.
 *
 * Out-of-bounds coordinates read as blocked (so callers never have to bounds-
 * check before testing walkability — the search treats the world edge as a wall).
 */
export class BooleanGrid implements Grid {
  readonly width: number;
  readonly height: number;
  /** Row-major blocked flags (`1` blocked, `0` free). Length `width * height`. */
  readonly blocked: Uint8Array;

  constructor(width: number, height: number, blocked?: Uint8Array) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
      throw new Error(`BooleanGrid: invalid dimensions ${width}x${height}`);
    }
    this.width = width;
    this.height = height;
    this.blocked = blocked ?? new Uint8Array(width * height);
    if (this.blocked.length !== width * height) {
      throw new Error(
        `BooleanGrid: blocked array length ${this.blocked.length} != ${width * height}`,
      );
    }
  }

  private idx(x: number, y: number): number {
    return y * this.width + x;
  }

  /** True when `(x, y)` lies inside the grid bounds. */
  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  /** Set a tile blocked (`true`) or free (`false`). Out-of-bounds is ignored. */
  setBlocked(x: number, y: number, blocked: boolean): void {
    if (!this.inBounds(x, y)) return;
    this.blocked[this.idx(x, y)] = blocked ? 1 : 0;
  }

  isBlocked(x: number, y: number): boolean {
    if (!this.inBounds(x, y)) return true;
    return this.blocked[this.idx(x, y)] === 1;
  }

  /**
   * Build a BooleanGrid from a 2D array of booleans (row-major `rows[y][x]`).
   * `true` => blocked, `false` => free.
   */
  static fromBooleans(rows: boolean[][]): BooleanGrid {
    const height = rows.length;
    if (height === 0) throw new Error('BooleanGrid.fromBooleans: empty grid');
    const width = rows[0].length;
    const g = new BooleanGrid(width, height);
    for (let y = 0; y < height; y++) {
      const row = rows[y];
      for (let x = 0; x < width; x++) {
        g.blocked[g.idx(x, y)] = row[x] ? 1 : 0;
      }
    }
    return g;
  }

  /** Return a defensive copy. */
  clone(): BooleanGrid {
    return new BooleanGrid(this.width, this.height, this.blocked.slice());
  }
}
