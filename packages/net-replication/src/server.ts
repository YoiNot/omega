/**
 * @omega/net-replication — authoritative server.
 *
 * `ReplicatedServer` wraps an @omega/ecs `World` in a `ServerAuthoritativeSim`.
 * Each authoritative tick:
 *   1. the incoming command payload is applied to the world via a registered
 *      system (e.g. a movement intent),
 *   2. the world is advanced one fixed step,
 *   3. the resulting ECS state is serialized into a `WorldSnapshot` and returned
 *      for broadcast.
 *
 * The server is the single source of truth; clients only ever converge toward
 * snapshots it produces. The initial snapshot passed to the sim is the world's
 * baseline at tick 0 and does NOT consume a step, so the first `advance()`
 * processes the command for tick 0 at `serverTick` 0 — keeping client command
 * ticks and the server's authoritative tick in lockstep.
 */

import { type ComponentDef, World } from '@omega/ecs';
import { ServerAuthoritativeSim, type InputCommand, type WorldSnapshot } from '@omega/net';
import { Codec, worldToSnapshot } from './codec.js';

/** A system applied to the world on each authoritative tick. */
export type ServerSystem = (world: World, cmd: InputCommand | null, tick: number) => void;

export interface ReplicatedServerOptions {
  /** Fixed timestep handed to the underlying sim (default 1/60). */
  dt?: number;
  /** Systems run (in registration order) when a command is present, each tick. */
  systems?: ServerSystem[];
  /** Systems run BEFORE the command is applied, each tick (default none). */
  preSystems?: ServerSystem[];
  /** Initial authoritative snapshot tick (default 0). */
  startTick?: number;
}

export class ReplicatedServer {
  readonly world: World;
  readonly codec: Codec;
  private readonly sim: ServerAuthoritativeSim;
  private readonly preSystems: ServerSystem[];
  private readonly systems: ServerSystem[];
  private readonly dt: number;
  /** Monotonic authoritative tick counter (== next tick to be simulated). */
  private tickCount: number;

  constructor(world: World, codec: Codec, opts: ReplicatedServerOptions = {}) {
    if (codec.componentCount === 0) {
      throw new Error('ReplicatedServer: register at least one component before replicating');
    }
    this.world = world;
    this.codec = codec;
    this.dt = opts.dt ?? 1 / 60;
    this.preSystems = opts.preSystems ?? [];
    this.systems = opts.systems ?? [];
    this.tickCount = opts.startTick ?? 0;

    const initial = worldToSnapshot(this.world, this.tickCount, this.codec);
    this.sim = new ServerAuthoritativeSim(
      (cmd) => this.stepFn(cmd),
      initial,
      { dt: this.dt },
    );
  }

  /** Next authoritative tick the server will simulate (== latest snapshot tick). */
  get tick(): number {
    return this.tickCount;
  }

  /** Hand a client command to the server for execution on its arrival tick. */
  onCommand(cmd: InputCommand): void {
    this.sim.receiveCommand(cmd);
  }

  /**
   * Advance one authoritative tick and return the snapshot to broadcast.
   * The command (if any) addressed to this tick is applied, then all systems
   * run, then the world is serialized.
   */
  advance(): WorldSnapshot {
    return this.sim.step();
  }

  /** Authoritative snapshot of the current world (for the initial seed / late-joiners). */
  snapshot(): WorldSnapshot {
    return worldToSnapshot(this.world, this.tickCount, this.codec);
  }

  private stepFn(cmd: InputCommand | null): WorldSnapshot {
    const tick = this.tickCount;
    for (const sys of this.preSystems) sys(this.world, cmd, tick);
    if (cmd) {
      for (const sys of this.systems) sys(this.world, cmd, tick);
    }
    this.world.tick(this.dt);
    this.tickCount += 1;
    return worldToSnapshot(this.world, this.tickCount, this.codec);
  }
}

export type { ComponentDef };
