import { describe, it, expect } from 'vitest';
import { scatterField } from './scatter.js';

describe('scatterField', () => {
  it('is deterministic for the same seed', () => {
    const opts = { seed: 12345, count: 50 };
    const a = scatterField(opts);
    const b = scatterField(opts);
    expect(a).toEqual(b);
  });

  it('different seeds => different point sets', () => {
    const a = scatterField({ seed: 1, count: 40 });
    const b = scatterField({ seed: 2, count: 40 });
    expect(a).not.toEqual(b);
  });

  it('respects the requested count', () => {
    const pts = scatterField({ seed: 7, count: 120 });
    expect(pts.length).toBe(120);
  });

  it('returns an empty array for non-positive count', () => {
    expect(scatterField({ seed: 1, count: 0 })).toEqual([]);
    expect(scatterField({ seed: 1, count: -5 })).toEqual([]);
  });

  it('all points stay within the default bounds', () => {
    const pts = scatterField({ seed: 99, count: 200 });
    for (const p of pts) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(1);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(1);
    }
  });

  it('all points stay within custom bounds', () => {
    const b = { x: 10, y: 20, w: 30, h: 40 };
    const pts = scatterField({ seed: 3, count: 150, bounds: b });
    for (const p of pts) {
      expect(p.x).toBeGreaterThanOrEqual(b.x);
      expect(p.x).toBeLessThanOrEqual(b.x + b.w);
      expect(p.y).toBeGreaterThanOrEqual(b.y);
      expect(p.y).toBeLessThanOrEqual(b.y + b.h);
    }
  });

  it('returns empty for a degenerate (zero-area) bounds', () => {
    expect(scatterField({ seed: 1, count: 10, bounds: { x: 0, y: 0, w: 0, h: 0 } })).toEqual([]);
  });

  it('respects an explicit minimum-distance radius', () => {
    const r = 0.2;
    const pts = scatterField({ seed: 42, count: 25, radius: r });
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        const dx = pts[i]!.x - pts[j]!.x;
        const dy = pts[i]!.y - pts[j]!.y;
        // Allow tiny float tolerance below the nominal radius.
        expect(dx * dx + dy * dy).toBeGreaterThanOrEqual(r * r * 0.95 * 0.95);
      }
    }
  });

  it('assigns kinds from provided weights', () => {
    const kinds = [
      { kind: 'tree', weight: 1 },
      { kind: 'rock', weight: 1 },
    ];
    const pts = scatterField({ seed: 5, count: 100, kinds });
    const seen = new Set(pts.map((p) => p.kind));
    expect(seen.has('tree')).toBe(true);
    expect(seen.has('rock')).toBe(true);
  });

  it('uses a single default kind when no kinds supplied', () => {
    const pts = scatterField({ seed: 11, count: 20 });
    expect(pts.every((p) => p.kind === 'feature')).toBe(true);
  });

  it('scales stay within [minScale, maxScale]', () => {
    const min = 0.8;
    const max = 1.2;
    const pts = scatterField({ seed: 8, count: 60, minScale: min, maxScale: max });
    for (const p of pts) {
      expect(p.scale).toBeGreaterThanOrEqual(min);
      expect(p.scale).toBeLessThanOrEqual(max);
    }
  });

  it('caps below count for a tiny high-radius area (documented cap)', () => {
    // radius too large for the area -> Poisson-disk can't fit `count` points.
    const pts = scatterField({ seed: 1, count: 100, bounds: { x: 0, y: 0, w: 1, h: 1 }, radius: 0.5 });
    expect(pts.length).toBeLessThan(100);
    expect(pts.length).toBeGreaterThan(0);
  });
});
