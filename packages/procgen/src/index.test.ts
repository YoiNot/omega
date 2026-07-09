import { describe, it, expect } from 'vitest';
import * as procgen from './index.js';

describe('@omega/procgen public API', () => {
  it('re-exports the Rng + makeRng', () => {
    expect(typeof procgen.Rng).toBe('function');
    expect(typeof procgen.makeRng).toBe('function');
    expect(typeof procgen.hashString64).toBe('function');
  });

  it('re-exports the biome classifier + table', () => {
    expect(typeof procgen.classify).toBe('function');
    expect(procgen.BIOME_TABLE).toBeDefined();
    expect(typeof procgen.Biome).toBe('object');
  });

  it('re-exports the scatter field + types', () => {
    expect(typeof procgen.scatterField).toBe('function');
  });

  it('makeRng returns a usable seeded Rng', () => {
    const a = procgen.makeRng('seed-x');
    const b = procgen.makeRng('seed-x');
    expect(a.nextF64()).toBe(b.nextF64());
  });
});
