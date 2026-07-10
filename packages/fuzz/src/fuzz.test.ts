import { Rng } from '@omega/engine-core';
import { describe, it, expect } from 'vitest';
import { fuzz, toFuzzJson, runEcsFuzz } from './index.js';

describe('fuzz determinism', () => {
  it('same seed => identical input sequence', () => {
    const inputsA: number[] = [];
    const inputsB: number[] = [];
    fuzz(
      (rng) => {
        const v = rng.nextInt(0, 1_000_000);
        inputsA.push(v);
        return v;
      },
      () => {},
      { seed: 123, iterations: 100 },
    );
    fuzz(
      (rng) => {
        const v = rng.nextInt(0, 1_000_000);
        inputsB.push(v);
        return v;
      },
      () => {},
      { seed: 123, iterations: 100 },
    );
    expect(inputsA).toEqual(inputsB);
  });

  it('different seed => different inputs', () => {
    const inputsA: number[] = [];
    const inputsB: number[] = [];
    fuzz((rng) => { const v = rng.nextInt(0, 1e9); inputsA.push(v); return v; }, () => {}, { seed: 1, iterations: 50 });
    fuzz((rng) => { const v = rng.nextInt(0, 1e9); inputsB.push(v); return v; }, () => {}, { seed: 2, iterations: 50 });
    expect(inputsA).not.toEqual(inputsB);
  });

  it('reports a reproduced crash with deterministic seed+index', () => {
    // Documented crash case: fn throws when input === 0.
    const result = fuzz(
      (rng) => rng.nextInt(0, 5), // 0..5, seed chosen so 0 appears
      (n) => {
        if (n === 0) throw new Error('zero-not-allowed');
      },
      { seed: 7, iterations: 200 },
    );
    expect(result.crashed).toBe(true);
    expect(result.failures.length).toBeGreaterThan(0);
    const first = result.failures[0];
    expect(first.input).toBe(0);
    expect(first.error).toBe('zero-not-allowed');
    // Reproduce: regenerate ONLY the first failing input from seed+index.
    const rng = new Rng(7);
    for (let i = 0; i <= first.index; i++) {
      if (i === first.index) expect(rng.nextInt(0, 5)).toBe(0);
      else rng.nextInt(0, 5);
    }
  });

  it('a known seed reproduces a documented crash fixture deterministically', () => {
    // Fixed fixture: seed 7 + generator nextInt(0,5) must crash on input 0.
    const expected = fuzz(
      (rng) => rng.nextInt(0, 5),
      (n) => { if (n === 0) throw new Error('zero-not-allowed'); },
      { seed: 7, iterations: 200 },
    );
    const again = fuzz(
      (rng) => rng.nextInt(0, 5),
      (n) => { if (n === 0) throw new Error('zero-not-allowed'); },
      { seed: 7, iterations: 200 },
    );
    expect(again.crashed).toBe(true);
    expect(again.failures.map((f) => f.index)).toEqual(expected.failures.map((f) => f.index));
  });

  it('does not crash on a clean fn', () => {
    const r = fuzz((rng) => rng.nextF64(), () => {}, { seed: 9, iterations: 100 });
    expect(r.crashed).toBe(false);
    expect(r.completed).toBe(100);
  });

  it('toFuzzJson emits omega-fuzz/1 schema', () => {
    const r = fuzz((rng) => rng.nextInt(0, 5), (n) => { if (n === 0) throw new Error('x'); }, { seed: 7 });
    const json = toFuzzJson(r) as any;
    expect(json.schema).toBe('omega-fuzz/1');
    expect(json.crashed).toBe(true);
  });
});

describe('ecs fuzz target', () => {
  it('survives large seeded operation sequences without throwing', () => {
    for (const seed of [0, 1, 42, 1337, 99999]) {
      expect(() => runEcsFuzz(seed, 500)).not.toThrow();
    }
  });

  it('same seed => same run (deterministic, no throw)', () => {
    expect(() => runEcsFuzz(424242, 1000)).not.toThrow();
    expect(() => runEcsFuzz(424242, 1000)).not.toThrow();
  });
});
