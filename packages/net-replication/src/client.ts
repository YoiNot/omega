/**
 * @omega/net-replication — networked client with prediction + reconciliation.
 *
 * `ReplicatedClient` wraps an @omega/ecs `World` in a `ServerAuthoritativeSim`
 * configured with a `seed` hook: on every authoritative snapshot it rebuilds
 * the local world from the server's base (via `snapshotToWorld`) and then replays
 * the still-in-flight commands on top of it, so the predicted view converges to
 * the server's truth bit-for-bit.
 *
 * Prediction is instant: `sendIntent` applies the command locally and returns it
 * for transport, while the authoritative snapshot later corrects any divergence.
 */

import { type ComponentDef, World } from '@omega/ecs';
import { ServerAuthoritativeSim, type InputCommand, type WorldSnapshot } from '@omega/net';
import { Codec, snapshotToWorld, worldToSnapshot } from './codec.js';
import type { ServerSystem } from './server.js';

export interface ReplicatedClientOptions {
  /** Fixed timestep (must match the server's). Default 1/60. */
  dt?: number;
  /** Command-application systems (run when a command is present), must mirror the server's. */
  systems?: ServerSystem[];
  /** Per-tick systems run before the command is applied (default none). */
  preSystems?: ServerSystem[];
  /** Capacity of the interpolation snapshot buffer (default 8). */
  bufferCapacity?: number;
  /** Initial authoritative tick the world was seeded at (default 0). */
  startTick?: number;
}

export class ReplicatedClient {
  readonly world: World;
  readonly codec: Codec;
  private readonly sim: ServerAuthoritativeSim;
  private readonly preSystems: ServerSystem[];
  private readonly systems: ServerSystem[];
  private readonly dt: number;

  constructor(world: World, codec: Codec, opts: ReplicatedClientOptions = {}) {
    if (codec.componentCount === 0) {
      throw new Error('ReplicatedClient: register at least one component before replicating');
    }
    this.world = world;
    this.codec = codec;
    this.dt = opts.dt ?? 1 / 60;
    this.preSystems = opts.preSystems ?? [];
    this.systems = opts.systems ?? [];

    const startTick = opts.startTick ?? 0;
    const initial = worldToSnapshot(this.world, startTick, this.codec);
    this.sim = new ServerAuthoritativeSim(
      (cmd) => this.stepFn(cmd),
      initial,
      {
        dt: this.dt,
        bufferCapacity: opts.bufferCapacity,
        // Reset the local world to the authoritative base before replaying.
        seed: (base) => this.seed(base),
      },
    );
  }

  /**
   * Queue an intent, predict it locally, and return the command to ship to the
   * server. The local world is advanced immediately so the player sees no lag.
   */
  sendIntent(payload: Uint8Array): InputCommand {
    return this.sim.queueCommand(payload);
  }

  /**
   * Reconcile against an authoritative snapshot from the server: drop commands
   * the server has already simulated and replay the rest on top of the server's
   * base. The local world converges toward the server's truth.
   */
  onSnapshot(s: WorldSnapshot): WorldSnapshot {
    return this.sim.applySnapshot(s);
  }

  /** Current predicted snapshot (client's best guess at "now"). */
  state(): WorldSnapshot {
    return this.sim.getState();
  }

  /** Last authoritative snapshot received from the server. */
  authoritative(): WorldSnapshot {
    return this.sim.getAuthoritative();
  }

  /** Commands still in flight (not yet simulated by the server). */
  pendingCommands(): readonly InputCommand[] {
    return this.sim.pendingCommands();
  }

  /** Recent authoritative snapshots, for interpolation/rendering. */
  get buffer() {
    return this.sim.buffer;
  }

  /**
   * Seed hook: rebuild the local world from the authoritative base. Destroys the
   * current replicated entities (in ascending id order, preserving registered
   * systems) and rematerializes the snapshot's state, so the subsequent replay
   * of in-flight commands starts from the exact server view.
   */
  private seed(base: WorldSnapshot): void {
    snapshotToWorld(base, this.world, this.codec);
  }

  /**
   * Client step function. The client only ever predicts or replays concrete
   * commands, so `cmd` is non-null here; we stamp the world at `cmd.tick`, which
   * matches the server's authoritative tick for the same command. A null command
   * (defensive) is treated as tick 0.
   */
  private stepFn(cmd: InputCommand | null): WorldSnapshot {
    const tick = cmd ? cmd.tick : 0;
    for (const sys of this.preSystems) sys(this.world, cmd, tick);
    if (cmd) {
      for (const sys of this.systems) sys(this.world, cmd, tick);
    }
    this.world.tick(this.dt);
    return worldToSnapshot(this.world, tick + 1, this.codec);
  }
}

export type { ComponentDef };
