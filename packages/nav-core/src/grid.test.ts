import { describe, it, expect } from 'vitest';
import { BooleanGrid } from './grid.js';

describe('BooleanGrid', () => {
  it('defaults to all-free', () => {
    const g = new BooleanGrid(4, 3);
    expect(g.width).toBe(4);
    expect(g.height).toBe(3);
    expect(g.isBlocked(0, 0)).toBe(false);
    expect(g.isBlocked(3, 2)).toBe(false);
  });

  it('treats out-of-bounds as blocked', () => {
    const g = new BooleanGrid(4, 3);
    expect(g.isBlocked(-1, 0)).toBe(true);
    expect(g.isBlocked(4, 0)).toBe(true);
    expect(g.isBlocked(0, -1)).toBe(true);
    expect(g.isBlocked(0, 3)).toBe(true);
  });

  it('setBlocked / isBlocked round-trips', () => {
    const g = new BooleanGrid(4, 3);
    g.setBlocked(2, 1, true);
    expect(g.isBlocked(2, 1)).toBe(true);
    g.setBlocked(2, 1, false);
    expect(g.isBlocked(2, 1)).toBe(false);
  });

  it('ignores out-of-bounds setBlocked', () => {
    const g = new BooleanGrid(4, 3);
    expect(() => g.setBlocked(99, 99, true)).not.toThrow();
  });

  it('fromBooleans builds row-major', () => {
    const g = BooleanGrid.fromBooleans([
      [false, true, false],
      [false, false, true],
    ]);
    expect(g.width).toBe(3);
    expect(g.height).toBe(2);
    expect(g.isBlocked(1, 0)).toBe(true);
    expect(g.isBlocked(2, 1)).toBe(true);
    expect(g.isBlocked(0, 1)).toBe(false);
  });

  it('rejects invalid dimensions', () => {
    expect(() => new BooleanGrid(0, 3)).toThrow();
    expect(() => new BooleanGrid(3, -1)).toThrow();
  });

  it('clone is independent', () => {
    const g = new BooleanGrid(3, 3);
    g.setBlocked(1, 1, true);
    const c = g.clone();
    c.setBlocked(1, 1, false);
    expect(g.isBlocked(1, 1)).toBe(true);
    expect(c.isBlocked(1, 1)).toBe(false);
  });
});
