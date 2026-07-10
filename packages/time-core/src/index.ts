/**
 * @omega/time-core — deterministic fixed-timestep scheduler.
 *
 * Drives a simulation in fixed, integer ticks, decoupling simulation time from
 * wall-clock time. The `tick(frame, dt)` callback is a pure function supplied by
 * the caller; the core never reads a clock or generates randomness.
 */

export { createScheduler, dtFromHz } from './scheduler.js';
export type { FixedTimestepConfig, TickCallback, Scheduler } from './scheduler.js';
