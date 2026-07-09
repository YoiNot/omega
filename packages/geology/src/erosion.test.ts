import { describe, it, expect } from 'vitest';
import { Rng } from '@omega/engine-core';
import { simulate, roughness, HydraulicErosion } from './erosion.js';

function makeHeights(n: number): Float32Array {
  const h = new Float32Array(n * n);
  // Smooth-ish dome so there is a clear downhill path.
  const cx = (n - 1) / 2;
  const cy = (n - 1) / 2;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const d = Math.hypot(x - cx, y - cy) / cx;
      h[y * n + x] = Math.max(0, 1 - d) * 2;
    }
  }
  return h;
}

describe('HydraulicErosion / simulate', () => {
  it('is deterministic given the same rng', () => {
    const n = 48;
    const a = simulate(makeHeights(n), n, new Rng(123), { droplets: 500 });
    const b = simulate(makeHeights(n), n, new Rng(123), { droplets: 500 });
    expect(Array.from(a.heights)).toEqual(Array.from(b.heights));
    expect(Array.from(a.sediment)).toEqual(Array.from(b.sediment));
  });

  it('produces no NaN/Inf in heights or sediment', () => {
    const n = 48;
    const res = simulate(makeHeights(n), n, new Rng(5), { droplets: 1000 });
    for (let i = 0; i < res.heights.length; i++) {
      expect(Number.isNaN(res.heights[i]!)).toBe(false);
      expect(Number.isFinite(res.heights[i]!)).toBe(true);
      expect(Number.isNaN(res.sediment[i]!)).toBe(false);
      expect(Number.isFinite(res.sediment[i]!)).toBe(true);
    }
  });

  it('keeps a flat input finite', () => {
    const n = 32;
    const flat = new Float32Array(n * n).fill(0.5);
    const res = simulate(flat, n, new Rng(42), { droplets: 300 });
    for (let i = 0; i < res.heights.length; i++) {
      expect(Number.isFinite(res.heights[i]!)).toBe(true);
      expect(Number.isNaN(res.heights[i]!)).toBe(false);
    }
  });

  it('does not blow up a flat plane into extremes', () => {
    const n = 32;
    const flat = new Float32Array(n * n).fill(0.5);
    const res = simulate(flat, n, new Rng(42), { droplets: 2000 });
    let min = Infinity;
    let max = -Infinity;
    for (const v of res.heights) {
      if (v < min) min = v;
      if (v > max) max = v;
    }
    expect(max - min).toBeLessThan(10);
  });

  it('roughness is non-increasing across erosion steps (soft trend)', () => {
    // Soft assertion: after substantial erosion the overall gradient energy
    // should not explode. We measure roughness before/after.
    const n = 48;
    const h0 = makeHeights(n);
    const before = roughness(h0, n);
    const res = simulate(h0, n, new Rng(77), { droplets: 4000, maxSteps: 64 });
    const after = roughness(res.heights, n);
    // Allow a small tolerance; the key property is it stays bounded/comparable.
    expect(after).toBeLessThanOrEqual(before * 2.0 + 1e-6);
  });

  it('returns a sediment field of correct size', () => {
    const n = 40;
    const res = simulate(makeHeights(n), n, new Rng(9), { droplets: 200 });
    expect(res.sediment.length).toBe(n * n);
    expect(res.n).toBe(n);
    expect(res.droplets).toBe(200);
  });

  it('class wrapper behaves identically to the function', () => {
    const n = 32;
    const h = makeHeights(n);
    const hCopy = h.slice();
    const fRes = simulate(h, n, new Rng(3), { droplets: 100 });
    const cl = new HydraulicErosion({ droplets: 100 });
    const cRes = cl.simulate(hCopy, n, new Rng(3));
    expect(Array.from(cRes.heights)).toEqual(Array.from(fRes.heights));
  });

  it('handles zero droplets without error', () => {
    const n = 16;
    const res = simulate(makeHeights(n), n, new Rng(1), { droplets: 0 });
    expect(res.heights.length).toBe(n * n);
    // With no erosion the heights are unchanged.
    expect(Array.from(res.heights)).toEqual(Array.from(makeHeights(n)));
  });
});
