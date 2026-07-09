/**
 * @omega/engine-core — fixed-timestep scheduler.
 *
 * Wraps a World and advances simulation in fixed dt steps via an accumulator, decoupling
 * simulation rate from the (variable) frame/render rate. Spiral-of-death is guarded by a
 * max-steps-per-frame cap. See docs/adr/0001-determinism.md (sim must be fixed-timestep).
 */

import { World } from './ecs.js';

export interface SchedulerOptions {
  /** Fixed simulation timestep in seconds. Default 1/60. */
  fixedDt?: number;
  /** Maximum simulation steps executed per update() call. Default 5. */
  maxSteps?: number;
}

export class Scheduler {
  readonly fixedDt: number;
  readonly maxSteps: number;
  private accumulator = 0;
  private interpolation = 0;
  stepsSinceLastUpdate = 0;

  constructor(public readonly world: World, opts: SchedulerOptions = {}) {
    this.fixedDt = opts.fixedDt ?? 1 / 60;
    this.maxSteps = opts.maxSteps ?? 5;
  }

  /** Feed real elapsed time (seconds); runs zero or more fixed steps. */
  update(frameDt: number): void {
    // Clamp pathological frame gaps (tab switch, breakpoint) to avoid catch-up storms.
    const clamped = frameDt > 0.25 ? 0.25 : frameDt;
    this.accumulator += clamped;
    let steps = 0;
    while (this.accumulator >= this.fixedDt && steps < this.maxSteps) {
      this.world.step(this.fixedDt);
      this.accumulator -= this.fixedDt;
      steps++;
    }
    if (steps === this.maxSteps) {
      // Dropped time to prevent spiral of death.
      this.accumulator = 0;
    }
    this.stepsSinceLastUpdate = steps;
    this.interpolation = this.fixedDt > 0 ? this.accumulator / this.fixedDt : 0;
  }

  /** Fraction [0,1) of progress to the next fixed step (for render interpolation). */
  get alpha(): number { return this.interpolation; }

  /** Reset timers (e.g. on load). */
  reset(): void { this.accumulator = 0; this.interpolation = 0; this.stepsSinceLastUpdate = 0; }
}
