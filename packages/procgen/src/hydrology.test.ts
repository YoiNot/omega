import { describe, it, expect } from 'vitest';
import { Rng } from '@omega/engine-core';
import {
  computeFlowDirections,
  analyze,
  deriveRivers,
  normalizedArea,
  D8,
} from './hydrology.js';

function makeDome(n: number): Float32Array {
  const h = new Float32Array(n * n);
  const cx = (n - 1) / 2;
  const cy = (n - 1) / 2;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const d = Math.hypot(x - cx, y - cy) / Math.max(1, cx);
      h[y * n + x] = Math.max(0, 1 - d) * 2;
    }
  }
  return h;
}

describe('hydrology: determinism', () => {
  it('same seed + base heights -> identical river network (deriveRivers)', () => {
    const n = 48;
    const base = makeDome(n);
    const a = deriveRivers(base, n, new Rng(123), { erosionDroplets: 600 });
    const b = deriveRivers(base, n, new Rng(123), { erosionDroplets: 600 });
    expect(Array.from(a.flowDir)).toEqual(Array.from(b.flowDir));
    expect(Array.from(a.upstreamArea)).toEqual(Array.from(b.upstreamArea));
    expect(Array.from(a.streamOrder)).toEqual(Array.from(b.streamOrder));
    expect(Array.from(a.isRiver)).toEqual(Array.from(b.isRiver));
  });

  it('analyze on a fixed heightfield is bit-for-bit reproducible', () => {
    const n = 32;
    const h = makeDome(n);
    const a = analyze(h, n, { streamThreshold: 6 });
    const b = analyze(h, n, { streamThreshold: 6 });
    expect(Array.from(a.flowDir)).toEqual(Array.from(b.flowDir));
    expect(Array.from(a.upstreamArea)).toEqual(Array.from(b.upstreamArea));
    expect(Array.from(a.streamOrder)).toEqual(Array.from(b.streamOrder));
  });

  it('different seeds -> different eroded networks', () => {
    const n = 40;
    const base = makeDome(n);
    const a = deriveRivers(base, n, new Rng(1), { erosionDroplets: 400 });
    const b = deriveRivers(base, n, new Rng(2), { erosionDroplets: 400 });
    expect(Array.from(a.flowDir)).not.toEqual(Array.from(b.flowDir));
  });
});

describe('hydrology: flow-direction semantics', () => {
  it('dome: interior cells flow downhill toward the rim; rim cells are sinks', () => {
    const n = 16;
    const h = makeDome(n);
    const flow = computeFlowDirections(h, n);
    // Rim cells are the dome's lowest ring -> local minima -> sinks.
    let rimSinks = 0;
    let rimTotal = 0;
    for (let x = 0; x < n; x++) {
      const coords: Array<[number, number]> = [
        [0, x],
        [n - 1, x],
        [x, 0],
        [x, n - 1],
      ];
      for (const [y, xx] of coords) {
        rimTotal++;
        if (flow[y * n + xx] === -1) rimSinks++;
      }
    }
    // The vast majority of rim cells are sinks (lowest ring).
    expect(rimSinks).toBeGreaterThan(rimTotal * 0.8);
    // The interior mostly has valid downhill outflow.
    let interiorValid = 0;
    let interiorTotal = 0;
    for (let y = 1; y < n - 1; y++) {
      for (let x = 1; x < n - 1; x++) {
        interiorTotal++;
        if (flow[y * n + x] >= 0) interiorValid++;
      }
    }
    expect(interiorValid).toBeGreaterThan(interiorTotal * 0.5);
  });

  it('flat plane produces all sinks (-1)', () => {
    const n = 12;
    const flat = new Float32Array(n * n).fill(0.5);
    const flow = computeFlowDirections(flat, n);
    for (let i = 0; i < flow.length; i++) expect(flow[i]).toBe(-1);
  });

  it('flow direction codes are within the D8 enum', () => {
    const n = 24;
    const h = makeDome(n);
    const flow = computeFlowDirections(h, n);
    for (let i = 0; i < flow.length; i++) {
      const v = flow[i]!;
      if (v !== -1) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(7);
      }
    }
    // sanity: the enum has 8 entries
    expect(Object.keys(D8).length).toBe(8);
  });
});

describe('hydrology: upstream area & stream order', () => {
  it('upstream area is at least 1 everywhere (each cell counts itself)', () => {
    const n = 24;
    const h = makeDome(n);
    const net = analyze(h, n);
    for (let i = 0; i < net.upstreamArea.length; i++) {
      expect(net.upstreamArea[i]!).toBeGreaterThanOrEqual(1);
    }
  });

  it('river cells have stream order >= 1 and non-river cells are 0', () => {
    const n = 48;
    const h = makeDome(n);
    const net = analyze(h, n, { streamThreshold: 8 });
    let riverCount = 0;
    for (let i = 0; i < net.n * net.n; i++) {
      if (net.isRiver[i]) {
        riverCount++;
        expect(net.streamOrder[i]!).toBeGreaterThanOrEqual(1);
      } else {
        expect(net.streamOrder[i]!).toBe(0);
      }
    }
    // A dome should produce at least one river cell above threshold.
    expect(riverCount).toBeGreaterThan(0);
  });

  it('normalizedArea is in [0,1] and has a max of 1', () => {
    const n = 32;
    const h = makeDome(n);
    const net = analyze(h, n);
    const norm = normalizedArea(net);
    let max = 0;
    for (let i = 0; i < norm.length; i++) {
      expect(norm[i]!).toBeGreaterThanOrEqual(0);
      expect(norm[i]!).toBeLessThanOrEqual(1);
      if (norm[i]! > max) max = norm[i]!;
    }
    expect(max).toBeCloseTo(1, 5);
  });

  it('higher streamThreshold yields fewer or equal river cells', () => {
    const n = 48;
    const h = makeDome(n);
    const lo = analyze(h, n, { streamThreshold: 4 });
    const hi = analyze(h, n, { streamThreshold: 20 });
    let loRivers = 0;
    let hiRivers = 0;
    for (let i = 0; i < lo.isRiver.length; i++) {
      if (lo.isRiver[i]) loRivers++;
      if (hi.isRiver[i]) hiRivers++;
    }
    expect(hiRivers).toBeLessThanOrEqual(loRivers);
  });
});

describe('hydrology: no NaN / finite', () => {
  it('deriveRivers produces finite fields', () => {
    const n = 40;
    const base = makeDome(n);
    const net = deriveRivers(base, n, new Rng(7), { erosionDroplets: 500 });
    for (let i = 0; i < net.upstreamArea.length; i++) {
      expect(Number.isFinite(net.upstreamArea[i]!)).toBe(true);
      expect(Number.isNaN(net.upstreamArea[i]!)).toBe(false);
    }
  });
});
