import { describe, it, expect } from 'vitest';
import { Rng, hashString64 } from './rng.js';

describe('Rng determinism', () => {
  it('same seed => identical sequence', () => {
    const a = new Rng(12345);
    const b = new Rng(12345);
    const seqA = Array.from({ length: 100 }, () => a.nextF64());
    const seqB = Array.from({ length: 100 }, () => b.nextF64());
    expect(seqA).toEqual(seqB);
  });

  it('different seeds => different sequences', () => {
    const a = new Rng(1);
    const b = new Rng(2);
    let diff = false;
    for (let i = 0; i < 50; i++) if (a.nextF64() !== b.nextF64()) diff = true;
    expect(diff).toBe(true);
  });

  it('string seed is stable', () => {
    const a = new Rng('omega-seed');
    const b = new Rng('omega-seed');
    expect(a.nextU64()).toBe(b.nextU64());
    expect(hashString64('x')).toBe(hashString64('x'));
    expect(hashString64('x')).not.toBe(hashString64('y'));
  });

  it('nextRange stays within bounds', () => {
    const r = new Rng(7);
    for (let i = 0; i < 1000; i++) {
      const v = r.nextRange(-5, 5);
      expect(v).toBeGreaterThanOrEqual(-5);
      expect(v).toBeLessThan(5);
    }
  });

  it('nextInt inclusive bounds', () => {
    const r = new Rng(99);
    const seen = new Set<number>();
    for (let i = 0; i < 500; i++) {
      const v = r.nextInt(1, 3);
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(3);
      seen.add(v);
    }
    expect(seen.has(1) && seen.has(2) && seen.has(3)).toBe(true);
  });

  it('shuffle is a permutation', () => {
    const r = new Rng(3);
    const arr = [1, 2, 3, 4, 5, 6, 7, 8];
    const before = [...arr];
    const out = r.shuffle(arr);
    expect(out).toHaveLength(8);
    expect([...out].sort((a, b) => a - b)).toEqual(before);
  });

  it('state snapshot/restore is bit-exact', () => {
    const r = new Rng(42);
    for (let i = 0; i < 10; i++) r.nextF64();
    const snap = r.state();
    const a = [r.nextF64(), r.nextF64(), r.nextF64()];
    r.setState(snap);
    const b = [r.nextF64(), r.nextF64(), r.nextF64()];
    expect(a).toEqual(b);
  });

  it('pick returns a member', () => {
    const r = new Rng(5);
    const arr = ['a', 'b', 'c'];
    for (let i = 0; i < 50; i++) expect(arr).toContain(r.pick(arr));
    expect(() => r.pick([])).toThrow();
  });
});
