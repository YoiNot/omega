import { describe, it, expect } from 'vitest';
import {
  ValueNoise,
  GradientNoise,
  createNoise,
  clampSample,
} from './noise.js';

describe('noise determinism', () => {
  it('same seed => identical output', () => {
    const a = new GradientNoise(12345);
    const b = new GradientNoise(12345);
    for (let i = 0; i < 50; i++) {
      const x = i * 0.37;
      const y = i * 0.91;
      expect(a.sample2D(x, y)).toBe(b.sample2D(x, y));
      expect(a.sample3D(x, y, i * 0.13)).toBe(b.sample3D(x, y, i * 0.13));
      expect(a.fbm2D(x, y)).toBe(b.fbm2D(x, y));
    }
  });

  it('different seeds => different output', () => {
    const a = new GradientNoise(1);
    const b = new GradientNoise(2);
    let diff = false;
    for (let i = 0; i < 50; i++) {
      if (a.sample2D(i * 0.3, i * 0.7) !== b.sample2D(i * 0.3, i * 0.7)) diff = true;
    }
    expect(diff).toBe(true);
  });

  it('value noise in range [-1, 1]', () => {
    const n = new ValueNoise('value-seed');
    for (let i = 0; i < 200; i++) {
      const v = n.sample2D(i * 0.21, i * 0.57);
      expect(v).toBeGreaterThanOrEqual(-1);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('gradient noise in range [-1, 1]', () => {
    const n = new GradientNoise('grad-seed');
    for (let i = 0; i < 200; i++) {
      const v = n.sample3D(i * 0.21, i * 0.57, i * 0.11);
      expect(v).toBeGreaterThanOrEqual(-1);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('fbm normalized into [-1, 1]', () => {
    const n = new GradientNoise('fbm-seed');
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < 500; i++) {
      const v = n.fbm2D(i * 0.1, i * 0.23, 6, 0.5, 2);
      min = Math.min(min, v);
      max = Math.max(max, v);
    }
    expect(min).toBeGreaterThanOrEqual(-1.0001);
    expect(max).toBeLessThanOrEqual(1.0001);
  });

  it('fbm deterministic across seeds', () => {
    const a = new GradientNoise(7);
    const b = new GradientNoise(7);
    expect(a.fbm3D(1.2, 3.4, 5.6, 4, 0.5, 2)).toBe(b.fbm3D(1.2, 3.4, 5.6, 4, 0.5, 2));
  });

  it('createNoise factory matches concrete classes', () => {
    const v = createNoise('value', 9).sample2D(0.5, 0.5);
    const g = createNoise('gradient', 9).sample2D(0.5, 0.5);
    expect(v).toBe(new ValueNoise(9).sample2D(0.5, 0.5));
    expect(g).toBe(new GradientNoise(9).sample2D(0.5, 0.5));
  });

  it('clampSample bounds the output', () => {
    expect(clampSample(2)).toBe(1);
    expect(clampSample(-2)).toBe(-1);
    expect(clampSample(0.4)).toBe(0.4);
  });
});
