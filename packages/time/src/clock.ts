/**
 * @omega/time — deterministic fixed-timestep clock.
 *
 * Drives a simulation at a constant rate (stepHz) independent of the real frame
 * rate. Real elapsed time is accumulated and consumed in fixed `stepDt` chunks,
 * each one triggering exactly one `onTick(stepDt)` call. A spiral-of-death guard
 * caps sub-steps per `advance` so a long stall (e.g. a breakpoint or tab refocus)
 * cannot trigger an unbounded catch-up loop.
 *
 * Determinism: no clock is ever read. `stepDt = 1 / stepHz` is fixed, and the
 * accumulation logic is a pure function of the `realDt` sequence fed in. Two
 * instances fed the same sequence produce identical tick counts and `alpha`.
 */

/** Callback invoked once per fixed step with the fixed step delta (seconds). */
export type TickCallback = (stepDt: number) => void;

export class FixedTimestep {
  /** Fixed step rate in Hz (ticks per second). */
  readonly stepHz: number;
  /** Fixed step duration in seconds (= 1 / stepHz). */
  readonly stepDt: number;
  /** Maximum fixed steps processed per `advance` call (spiral-of-death guard). */
  readonly maxSubSteps: number;

  /** Injected callback invoked for each consumed fixed step. */
  onTick: TickCallback | null = null;

  private accumulator = 0;
  private _tickCount = 0;

  constructor(stepHz = 60, maxSubSteps = 5, onTick: TickCallback | null = null) {
    this.stepHz = stepHz;
    this.maxSubSteps = maxSubSteps;
    this.stepDt = 1 / stepHz;
    this.onTick = onTick;
  }

  /** Total fixed ticks emitted since construction. */
  get tickCount(): number {
    return this._tickCount;
  }

  /**
   * Fraction of the current step already elapsed, in [0, 1), used by the renderer
   * to interpolate between the previous and current simulation state.
   */
  get alpha(): number {
    const a = this.stepDt > 0 ? this.accumulator / this.stepDt : 0;
    return a < 0 ? 0 : a > 1 ? 1 : a;
  }

  /**
   * Feed one real frame's elapsed time (seconds). Consumes as many fixed steps as
   * fit, capped at `maxSubSteps`, then returns how many steps were actually run.
   */
  advance(realDtSeconds: number): number {
    // Negative dt (clock skew / misordered frames) is ignored, never drives ticks.
    if (!Number.isFinite(realDtSeconds) || realDtSeconds < 0) realDtSeconds = 0;
    this.accumulator += realDtSeconds;

    let subSteps = 0;
    while (subSteps < this.maxSubSteps && this.accumulator >= this.stepDt) {
      if (this.onTick) this.onTick(this.stepDt);
      this.accumulator -= this.stepDt;
      this._tickCount++;
      subSteps++;
    }

    // Spiral-of-death guard: any surplus beyond what we could consume this frame is
    // dropped (mod the fixed step) so it cannot compound into an ever-growing
    // accumulator that would keep us pinned at maxSubSteps forever.
    if (this.accumulator >= this.stepDt) {
      this.accumulator %= this.stepDt;
    }

    return subSteps;
  }

  /** Reset accumulated time and tick count (deterministic, keeps config). */
  reset(): void {
    this.accumulator = 0;
    this._tickCount = 0;
  }
}
