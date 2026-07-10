/**
 * @omega/time-core — determinism & scheduler tests.
 *
 * Every test asserts the determinism contract WITHOUT reading a wall clock or
 * using randomness: the only "time" the scheduler ever sees is the explicit
 * `realDelta` sequence we pass in. A `run` helper feeds the same sequence to two
 * independent schedulers so we can prove behavioral identity.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  createScheduler,
  dtFromHz,
  type FixedTimestepConfig,
} from './index.js';

/** Run a real-delta sequence through a fresh scheduler, capturing ticks. */
function runSequence(
  cfg: FixedTimestepConfig,
  deltas: readonly number[],
): { frames: number[]; dts: number[]; finalFrame: number; finalAcc: number; ticksRun: number } {
  const s = createScheduler(cfg);
  const frames: number[] = [];
  const dts: number[] = [];
  let ticksRun = 0;
  for (const d of deltas) {
    ticksRun += s.step(d, (frame, dt) => {
      frames.push(frame);
      dts.push(dt);
    });
  }
  return { frames, dts, finalFrame: s.frame, finalAcc: s.accumulator, ticksRun };
}

const SEQ = [1 / 60, 0.017, 0.5, 1 / 120, 10, 0.001, 1 / 30, 1 / 60];
const CFG: FixedTimestepConfig = { dt: 1 / 60, maxSubSteps: 5 };

describe('createScheduler config', () => {
  it('throws on non-positive / non-finite dt', () => {
    expect(() => createScheduler({ dt: 0 })).toThrow();
    expect(() => createScheduler({ dt: -1 })).toThrow();
    expect(() => createScheduler({ dt: NaN })).toThrow();
    expect(() => createScheduler({ dt: Infinity })).toThrow();
    expect(() => createScheduler({} as FixedTimestepConfig)).toThrow();
  });

  it('throws on invalid maxSubSteps', () => {
    expect(() => createScheduler({ dt: 1 / 60, maxSubSteps: 0 })).toThrow();
    expect(() => createScheduler({ dt: 1 / 60, maxSubSteps: 2.5 })).toThrow();
    expect(() => createScheduler({ dt: 1 / 60, maxSubSteps: -3 })).toThrow();
  });

  it('defaults maxSubSteps to 5', () => {
    const s = createScheduler({ dt: 1 / 60 });
    expect(s.maxSubSteps).toBe(5);
  });

  it('exposes the fixed dt on the handle', () => {
    const s = createScheduler({ dt: 1 / 120 });
    expect(s.dt).toBe(1 / 120);
  });
});

describe('dtFromHz', () => {
  it('converts ticks-per-second to seconds', () => {
    expect(dtFromHz(60)).toBe(1 / 60);
    expect(dtFromHz(30)).toBe(1 / 30);
  });
  it('throws on invalid hz', () => {
    expect(() => dtFromHz(0)).toThrow();
    expect(() => dtFromHz(-1)).toThrow();
    expect(() => dtFromHz(NaN)).toThrow();
  });
});

describe('identical step() sequence → identical frame sequence + dt', () => {
  it('produces byte-identical frame + dt sequences across two schedulers', () => {
    const a = runSequence(CFG, SEQ);
    const b = runSequence(CFG, SEQ);
    expect(a.frames).toEqual(b.frames);
    expect(a.dts).toEqual(b.dts);
    expect(a.finalFrame).toBe(b.finalFrame);
    expect(a.finalAcc).toBe(b.finalAcc);
    expect(a.ticksRun).toBe(b.ticksRun);
  });

  it('tick frames are monotonically increasing integers starting at 0', () => {
    const { frames } = runSequence({ dt: 1 / 60, maxSubSteps: 8 }, [0.1, 0.1, 0.1, 0.1]);
    expect(frames[0]).toBe(0);
    for (let i = 1; i < frames.length; i++) {
      expect(frames[i]).toBe(frames[i - 1] + 1);
    }
  });
});

describe('fixed-dt guarantee', () => {
  it('tick is NEVER called with any dt other than opts.dt (incl. capped frames)', () => {
    const s = createScheduler({ dt: 1 / 60, maxSubSteps: 5 });
    const seen: number[] = [];
    // A 10s stall would nominally be 600 ticks; sweep many frames to cover exact & capped.
    for (const d of [10, 1 / 60, 0.5, 1 / 120, 1 / 30, 0.25, 0.001]) {
      s.step(d, (_frame, dt) => {
        seen.push(dt);
      });
    }
    expect(seen.length).toBeGreaterThan(0);
    for (const dt of seen) {
      expect(dt).toBe(1 / 60);
    }
  });

  it('every tick frame is handed the exact configured dt', () => {
    const dt = 1 / 30;
    const s = createScheduler({ dt, maxSubSteps: 4 });
    const bad: number[] = [];
    for (const d of SEQ) {
      s.step(d, (frame, got) => {
        if (got !== dt) bad.push(frame);
      });
    }
    expect(bad).toEqual([]);
  });
});

describe('maxSubSteps cap', () => {
  it('caps ticks at maxSubSteps and runs no infinite loop on a huge stall', () => {
    const s = createScheduler({ dt: 1 / 60, maxSubSteps: 5 });
    let ticks = 0;
    const n = s.step(10, () => {
      ticks++;
    });
    expect(n).toBe(5);
    expect(ticks).toBe(5);
    expect(s.frame).toBe(5);
  });

  it('drops surplus beyond the cap so the next normal frame is not poisoned', () => {
    const s = createScheduler({ dt: 1 / 60, maxSubSteps: 5 });
    s.step(10, () => {}); // 600 nominal ticks → clamped to 5, surplus dropped
    const n = s.step(1 / 60, () => {}); // next frame must behave normally
    expect(n).toBe(1);
    expect(s.frame).toBe(6);
  });

  it('never exceeds maxSubSteps even across many huge stalls', () => {
    const s = createScheduler({ dt: 1 / 60, maxSubSteps: 3 });
    let maxSeen = 0;
    for (let i = 0; i < 100; i++) {
      maxSeen = Math.max(maxSeen, s.step(1e9, () => {}));
    }
    expect(maxSeen).toBe(3);
  });
});

describe('reproducibility', () => {
  it('two schedulers end at the same frame + accumulator for an identical sequence', () => {
    const build = () => runSequence(CFG, SEQ);
    const a = build();
    const b = build();
    expect(a.finalFrame).toBe(b.finalFrame);
    expect(a.finalAcc).toBe(b.finalAcc);
  });

  it('is independent of wall-clock time between steps', () => {
    // Force Date.now / performance.now to diverge wildly between the two runs.
    const a = (() => {
      vi.useFakeTimers();
      vi.setSystemTime(0);
      const r = runSequence(CFG, SEQ);
      vi.useRealTimers();
      return r;
    })();
    const b = (() => {
      vi.useFakeTimers();
      vi.setSystemTime(1_000_000_000);
      const r = runSequence(CFG, SEQ);
      vi.useRealTimers();
      return r;
    })();
    expect(a.frames).toEqual(b.frames);
    expect(a.dts).toEqual(b.dts);
    expect(a.finalFrame).toBe(b.finalFrame);
    expect(a.finalAcc).toBe(b.finalAcc);
  });
});

describe('alpha (render interpolation)', () => {
  it('stays within [0,1) across a long sequence', () => {
    const s = createScheduler({ dt: 1 / 60, maxSubSteps: 5 });
    for (let i = 0; i < 1000; i++) {
      s.step(3 / 60, () => {});
      expect(s.alpha).toBeGreaterThanOrEqual(0);
      expect(s.alpha).toBeLessThan(1);
    }
  });

  it('reflects partial progress of the current step', () => {
    const s = createScheduler({ dt: 1 / 60, maxSubSteps: 5 });
    s.step(1 / 120, () => {}); // half a step
    expect(s.alpha).toBeCloseTo(0.5, 6);
  });
});

describe('edge: negative / non-finite delta', () => {
  it('ignores negative, NaN and Infinity deltas (no tick, alpha stays 0)', () => {
    const s = createScheduler({ dt: 1 / 60, maxSubSteps: 5 });
    let ticks = 0;
    expect(s.step(-1, () => { ticks++; })).toBe(0);
    expect(s.step(NaN, () => { ticks++; })).toBe(0);
    expect(s.step(Infinity, () => { ticks++; })).toBe(0);
    expect(ticks).toBe(0);
    expect(s.frame).toBe(0);
    expect(s.alpha).toBe(0);
  });
});

describe('reset', () => {
  it('clears frame index and accumulator but keeps config', () => {
    const s = createScheduler({ dt: 1 / 30, maxSubSteps: 4 });
    s.step(1 / 10, () => {}); // 3 ticks
    expect(s.frame).toBe(3);
    s.reset();
    expect(s.frame).toBe(0);
    expect(s.accumulator).toBe(0);
    expect(s.dt).toBe(1 / 30);
    expect(s.maxSubSteps).toBe(4);
    // continues deterministically from a clean state
    s.step(1 / 30, () => {});
    expect(s.frame).toBe(1);
  });
});
