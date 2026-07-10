import { describe, it, expect } from 'vitest';
import { benchmark, toBenchJson, min, max, mean, median } from './index.js';

describe('stats helpers', () => {
  it('min/max/mean/median of a fixed array', () => {
    const v = [3, 1, 4, 1, 5, 9, 2, 6];
    expect(min(v)).toBe(1);
    expect(max(v)).toBe(9);
    expect(mean(v)).toBeCloseTo(31 / 8, 12);
    // sorted: [1,1,2,3,4,5,6,9] -> mid = (3+4)/2 = 3.5
    expect(median(v)).toBe(3.5);
  });

  it('median of odd length is the middle element', () => {
    expect(median([5, 1, 3])).toBe(3);
  });
});

describe('benchmark determinism', () => {
  it('same iterations + seed => identical metrics', () => {
    const opts = { iterations: 200, seed: 42 };
    const a = benchmark('sum', ({ rng }) => {
      let s = 0;
      for (let i = 0; i < 50; i++) s += rng.nextInt(0, 100);
      return s;
    }, opts);

    // Rebuild from scratch — must match exactly (same samples array).
    const b = benchmark('sum', ({ rng }) => {
      let s = 0;
      for (let i = 0; i < 50; i++) s += rng.nextInt(0, 100);
      return s;
    }, opts);

    expect(a.min).toBe(b.min);
    expect(a.max).toBe(b.max);
    expect(a.median).toBe(b.median);
    expect(a.mean).toBe(b.mean);
    expect(a.samples).toEqual(b.samples);
  });

  it('different seed => different sample sequence', () => {
    const a = benchmark('k', ({ rng }) => rng.nextInt(0, 1_000_000), { iterations: 50, seed: 1 });
    const b = benchmark('k', ({ rng }) => rng.nextInt(0, 1_000_000), { iterations: 50, seed: 2 });
    expect(a.samples).not.toEqual(b.samples);
  });

  it('produces the configured number of iterations', () => {
    const r = benchmark('n', () => 1, { iterations: 7, seed: 3 });
    expect(r.samples).toHaveLength(7);
    expect(r.iterations).toBe(7);
  });

  it('toBenchJson emits a stable, schema-tagged shape', () => {
    const r = benchmark('hash', ({ rng }) => rng.nextInt(0, 255), { iterations: 10, seed: 'omega' });
    const json = toBenchJson(r) as any;
    expect(json.schema).toBe('omega-bench/1');
    expect(json.seed).toBe('omega');
    expect(json.min).toBe(r.min);
    expect(json.median).toBe(r.median);
  });
});
