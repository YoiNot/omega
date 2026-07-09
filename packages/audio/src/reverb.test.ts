import { describe, it, expect } from 'vitest';
import {
  DryReverb,
  SimpleConvolutionReverb,
} from './reverb.js';

describe('DryReverb', () => {
  it('is a passthrough equal to the input', () => {
    const r = new DryReverb();
    const input = Float32Array.from([0.1, -0.2, 0.3, 0.0, 0.5]);
    const out = r.process(input);
    expect(out).toBe(input); // same reference (no copy)
    expect(Array.from(out)).toEqual(Array.from(input));
  });
});

describe('SimpleConvolutionReverb', () => {
  it('is deterministic for a seeded impulse response', () => {
    const a = new SimpleConvolutionReverb({ seed: 42, length: 64 });
    const b = new SimpleConvolutionReverb({ seed: 42, length: 64 });
    const input = Float32Array.from([1, 0, 0, 0, 0]);
    const oa = a.process(input);
    const ob = b.process(input);
    expect(Array.from(oa)).toEqual(Array.from(ob));
  });

  it('produces finite (non-NaN) output for a seeded IR', () => {
    const r = new SimpleConvolutionReverb({ seed: 5, length: 128 });
    const input = Float32Array.from([0.5, -0.5, 0.25, 0.1]);
    const out = r.process(input);
    for (const v of out) {
      expect(Number.isFinite(v)).toBe(true);
      expect(Number.isNaN(v)).toBe(false);
    }
  });

  it('returns a sane output length (linear conv length)', () => {
    const n = 10;
    const m = 64;
    const r = new SimpleConvolutionReverb({ seed: 1, length: m });
    const input = new Float32Array(n).fill(0.3);
    const out = r.process(input);
    expect(out.length).toBe(n + m - 1);
  });

  it('differs for different seeds', () => {
    const a = new SimpleConvolutionReverb({ seed: 11, length: 32 });
    const b = new SimpleConvolutionReverb({ seed: 22, length: 32 });
    const input = Float32Array.from([1, 0, 0]);
    const oa = a.process(input);
    const ob = b.process(input);
    expect(Array.from(oa)).not.toEqual(Array.from(ob));
  });
});
