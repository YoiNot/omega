import { describe, it, expect } from 'vitest';
import { ColorGradient } from './color.js';

describe('ColorGradient', () => {
  const g = new ColorGradient();

  it('sample(0) is deep water-ish (blue dominant, low r/g)', () => {
    const c = g.sample(0);
    expect(c).toHaveLength(4);
    expect(c[2]).toBeGreaterThan(c[0]); // blue > red
    expect(c[2]).toBeGreaterThan(c[1]); // blue > green
    expect(c[3]).toBe(255);
  });

  it('sample(1) is snow-ish (near white, all high)', () => {
    const c = g.sample(1);
    expect(c[0]).toBeGreaterThan(240);
    expect(c[1]).toBeGreaterThan(240);
    expect(c[2]).toBeGreaterThan(240);
    expect(c[3]).toBe(255);
  });

  it('sample clamps below 0 and above 1', () => {
    expect(g.sample(-5)).toEqual(g.sample(0));
    expect(g.sample(99)).toEqual(g.sample(1));
  });

  it('sample between stops interpolates', () => {
    const c = g.sample(0.5); // between sand and grass
    expect(c[0]).toBeGreaterThanOrEqual(70);
    expect(c[0]).toBeLessThanOrEqual(225);
    expect(c[3]).toBe(255);
  });

  it('biomeColor returns a valid 4-tuple in [0,255]', () => {
    for (let id = 0; id <= 5; id++) {
      const c = g.biomeColor(id);
      expect(c).toHaveLength(4);
      for (const ch of c) {
        expect(ch).toBeGreaterThanOrEqual(0);
        expect(ch).toBeLessThanOrEqual(255);
      }
    }
  });

  it('biomeColor unknown id returns magenta marker', () => {
    expect(g.biomeColor(999)).toEqual([255, 0, 255, 255]);
  });
});
