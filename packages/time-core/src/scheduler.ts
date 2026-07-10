/**
 * @omega/time-core — deterministic fixed-timestep scheduler.
 *
 * The simulation loop is driven in fixed, integer ticks that are fully decoupled
 * from wall-clock time. The caller feeds the *real* elapsed time per frame; the
 * scheduler accumulates it and consumes it in fixed `dt` chunks, invoking the
 * supplied pure `tick(frame, dt)` callback once per chunk.
 *
 * Determinism contract (mirrors @omega/input-core):
 *   - Nothing in this module reads a clock (`Date.now` / `performance.now`) or
 *     generates randomness. The real delta is 100% caller-supplied.
 *   - The `frame` index is assigned by the scheduler itself, never derived from a
 *     wall clock, so two schedulers fed the same `step` sequence are bit-identical.
 *   - `tick` is ALWAYS called with the fixed `dt` — the variable real delta is
 *     never leaked into simulation code.
 *   - A spiral-of-death guard (`maxSubSteps`) caps the integer sub-steps per
 *     `step` call; on a pathological stall (tab refocus, breakpoint) the surplus
 *     is dropped modulo one fixed step so time debt cannot compound forever.
 */

import { clamp } from '@omega/engine-math';

/** Configuration for a fixed-timestep scheduler. */
export interface FixedTimestepConfig {
  /** Seconds per simulation tick. Must be a positive finite number. */
  readonly dt: number;
  /** Maximum integer sub-steps executed per `step` call (spiral-of-death guard). Default 5. */
  readonly maxSubSteps?: number;
}

/**
 * The pure per-tick callback.
 * @param frame  Monotonic, scheduler-assigned tick index (0-based, strictly increasing).
 * @param dt     The fixed step duration (always `config.dt`). Never the real delta.
 */
export type TickCallback = (frame: number, dt: number) => void;

/** Public handle returned by {@link createScheduler}. */
export interface Scheduler {
  /** Fixed step duration in seconds (= config.dt). */
  readonly dt: number;
  /** Maximum integer sub-steps per `step` call. */
  readonly maxSubSteps: number;
  /** Monotonic tick index = total fixed ticks executed since creation (also the next tick's index). */
  readonly frame: number;
  /** Unconsumed accumulated time (seconds) carried into the next `step`. */
  readonly accumulator: number;
  /** Fraction [0,1) of progress toward the next tick (render interpolation alpha). */
  readonly alpha: number;
  /** Feed one frame's real elapsed time (seconds); runs zero or more fixed ticks. Returns ticks executed. */
  step(realDeltaSeconds: number, tick: TickCallback): number;
  /** Reset accumulated time and frame index (deterministic; keeps config). */
  reset(): void;
}

/** Pure convenience: ticks-per-second → fixed step duration (seconds). No clock involved. */
export function dtFromHz(hz: number): number {
  if (!Number.isFinite(hz) || hz <= 0) {
    throw new Error(`dtFromHz: hz must be a positive finite number, got ${String(hz)}`);
  }
  return 1 / hz;
}

/**
 * Create a deterministic fixed-timestep scheduler.
 *
 * @example
 *   const sim = createScheduler({ dt: 1 / 60, maxSubSteps: 5 });
 *   function loop(realDt: number) {
 *     sim.step(realDt, (frame, dt) => advanceSimulation(dt));
 *     render(sim.alpha);
 *   }
 */
export function createScheduler(opts: FixedTimestepConfig): Scheduler {
  if (
    !opts ||
    typeof opts.dt !== 'number' ||
    !Number.isFinite(opts.dt) ||
    opts.dt <= 0
  ) {
    throw new Error(`createScheduler: dt must be a positive finite number, got ${String(opts?.dt)}`);
  }

  const dt = opts.dt;
  const maxSubSteps = opts.maxSubSteps ?? 5;
  if (!Number.isInteger(maxSubSteps) || maxSubSteps < 1) {
    throw new Error(`createScheduler: maxSubSteps must be a positive integer, got ${String(opts.maxSubSteps)}`);
  }

  let accumulator = 0;
  let frame = 0;

  const step = (realDeltaSeconds: number, tick: TickCallback): number => {
    // No clock is read. Negative / non-finite deltas (clock skew, misordered frames,
    // NaN, Infinity) are ignored and never drive a tick.
    const real =
      Number.isFinite(realDeltaSeconds) && realDeltaSeconds > 0 ? realDeltaSeconds : 0;
    accumulator += real;

    let steps = 0;
    while (steps < maxSubSteps && accumulator >= dt) {
      tick(frame, dt);
      frame += 1;
      accumulator -= dt;
      steps += 1;
    }

    // Spiral-of-death guard: if we hit the cap with time still left, drop the surplus
    // modulo one fixed step. This bounds the carried debt to < dt so a stall cannot
    // compound into an ever-growing accumulator that keeps us pinned at maxSubSteps.
    if (steps === maxSubSteps && accumulator >= dt) {
      accumulator %= dt;
    }

    return steps;
  };

  const reset = (): void => {
    accumulator = 0;
    frame = 0;
  };

  return {
    get dt() {
      return dt;
    },
    get maxSubSteps() {
      return maxSubSteps;
    },
    get frame() {
      return frame;
    },
    get accumulator() {
      return accumulator;
    },
    get alpha() {
      return dt > 0 ? clamp(accumulator / dt, 0, 1) : 0;
    },
    step,
    reset,
  };
}
