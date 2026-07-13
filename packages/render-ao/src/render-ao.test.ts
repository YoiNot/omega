/**
 * render-ao Spike tests — the evidence the Spike works.
 *
 * These run headless (Node + jsdom-free). We do NOT require a real WebGL2
 * context here (that is covered by Playwright at the apps/web level). Instead
 * we verify the parts that are pure logic + deterministic:
 *
 *   1. det_* math: TS mirrors are finite, positive, and match reference values.
 *   2. GTAO composite: AO in [0,1] darkens lit color (the "occlusion" effect).
 *   3. Determinism: bakeEnvMap(seed) is byte-identical for the same seed and
 *      DIFFERENT for different seeds (proves the seed drives the whole map).
 *   4. IBL sampling: sampleEnv returns finite HDR values inside the buffer.
 *
 * The GPU-side G-Buffer + GTAO shader run is validated separately by the
 * Playwright spike (render-ao.e2e) against SwiftShader.
 */
import { describe, it, expect } from 'vitest';
import { detSqrt, detInverseSqrt, detDiv, detNormalize3 } from './determinism';
import { compositeAO, GTAO_FRAG } from './gtao';
import { bakeEnvMap, sampleEnv, EnvMap } from './envmap';

describe('determinism: det_* shader-math mirrors', () => {
  it('detSqrt matches Math.sqrt within float tolerance', () => {
    // NOTE: det_* pins trade exact IEEE parity with libm for CROSS-GPU parity
    // (that is the whole point — see determinism.ts). 2 Newton steps land
    // within ~4e-4 of the true sqrt, which is the deterministic floor we accept.
    for (const x of [0.5, 1, 2, 7.3, 100, 9999]) {
      expect(detSqrt(x)).toBeCloseTo(Math.sqrt(x), 3);
    }
  });

  it('detInverseSqrt is positive and finite for positive input', () => {
    for (const x of [0.25, 1, 4, 16, 1234.5]) {
      const v = detInverseSqrt(x);
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThan(0);
      expect(v).toBeCloseTo(1 / Math.sqrt(x), 3);
    }
  });

  it('detDiv(a,b) == a/b within tolerance', () => {
    expect(detDiv(10, 4)).toBeCloseTo(2.5, 3);
    expect(detDiv(1, 3)).toBeCloseTo(1 / 3, 3);
  });

  it('detNormalize3 produces unit length', () => {
    const n = detNormalize3([3, 4, 0]);
    const len = Math.hypot(n[0], n[1], n[2]);
    expect(len).toBeCloseTo(1, 5);
  });
});

describe('GTAO compositor', () => {
  it('AO in [0,1] scales lit color down (occlusion darkens)', () => {
    const lit: [number, number, number] = [0.8, 0.9, 1.0];
    const occluded = compositeAO(lit, 0.5);
    expect(occluded[0]).toBeCloseTo(0.4, 5);
    expect(occluded[1]).toBeCloseTo(0.45, 5);
    expect(occluded[2]).toBeCloseTo(0.5, 5);
  });

  it('AO = 1 (no occlusion) leaves color unchanged', () => {
    const lit: [number, number, number] = [0.8, 0.9, 1.0];
    const full = compositeAO(lit, 1.0);
    expect(full[0]).toBeCloseTo(0.8, 6);
  });

  it('GTAO_FRAG shader source references the G-Buffer textures', () => {
    expect(GTAO_FRAG).toContain('uNormal');
    expect(GTAO_FRAG).toContain('uDepth');
    expect(GTAO_FRAG).toContain('texture(uNormal');
    expect(GTAO_FRAG).toContain('texture(uDepth');
  });
});

describe('procedural env map (IBL) determinism', () => {
  it('same seed => byte-identical map', () => {
    const a = bakeEnvMap(12345);
    const b = bakeEnvMap(12345);
    expect(a.data).toEqual(b.data);
    expect(a.irradiance).toEqual(b.irradiance);
  });

  it('different seed => different map (seed actually drives output)', () => {
    const a = bakeEnvMap(12345);
    const b = bakeEnvMap(99999);
    expect(a.data).not.toEqual(b.data);
  });

  it('produces finite, non-negative HDR values', () => {
    const e: EnvMap = bakeEnvMap('omega-sky');
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < e.data.length; i++) {
      const val = e.data[i]!;
      expect(Number.isFinite(val)).toBe(true);
      expect(val).toBeGreaterThanOrEqual(0);
      min = Math.min(min, val);
      max = Math.max(max, val);
    }
    expect(max).toBeGreaterThan(min); // not a flat map
  });

  it('sampleEnv returns finite values and mirrors irradiance region', () => {
    const e = bakeEnvMap(7);
    const up = sampleEnv(e, [0, 1, 0]); // straight up => sky
    const down = sampleEnv(e, [0, -1, 0]); // straight down => ground
    for (const c of [...up, ...down]) {
      expect(Number.isFinite(c)).toBe(true);
      expect(c).toBeGreaterThanOrEqual(0);
    }
    // Sky should be brighter than ground on average (banded gradient).
    expect(up[2]).toBeGreaterThan(down[2] - 1e-6);
  });
});
