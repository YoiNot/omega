/**
 * @omega/sim — simulation orchestration.
 *
 * Wraps an ECS `World` with a fixed-timestep `Scheduler` and adds the production features
 * the brief requires from the save/replay layer: tick recording, play/pause, and a
 * deterministic step API. The simulation is a pure function of (seed, initial state,
 * sequence of input ticks) — see docs/adr/0001-determinism.md.
 */

import { World, Scheduler, SystemStage } from '@omega/engine-core';

export interface SimTickRecord {
  tick: number;
  /** Snapshot of any externally-supplied inputs for this tick (for replay validation). */
  input: unknown;
}

export interface SimulationOptions {
  fixedDt?: number;
  maxSteps?: number;
  /** Hard cap on recorded ticks (ring buffer) to bound memory. Default 3600 (1 min @60Hz). */
  recordLimit?: number;
}

export class Simulation {
  readonly world: World;
  readonly scheduler: Scheduler;
  readonly fixedDt: number;
  private running = false;
  private recorded: SimTickRecord[] = [];
  private recordLimit: number;
  totalTicks = 0;

  constructor(world: World, opts: SimulationOptions = {}) {
    this.world = world;
    this.fixedDt = opts.fixedDt ?? 1 / 60;
    this.scheduler = new Scheduler(world, { fixedDt: this.fixedDt, maxSteps: opts.maxSteps ?? 5 });
    this.recordLimit = opts.recordLimit ?? 3600;
  }

  get isRunning(): boolean { return this.running; }

  play(): void { this.running = true; }
  pause(): void { this.running = false; }

  /** Feed real elapsed seconds; advances only while running. Returns steps executed. */
  advance(frameDt: number, input?: unknown): number {
    if (!this.running) return 0;
    const before = this.world.tick;
    this.scheduler.update(frameDt);
    const steps = this.world.tick - before;
    if (steps > 0) this.record(this.world.tick - 1, input);
    return steps;
  }

  /** Deterministic single-step (used by tests and by the replay validator). */
  step(input?: unknown): void {
    this.world.step(this.fixedDt);
    this.record(this.world.tick - 1, input);
  }

  private record(tick: number, input: unknown): void {
    this.recorded.push({ tick, input });
    this.totalTicks++;
    if (this.recorded.length > this.recordLimit) this.recorded.shift();
  }

  /** Recorded ticks (most recent last). */
  history(): readonly SimTickRecord[] { return this.recorded; }

  /** Reset simulation state but keep the World's systems registered. */
  reset(): void {
    this.scheduler.reset();
    this.recorded = [];
    this.totalTicks = 0;
    this.running = false;
  }

  /** Convenience: register a system directly on the underlying world. */
  on(stage: SystemStage, order: number, name: string, fn: (w: World, dt: number, tick: number) => void) {
    return this.world.registerSystem(stage, order, name, fn);
  }

  /** Full deterministic replay of recorded inputs from a fresh world built by `builder`. */
  static replay(
    builder: (world: World) => void,
    records: readonly SimTickRecord[],
    opts: SimulationOptions = {},
  ): Simulation {
    const sim = new Simulation(new World(), opts);
    builder(sim.world);
    sim.pause();
    for (const rec of records) sim.step(rec.input);
    return sim;
  }
}
