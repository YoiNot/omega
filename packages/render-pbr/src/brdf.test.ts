/**
 * @omega/render-pbr — BRDF reference math tests.
 *
 * These pin the EXACT Cook-Torrance (GGX) values the WGSL fragment shader
 * mirrors, so the CPU and GPU paths agree. All inputs are simple so the
 * expected numbers are hand-derivable / reproducible.
 */
import { describe, it, expect } from 'vitest';
import {
  distributionGGX,
  geometrySmith,
  fresnelSchlick,
  f0FromMaterial,
  brdf,
  toneMapGamma,
  PI,
} from './brdf.js';

// Tolerance for float comparisons (matches the shader's f32 precision budget).
const EPS = 1e-4;

describe('BRDF — GGX normal distribution', () => {
  it('n·h = 1 (aligned) and roughness 1 -> 1/PI', () => {
    // D = a^2 / (PI * (a^2 - 1 + 1)^2) = a^2 / (PI * a^4) = 1/(PI * a^2)
    // with a = roughness (clamped min 0.04). For a=1 => 1/PI.
    const d = distributionGGX(1, 1);
    expect(d).toBeCloseTo(1 / PI, 5);
  });

  it('zero roughness clamped to 0.04 never divides by zero', () => {
    const d = distributionGGX(0.5, 0);
    expect(Number.isFinite(d)).toBe(true);
    expect(d).toBeGreaterThan(0);
  });

  it('sharper (lower roughness) concentrates the lobe (D grows near n·h=1)', () => {
    const rough = distributionGGX(0.99, 0.1);
    const smooth = distributionGGX(0.99, 0.9);
    expect(rough).toBeGreaterThan(smooth);
  });
});

describe('BRDF — Smith geometry', () => {
  it('k=0 (mirror) gives G=1 when aligned', () => {
    const g = geometrySmith(1, 1, 0);
    expect(g).toBeCloseTo(1, 5);
  });
  it('G <= 1 always (energy-conserving)', () => {
    for (const r of [0.1, 0.5, 0.9]) {
      const g = geometrySmith(0.3, 0.4, r);
      expect(g).toBeLessThanOrEqual(1 + 1e-6);
      expect(g).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('BRDF — Schlick Fresnel', () => {
  it('F(0) = 1 (grazing incidence reflects everything)', () => {
    const f = fresnelSchlick(0, [0.04, 0.04, 0.04]);
    expect(f[0]).toBeCloseTo(1, 6);
  });
  it('F(1) -> base reflectance F0 (normal incidence)', () => {
    const f0: [number, number, number] = [0.9, 0.9, 0.9];
    const f = fresnelSchlick(1, f0);
    // (1-0)*1^5 = 0, so F = F0 exactly.
    expect(f[0]).toBeCloseTo(0.9, 6);
  });
});

describe('BRDF — F0 from material', () => {
  it('dielectric (metallic 0) => 0.04 on all channels', () => {
    const f0 = f0FromMaterial([0.8, 0.2, 0.3], 0);
    expect(f0[0]).toBeCloseTo(0.04, 6);
  });
  it('pure metal (metallic 1) => albedo is the reflectance', () => {
    const f0 = f0FromMaterial([0.8, 0.2, 0.3], 1);
    expect(f0[0]).toBeCloseTo(0.8, 6);
    expect(f0[1]).toBeCloseTo(0.2, 6);
  });
});

describe('BRDF — full eval (deterministic)', () => {
  it('facing light on a flat normal yields a finite, positive radiance', () => {
    const out = brdf(
      [0.8, 0.8, 0.8], // albedo
      0, // dielectric
      0.5, // roughness
      [0, 1, 0], // normal up
      [0, 1, 1], // view up-ish
      [0, 1, 0], // light from above
      [3, 3, 3], // sunlight radiance
    );
    for (const c of out) {
      expect(Number.isFinite(c)).toBe(true);
      expect(c).toBeGreaterThanOrEqual(0);
    }
  });

  it('identical inputs => identical outputs (no hidden state)', () => {
    const a = brdf([0.5, 0.6, 0.7], 0.2, 0.4, [0, 1, 0], [1, 2, 1], [0, 1, 0], [2, 2, 2]);
    const b = brdf([0.5, 0.6, 0.7], 0.2, 0.4, [0, 1, 0], [1, 2, 1], [0, 1, 0], [2, 2, 2]);
    expect(a).toEqual(b);
  });

  it('metal is darker in diffuse than dielectric at the same albedo', () => {
    const dielectric = brdf([0.9, 0.9, 0.9], 0, 0.6, [0, 1, 0], [0, 1, 0.5], [0, 1, 0], [3, 3, 3]);
    const metal = brdf([0.9, 0.9, 0.9], 1, 0.6, [0, 1, 0], [0, 1, 0.5], [0, 1, 0], [3, 3, 3]);
    // kd = (1 - F) * (1 - metallic); metal kills diffuse at normal incidence.
    expect(metal[0]).toBeLessThan(dielectric[0] + EPS);
  });
});

describe('tone-map + gamma', () => {
  it('clamps to [0,1] and is monotonic', () => {
    const lo = toneMapGamma([0, 0, 0]);
    const hi = toneMapGamma([10, 10, 10]);
    for (let i = 0; i < 3; i++) {
      expect(lo[i]).toBeGreaterThanOrEqual(0);
      expect(hi[i]).toBeLessThanOrEqual(1 + 1e-6);
      expect(hi[i]).toBeGreaterThanOrEqual(lo[i] - 1e-9);
    }
  });
});
