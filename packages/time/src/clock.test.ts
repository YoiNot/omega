import { describe, it, expect } from 'vitest';
import { FixedTimestep } from './clock.js';

describe('FixedTimestep', () => {
  it('emits a fixed step count for a given realDt', () => {
    const clock = new FixedTimestep(60, 5);
    let ticks = 0;
    clock.onTick = () => { ticks++; };

    // 1/60 s exactly -> exactly one tick.
    const n = clock.advance(1 / 60);
    expect(n).toBe(1);
    expect(ticks).toBe(1);
    expect(clock.tickCount).toBe(1);

    // 1/30 s exactly -> two ticks.
    const n2 = clock.advance(1 / 30);
    expect(n2).toBe(2);
    expect(clock.tickCount).toBe(3);
  });

  it('passes the fixed stepDt to onTick (never the real dt)', () => {
    const clock = new FixedTimestep(60, 5);
    const seen: number[] = [];
    clock.onTick = (dt) => { seen.push(dt); };
    clock.advance(1 / 20); // 3 steps
    expect(seen).toEqual([1 / 60, 1 / 60, 1 / 60]);
  });

  it('caps ticks at maxSubSteps (spiral-of-death guard, no infinite loop)', () => {
    const clock = new FixedTimestep(60, 5);
    let ticks = 0;
    clock.onTick = () => { ticks++; };

    // A 10-second stall would nominally be 600 ticks; must be clamped to 5.
    const n = clock.advance(10);
    expect(n).toBe(5);
    expect(ticks).toBe(5);
    expect(clock.tickCount).toBe(5);
  });

  it('keeps alpha within [0, 1] across a sequence', () => {
    const clock = new FixedTimestep(60, 5);
    clock.onTick = () => {};
    for (let i = 0; i < 1000; i++) {
      clock.advance(3 / 60); // 3 steps worth each time, never an exact multiple
      const a = clock.alpha;
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThan(1);
    }
  });

  it('alpha reflects partial progress of the current step', () => {
    const clock = new FixedTimestep(60, 5);
    clock.onTick = () => {};
    // advance half a step -> alpha ~ 0.5
    clock.advance(1 / 120);
    expect(clock.alpha).toBeCloseTo(0.5, 6);
  });

  it('is deterministic: identical realDt sequences produce identical ticks + alpha', () => {
    const seq = [1 / 60, 0.017, 0.5, 1 / 120, 10, 0.001, 1 / 30];
    const a = new FixedTimestep(60, 5);
    const b = new FixedTimestep(60, 5);
    a.onTick = () => {};
    b.onTick = () => {};

    const aAlpha: number[] = [];
    const bAlpha: number[] = [];
    for (const dt of seq) {
      a.advance(dt);
      b.advance(dt);
      aAlpha.push(a.alpha);
      bAlpha.push(b.alpha);
    }
    expect(a.tickCount).toBe(b.tickCount);
    expect(aAlpha).toEqual(bAlpha);
  });

  it('drops surplus under maxSubSteps so it cannot compound forever', () => {
    const clock = new FixedTimestep(60, 5);
    clock.onTick = () => {};
    clock.advance(10); // clamped to 5 ticks, surplus dropped
    // Next normal frame should produce a sensible tick count, not stay pegged.
    const n = clock.advance(1 / 60);
    expect(n).toBe(1);
  });

  it('ignores negative / non-finite realDt', () => {
    const clock = new FixedTimestep(60, 5);
    let ticks = 0;
    clock.onTick = () => { ticks++; };
    expect(clock.advance(-1)).toBe(0);
    expect(clock.advance(NaN)).toBe(0);
    expect(clock.advance(Infinity)).toBe(0);
    expect(ticks).toBe(0);
    expect(clock.alpha).toBe(0);
  });

  it('reset clears accumulator and tick count', () => {
    const clock = new FixedTimestep(60, 5);
    clock.onTick = () => {};
    clock.advance(1 / 60);
    expect(clock.tickCount).toBe(1);
    clock.reset();
    expect(clock.tickCount).toBe(0);
    expect(clock.alpha).toBe(0);
  });
});
