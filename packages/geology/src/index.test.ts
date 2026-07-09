import { describe, it, expect } from 'vitest';
import { PlateSim, HydraulicErosion, simulate, Crust } from './index.js';

describe('index exports', () => {
  it('exports PlateSim', () => {
    expect(typeof PlateSim).toBe('function');
    const f = new PlateSim(1, { gridSize: 8, steps: 2 }).simulate();
    expect(f.heights.length).toBe(64);
  });

  it('exports HydraulicErosion', () => {
    expect(typeof HydraulicErosion).toBe('function');
  });

  it('exports simulate', () => {
    expect(typeof simulate).toBe('function');
  });

  it('exports Crust constants', () => {
    expect(Crust.Oceanic).toBe(0);
    expect(Crust.Continental).toBe(1);
  });
});
