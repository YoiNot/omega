import { describe, it, expect } from 'vitest';
import { Rng } from '@omega/engine-core';
import { erodeWithRivers, erodeFromSeed, erodedVolume } from './erosion.js';
import { analyze, deriveRivers } from './hydrology.js';

/** A dome/mountain heightfield with a clear drainage — rivers will form. */
function makeMountains(n: number): Float32Array {
  const h = new Float32Array(n * n);
  const cx = (n - 1) / 2;
  const cy = (n - 1) / 2;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const d = Math.hypot(x - cx, y - cy) / Math.max(1, cx);
      // High center, sloping to a lowland rim (above sea level so rivers run).
      h[y * n + x] = 0.4 + Math.max(0, 1 - d) * 0.6;
    }
  }
  return h;
}

describe('erosion: determinism', () => {
  it('same heights, no rng -> identical eroded field (pure function)', () => {
    const n = 48;
    const h = makeMountains(n);
    const a = erodeWithRivers(h, n, undefined, { iterations: 3 });
    const b = erodeWithRivers(h, n, undefined, { iterations: 3 });
    expect(Array.from(a.heights)).toEqual(Array.from(b.heights));
    expect(Array.from(a.sediment)).toEqual(Array.from(b.sediment));
    expect(Array.from(a.net.flowDir)).toEqual(Array.from(b.net.flowDir));
  });

  it('same seed -> identical eroded field (seeded path)', () => {
    const n = 48;
    const h = makeMountains(n);
    const a = erodeFromSeed(h, n, 'ero-seed', {
      iterations: 3,
      sedimentNoise: 0.1,
    });
    const b = erodeFromSeed(h, n, 'ero-seed', {
      iterations: 3,
      sedimentNoise: 0.1,
    });
    expect(Array.from(a.heights)).toEqual(Array.from(b.heights));
  });

  it('input heightfield is not mutated (operates on a copy)', () => {
    const n = 32;
    const h = makeMountains(n);
    const before = Array.from(h);
    erodeWithRivers(h, n, undefined, { iterations: 2 });
    expect(Array.from(h)).toEqual(before);
  });
});

describe('erosion: behaviour', () => {
  it('produces an eroded field distinct from the input on a draining terrain', () => {
    const n = 48;
    const h = makeMountains(n);
    const out = erodeWithRivers(h, n, undefined, { iterations: 4 });
    // At least some cells changed.
    let changed = 0;
    for (let i = 0; i < h.length; i++) {
      if (Math.abs(out.heights[i]! - h[i]!) > 1e-9) changed++;
    }
    expect(changed).toBeGreaterThan(0);
    expect(erodedVolume(out)).toBeGreaterThan(0);
  });

  it('more iterations -> not identical to fewer (monotonic-ish progression)', () => {
    const n = 40;
    const h = makeMountains(n);
    const one = erodeWithRivers(h, n, undefined, { iterations: 1 });
    const many = erodeWithRivers(h, n, undefined, { iterations: 5 });
    // The fields should differ (erosion accumulates across passes).
    expect(Array.from(one.heights)).not.toEqual(Array.from(many.heights));
  });
});

describe('erosion: integration with hydrology (river-coupled)', () => {
  it('erosion reuses the D8 network: final network matches analyze(final field)', () => {
    const n = 48;
    const h = makeMountains(n);
    const out = erodeWithRivers(h, n, undefined, { iterations: 3 });
    // The returned network must be exactly the analysis of the eroded field.
    const recomputed = analyze(out.heights, n, { streamThreshold: 8 });
    expect(Array.from(out.net.flowDir)).toEqual(
      Array.from(recomputed.flowDir),
    );
    expect(Array.from(out.net.upstreamArea)).toEqual(
      Array.from(recomputed.upstreamArea),
    );
  });

  it('same seed -> consistent river+erosion coupling (deterministic end-state)', () => {
    const n = 48;
    const h = makeMountains(n);
    const a = erodeFromSeed(h, n, 'coupled', { iterations: 3 });
    const b = erodeFromSeed(h, n, 'coupled', { iterations: 3 });
    // Eroded field identical -> derived river network identical.
    expect(Array.from(a.heights)).toEqual(Array.from(b.heights));
    expect(Array.from(a.net.flowDir)).toEqual(Array.from(b.net.flowDir));
    expect(Array.from(a.net.streamOrder)).toEqual(
      Array.from(b.net.streamOrder),
    );
  });

  it('eroded terrain yields a river network consistent with deriveRivers base', () => {
    const n = 40;
    const h = makeMountains(n);
    const out = erodeWithRivers(h, n, undefined, { iterations: 2 });
    // The eroded field must itself be a valid, analyzable heightfield that
    // produces a deterministic network (no NaNs, finite values).
    const net = analyze(out.heights, n, { streamThreshold: 8 });
    for (let i = 0; i < net.heights.length; i++) {
      expect(Number.isFinite(net.heights[i]!)).toBe(true);
    }
    // Sanity: deriveRivers on the same eroded field matches analyze (it just
    // adds a deterministic droplet pass which we disable for the comparison).
    const dr = deriveRivers(out.heights, n, new Rng(1), {
      applyErosion: false,
      streamThreshold: 8,
    });
    expect(Array.from(dr.flowDir)).toEqual(Array.from(net.flowDir));
  });
});
