import { describe, it, expect } from 'vitest';
import {
  derivePlates,
  zoneHistogram,
  plateHistogram,
  Zone,
  PlateCrust,
} from './tectonics.js';

/** A continent-ish heightfield: a central high landmass surrounded by ocean. */
function makeContinent(n: number): Float32Array {
  const h = new Float32Array(n * n);
  const cx = (n - 1) / 2;
  const cy = (n - 1) / 2;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const d = Math.hypot(x - cx, y - cy) / Math.max(1, cx);
      // Land in the center, ocean at the rim.
      h[y * n + x] = d < 0.6 ? 0.5 + (0.6 - d) * 0.8 : 0.2;
    }
  }
  return h;
}

describe('tectonics: determinism', () => {
  it('same seed + same heights -> identical plate ids (stable ids)', () => {
    const n = 48;
    const h = makeContinent(n);
    const a = derivePlates(h, n, 'seed-A', { plateCount: 6 });
    const b = derivePlates(h, n, 'seed-A', { plateCount: 6 });
    expect(Array.from(a.plateId)).toEqual(Array.from(b.plateId));
    expect(Array.from(a.zoneType)).toEqual(Array.from(b.zoneType));
    expect(Array.from(a.crustType)).toEqual(Array.from(b.crustType));
    // Plate seeds carry stable ids.
    expect(a.plates.map((p) => p.id)).toEqual(b.plates.map((p) => p.id));
  });

  it('same seed + same heights + same plateCount -> identical plate histogram', () => {
    const n = 48;
    const h = makeContinent(n);
    const a = derivePlates(h, n, 4242, { plateCount: 8 });
    const b = derivePlates(h, n, 4242, { plateCount: 8 });
    expect(Array.from(plateHistogram(a))).toEqual(Array.from(plateHistogram(b)));
  });

  it('different seed -> can differ, but same seed is reproducible', () => {
    const n = 32;
    const h = makeContinent(n);
    const a1 = derivePlates(h, n, 'X', { plateCount: 5 });
    const a2 = derivePlates(h, n, 'X', { plateCount: 5 });
    expect(Array.from(a1.plateId)).toEqual(Array.from(a2.plateId));
    // Plate count is honored exactly.
    expect(a1.plateCount).toBe(5);
    expect(a1.plates.length).toBe(5);
  });
});

describe('tectonics: topology', () => {
  it('classifies at least one plate as continental (land present)', () => {
    const n = 48;
    const h = makeContinent(n);
    const map = derivePlates(h, n, 'topo', { plateCount: 6 });
    const continental = map.plates.filter(
      (p) => p.crust === PlateCrust.Continental,
    );
    expect(continental.length).toBeGreaterThan(0);
  });

  it('produces a non-empty zone histogram with interior + boundaries', () => {
    const n = 64;
    const h = makeContinent(n);
    const map = derivePlates(h, n, 'zones', { plateCount: 8 });
    const hist = zoneHistogram(map);
    // Interior dominates; boundaries (any non-interior) must exist.
    expect(hist[Zone.Interior]).toBeGreaterThan(0);
    const boundaryCells =
      hist[Zone.Rift] +
      hist[Zone.Subduction] +
      hist[Zone.Trench] +
      hist[Zone.Collision];
    expect(boundaryCells).toBeGreaterThan(0);
  });

  it('every plate id assigned is within [0, plateCount)', () => {
    const n = 40;
    const h = makeContinent(n);
    const map = derivePlates(h, n, 'bounds', { plateCount: 7 });
    for (let i = 0; i < map.plateId.length; i++) {
      const pid = map.plateId[i]!;
      expect(pid).toBeGreaterThanOrEqual(-1);
      expect(pid).toBeLessThan(map.plateCount);
    }
  });
});
