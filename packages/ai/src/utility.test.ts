import { describe, it, expect } from 'vitest';
import {
  scoreOption,
  chooseBest,
  linear,
  quadratic,
  inverse,
  logistic,
  UtilityOption,
} from './utility.js';

describe('utility curves', () => {
  it('linear is identity on [0,1]', () => {
    expect(linear(0)).toBe(0);
    expect(linear(0.5)).toBeCloseTo(0.5);
    expect(linear(1)).toBe(1);
  });

  it('quadratic favors high inputs', () => {
    expect(quadratic(0)).toBe(0);
    expect(quadratic(0.5)).toBeCloseTo(0.25);
    expect(quadratic(1)).toBe(1);
    expect(quadratic(0.3)).toBeLessThan(linear(0.3));
  });

  it('inverse favors low inputs', () => {
    expect(inverse(0)).toBe(0);
    expect(inverse(0.5)).toBeCloseTo(0.75);
    expect(inverse(1)).toBe(1);
    expect(inverse(0.3)).toBeGreaterThan(linear(0.3));
  });

  it('logistic is an S-curve centered at 0.5', () => {
    expect(logistic()(0.5)).toBeCloseTo(0.5);
    expect(logistic()(0.5)).toBeGreaterThan(logistic()(0.2));
    expect(logistic()(0.8)).toBeGreaterThan(logistic()(0.5));
    // Monotonic increasing.
    expect(logistic()(0.1)).toBeLessThan(logistic()(0.9));
  });

  it('curves clamp inputs outside [0,1]', () => {
    expect(linear(-2)).toBe(0);
    expect(quadratic(5)).toBe(1);
  });
});

const ctx = { hunger: 0.8, threat: 0.1 };

describe('scoreOption', () => {
  const options: UtilityOption[] = [
    {
      name: 'eat',
      considerations: [
        { input: (c: unknown) => (c as any).hunger, curve: linear },
        { input: (c: unknown) => 1 - (c as any).threat, curve: linear },
      ],
    },
    {
      name: 'flee',
      considerations: [{ input: (c: unknown) => (c as any).threat, curve: quadratic }],
    },
  ];

  it('product stays within [0,1]', () => {
    const s = scoreOption(options[0], ctx);
    expect(s).toBeGreaterThanOrEqual(0);
    expect(s).toBeLessThanOrEqual(1);
    expect(s).toBeCloseTo(0.8 * 0.9);
  });

  it('empty considerations score 0 (never wins)', () => {
    const s = scoreOption({ name: 'none', considerations: [] }, ctx);
    expect(s).toBe(0);
  });

  it('min blend picks the weakest consideration', () => {
    // eat with min blend: min(0.8, 0.9) = 0.8
    const s = scoreOption(options[0], ctx, 'min');
    expect(s).toBeCloseTo(0.8);
  });
});

describe('chooseBest', () => {
  const options: UtilityOption[] = [
    { name: 'a', considerations: [{ input: () => 0.2, curve: linear }] },
    { name: 'b', considerations: [{ input: () => 0.9, curve: linear }] },
    { name: 'c', considerations: [{ input: () => 0.5, curve: linear }] },
  ];

  it('picks the highest-scoring option', () => {
    const best = chooseBest(options, ctx);
    expect(best?.name).toBe('b');
  });

  it('resolves ties deterministically (first max)', () => {
    const tied: UtilityOption[] = [
      { name: 'first', considerations: [{ input: () => 0.5, curve: linear }] },
      { name: 'second', considerations: [{ input: () => 0.5, curve: linear }] },
    ];
    expect(chooseBest(tied, ctx)?.name).toBe('first');
  });

  it('returns null for empty options', () => {
    expect(chooseBest([], ctx)).toBeNull();
  });

  it('is deterministic across calls', () => {
    expect(chooseBest(options, ctx)?.name).toBe(chooseBest(options, ctx)?.name);
  });
});
