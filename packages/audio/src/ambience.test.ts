import { describe, it, expect } from 'vitest';
import { AmbienceGenerator } from './ambience.js';

describe('AmbienceGenerator', () => {
  it('is deterministic: same seed => same event sequence', () => {
    const a = new AmbienceGenerator({ seed: 12345 });
    const b = new AmbienceGenerator({ seed: 12345 });
    const seqA: number[] = [];
    const seqB: number[] = [];
    for (let t = 0; t < 30; t += 0.05) {
      const eA = a.nextEvent(t);
      const eB = b.nextEvent(t);
      if (eA) seqA.push(eA.freq, eA.gain, eA.duration);
      if (eB) seqB.push(eB.freq, eB.gain, eB.duration);
    }
    expect(seqA).toEqual(seqB);
    expect(seqA.length).toBeGreaterThan(0);
  });

  it('produces different events for different seeds', () => {
    const a = new AmbienceGenerator({ seed: 1 });
    const b = new AmbienceGenerator({ seed: 2 });
    const firstA = a.nextEvent(0);
    const firstB = b.nextEvent(0);
    // Extremely unlikely to collide on all three fields; guard against flakiness.
    expect(JSON.stringify(firstA)).not.toEqual(JSON.stringify(firstB));
  });

  it('keeps all gains within [0, 1]', () => {
    const g = new AmbienceGenerator({ seed: 99, masterGain: 1 });
    for (let t = 0; t < 30; t += 0.03) {
      const e = g.nextEvent(t);
      if (e) {
        expect(e.gain).toBeGreaterThanOrEqual(0);
        expect(e.gain).toBeLessThanOrEqual(1);
      }
    }
  });

  it('never emits NaN values', () => {
    const g = new AmbienceGenerator({ seed: 7 });
    for (let t = 0; t < 30; t += 0.02) {
      const e = g.nextEvent(t);
      if (e) {
        expect(Number.isNaN(e.freq)).toBe(false);
        expect(Number.isNaN(e.gain)).toBe(false);
        expect(Number.isNaN(e.duration)).toBe(false);
      }
    }
  });

  it('does not double-emit at the same clock time', () => {
    const g = new AmbienceGenerator({ seed: 3 });
    const e1 = g.nextEvent(0); // first event due at t=0
    const e2 = g.nextEvent(0); // same instant: already advanced
    expect(e1).not.toBeNull();
    expect(e2).toBeNull();
  });
});
