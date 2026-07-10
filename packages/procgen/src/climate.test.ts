import { describe, it, expect } from 'vitest';
import {
  climateParamsFromSeed,
  climateCell,
  generateClimateField,
  seasonalSeries,
} from './climate.js';

function makeHeights(n: number): Float32Array {
  const h = new Float32Array(n * n);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      // Simple ramp so we have variety in elevation/latitude.
      h[y * n + x] = ((x + y) / (2 * (n - 1)));
    }
  }
  return h;
}

describe('climate: determinism', () => {
  it('climateParamsFromSeed is identical for the same seed', () => {
    const a = climateParamsFromSeed(12345);
    const b = climateParamsFromSeed(12345);
    expect(a).toEqual(b);
  });

  it('climateParamsFromSeed differs across seeds', () => {
    const a = climateParamsFromSeed(1);
    const b = climateParamsFromSeed(2);
    expect(a).not.toEqual(b);
  });

  it('generateClimateField is bit-for-bit reproducible for a seed', () => {
    const n = 32;
    const h = makeHeights(n);
    const a = generateClimateField(n, h, 'climate-seed-A', { seasonPhase: 0.3 });
    const b = generateClimateField(n, h, 'climate-seed-A', { seasonPhase: 0.3 });
    expect(Array.from(a.temperature)).toEqual(Array.from(b.temperature));
    expect(Array.from(a.humidity)).toEqual(Array.from(b.humidity));
    expect(Array.from(a.precipitation)).toEqual(Array.from(b.precipitation));
    expect(Array.from(a.seasonalTempDelta)).toEqual(Array.from(b.seasonalTempDelta));
    expect(a.seasonPhase).toBeCloseTo(0.3, 10);
  });

  it('same seed, different phase -> different field (seasonality)', () => {
    const n = 24;
    const h = makeHeights(n);
    const summer = generateClimateField(n, h, 'S', { seasonPhase: 0.25 });
    const winter = generateClimateField(n, h, 'S', { seasonPhase: 0.75 });
    expect(Array.from(summer.temperature)).not.toEqual(Array.from(winter.temperature));
  });
});

describe('climate: field value ranges', () => {
  it('all fields are finite and within [0,1]', () => {
    const n = 32;
    const h = makeHeights(n);
    const f = generateClimateField(n, h, 7, { seasonPhase: 0.1 });
    for (const arr of [f.temperature, f.humidity, f.precipitation]) {
      for (let i = 0; i < arr.length; i++) {
        expect(Number.isFinite(arr[i]!)).toBe(true);
        expect(arr[i]!).toBeGreaterThanOrEqual(0);
        expect(arr[i]!).toBeLessThanOrEqual(1);
      }
    }
    for (let i = 0; i < f.seasonalTempDelta.length; i++) {
      expect(Number.isFinite(f.seasonalTempDelta[i]!)).toBe(true);
      expect(f.seasonalTempDelta[i]!).toBeGreaterThanOrEqual(-0.5);
      expect(f.seasonalTempDelta[i]!).toBeLessThanOrEqual(0.5);
    }
  });

  it('equator warmer than poles for the same elevation (no season)', () => {
    const params = climateParamsFromSeed(99);
    const sea = 0.0;
    const eq = climateCell(0.5, sea, true, params, { seasonPhase: 0 });
    const np = climateCell(0.0, sea, true, params, { seasonPhase: 0 });
    const sp = climateCell(1.0, sea, true, params, { seasonPhase: 0 });
    expect(eq.temperature).toBeGreaterThan(np.temperature);
    expect(eq.temperature).toBeGreaterThan(sp.temperature);
  });

  it('higher elevation is cooler at the same latitude (lapse rate)', () => {
    const params = climateParamsFromSeed(5);
    const low = climateCell(0.5, 0.05, true, params, { seasonPhase: 0 });
    const high = climateCell(0.5, 0.9, true, params, { seasonPhase: 0 });
    expect(high.temperature).toBeLessThan(low.temperature);
  });
});

describe('climate: seasons', () => {
  it('seasonalSeries returns the requested number of samples', () => {
    const series = seasonalSeries(0.5, 0.2, true, 42, 12);
    expect(series.length).toBe(12);
    // All finite.
    for (const c of series) {
      expect(Number.isFinite(c.temperature)).toBe(true);
      expect(Number.isFinite(c.seasonalTempDelta)).toBe(true);
    }
  });

  it('northern and southern hemispheres are seasonally opposite', () => {
    const params = climateParamsFromSeed(3);
    const phase = 0.25; // northern summer (warmest north)
    // lat=0.9 -> latSym=+0.8 (Northern hemisphere); lat=0.1 -> latSym=-0.8 (South).
    const north = climateCell(0.9, 0.0, true, params, { seasonPhase: phase });
    const south = climateCell(0.1, 0.0, true, params, { seasonPhase: phase });
    // North warm (+delta), south cool (-delta) at this phase.
    expect(north.seasonalTempDelta).toBeGreaterThan(0);
    expect(south.seasonalTempDelta).toBeLessThan(0);
  });

  it('seasonalSeries is reproducible for the same seed', () => {
    const a = seasonalSeries(0.5, 0.2, true, 11, 8);
    const b = seasonalSeries(0.5, 0.2, true, 11, 8);
    expect(a.map((c) => c.temperature)).toEqual(b.map((c) => c.temperature));
  });
});
