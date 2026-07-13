/**
 * @omega/render — determinism + IBL + GTAO composite unit tests.
 *
 * The GPU paths (GBufferPass, GTAO_FRAG) are covered by the browser e2e
 * (apps/web/e2e-render-ao.cjs). These unit tests pin the CPU-side, seed-driven
 * logic that must hold WITHOUT a GPU — the determinism contract is the reason
 * this package exists, so it gets a hard assertion here:
 *
 *   - det_* math mirrors GLSL intent and is a pure function of its inputs.
 *   - bakeEnvMap(seed) is byte-identical for equal seeds and DIFFERS for
 *     different seeds (the "same seed => same world => same pixels" guarantee,
 *     no HDRI asset, $0).
 *   - compositeAO multiplies lit color by AO clamped to [0,1].
 */
import { describe, it, expect } from 'vitest';
import { detInverseSqrt, detSqrt, detDiv, detNormalize3 } from './determinism.js';
import { bakeEnvMap, sampleEnv } from './envmap.js';
import { compositeAO } from './gtao.js';

describe('determinism helpers', () => {
  it('detSqrt matches Math.sqrt within float tolerance', () => {
    // NOTE: det_* pins cross-GPU parity, not IEEE-exactness vs libm (the 2
    // Newton steps trade a few ULPs for identical results on every GPU).
    for (const x of [0.5, 1, 2, 7.3, 100, 9999]) {
      expect(detSqrt(x)).toBeCloseTo(Math.sqrt(x), 3);
    }
  });

  it('detInverseSqrt is 1/sqrt within tolerance', () => {
    for (const x of [0.5, 1, 3, 77]) {
      expect(detInverseSqrt(x)).toBeCloseTo(1 / Math.sqrt(x), 3);
    }
  });

  it('detDiv matches a/b within tolerance', () => {
    for (const [a, b] of [[1, 2], [5, 3], [100, 7]] as [number, number][]) {
      expect(detDiv(a, b)).toBeCloseTo(a / b, 3);
    }
  });

  it('detNormalize3 returns a unit vector', () => {
    for (const v of [[3, 0, 0], [1, 1, 1], [0, -2, 0]] as [number, number, number][]) {
      const n = detNormalize3(v);
      const len = Math.hypot(n[0], n[1], n[2]);
      // det_* pins cross-GPU parity, not IEEE-exactness; 2 Newton steps => ~1e-4.
      expect(len).toBeCloseTo(1, 4);
    }
  });

  it('determinism helpers are pure (same input => same output)', () => {
    expect(detSqrt(2)).toBe(detSqrt(2));
    expect(detDiv(5, 3)).toEqual(detDiv(5, 3));
    expect(detNormalize3([1, 2, 3])).toEqual(detNormalize3([1, 2, 3]));
  });
});

describe('procedural IBL env map (deterministic)', () => {
  it('same seed => byte-identical env map (determinism contract)', () => {
    const a = bakeEnvMap(12345);
    const b = bakeEnvMap(12345);
    expect(a.width).toBe(b.width);
    expect(a.height).toBe(b.height);
    expect(Array.from(a.data)).toEqual(Array.from(b.data));
    expect(a.irradiance).toEqual(b.irradiance);
  });

  it('different seed => different env map', () => {
    const a = bakeEnvMap(1);
    const b = bakeEnvMap(2);
    expect(Array.from(a.data)).not.toEqual(Array.from(b.data));
  });

  it('string seed is accepted and deterministic', () => {
    const a = bakeEnvMap('omega-seed');
    const b = bakeEnvMap('omega-seed');
    expect(Array.from(a.data)).toEqual(Array.from(b.data));
  });

  it('sampleEnv returns the baked radiance for a direction', () => {
    const env = bakeEnvMap(7);
    const up = sampleEnv(env, [0, 1, 0]);
    const down = sampleEnv(env, [0, -1, 0]);
    // Sky should differ from ground (banded gradient), and both finite.
    expect(up[0]).toBeGreaterThanOrEqual(0);
    expect(down[0]).toBeGreaterThanOrEqual(0);
    expect(up).not.toEqual(down);
  });
});

describe('GTAO CPU composite', () => {
  it('compositeAO multiplies lit color by clamped AO', () => {
    const lit: [number, number, number] = [0.8, 0.5, 0.3];
    expect(compositeAO(lit, 0)).toEqual([0, 0, 0]);
    expect(compositeAO(lit, 1)).toEqual([0.8, 0.5, 0.3]);
    expect(compositeAO(lit, 0.5)).toEqual([0.4, 0.25, 0.15]);
  });

  it('compositeAO clamps AO into [0,1]', () => {
    const lit: [number, number, number] = [1, 1, 1];
    expect(compositeAO(lit, -2)).toEqual([0, 0, 0]);
    expect(compositeAO(lit, 3)).toEqual([1, 1, 1]);
  });
});
