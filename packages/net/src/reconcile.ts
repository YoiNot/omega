/**
 * @omega/net — server-authoritative simulation with client prediction & reconciliation.
 *
 * Model
 * -----
 * Two roles share one class because they share the same deterministic step
 * function:
 *
 *   SERVER (authoritative truth)
 *     - `receiveCommand(cmd)` — hand a command to the server; it is executed
 *                               exactly on the simulation tick `cmd.tick`.
 *     - `step()`             — advance one authoritative tick (applying the
 *                               command issued for that tick, or null if none)
 *                               and return the new authoritative snapshot.
 *
 *   CLIENT (prediction + reconciliation)
 *     - `queueCommand(payload)` — assign the next predicted tick, record + locally
 *                               predict the command, return it so the caller can
 *                               ship it to the server.
 *     - `applySnapshot(s)`      — store the server's authoritative snapshot and
 *                               reconcile: drop every command with
 *                               `tick <= s.tick` (the server already simulated
 *                               those), then re-run the remaining in-flight
 *                               commands (tick > s.tick) on top of it. With a
 *                               `seed` hook the replay is bit-for-bit
 *                               reproducible and converges to the server's view.
 *
 * Determinism
 * -----------
 * The step function `(cmd, dt) => WorldSnapshot` owns world state in a closure.
 * For the client to replay in-flight commands *from* an authoritative base, the
 * class resets that closure via an optional `seed(base)` before the replay
 * (see constructor options). No clocks or randomness are used.
 */

import { CommandRecorder, InputCommand } from './commands.js';
import { SnapshotBuffer, WorldSnapshot } from './snapshot.js';

/** Authoritative step function. `cmd` is null when a tick had no input. */
export type StepFn = (cmd: InputCommand | null, dt: number) => WorldSnapshot;

/** Optional hook to reset a stateful step function to a known base snapshot. */
export type SeedFn = (base: WorldSnapshot) => void;

export interface SimOptions {
  /** Reset the step function's internal state to `base` (needed for replay). */
  seed?: SeedFn;
  /** Fixed timestep used by `step`/`queueCommand` (default 1/60). */
  dt?: number;
  /** Capacity of the client-side interpolation snapshot buffer (default 8). */
  bufferCapacity?: number;
}

export class ServerAuthoritativeSim {
  /** Authoritative simulation tick (server side). */
  private serverTick = 0;
  /** Next predicted tick the client will assign to a queued command. */
  private predictedTick = 0;
  private readonly dt: number;
  private readonly seed?: SeedFn;

  /** Authoritative state (server truth, or last confirmed base on the client). */
  private authoritative: WorldSnapshot;
  /** Client's predicted state = authoritative + replay of in-flight commands. */
  private predicted: WorldSnapshot;

  private readonly recorder = new CommandRecorder();
  /** Commands received by the server, keyed by the tick they execute on. */
  private readonly inboundByTick = new Map<number, InputCommand>();
  /** Commands the client sent but the server has not yet simulated. */
  private unacked: InputCommand[] = [];

  /** Recent authoritative snapshots, for client-side interpolation. */
  readonly buffer: SnapshotBuffer;

  constructor(
    private readonly stepFn: StepFn,
    initial: WorldSnapshot,
    opts: SimOptions = {},
  ) {
    this.dt = opts.dt ?? 1 / 60;
    this.seed = opts.seed;
    this.authoritative = initial;
    this.predicted = initial;
    this.buffer = new SnapshotBuffer(opts.bufferCapacity ?? 8);
  }

  get currentTick(): number {
    return this.serverTick;
  }

  // ---- SERVER role -------------------------------------------------------

  /** Accept a command sent by a client (server side). */
  receiveCommand(cmd: InputCommand): void {
    this.inboundByTick.set(cmd.tick, cmd);
  }

  /** Apply one authoritative tick; returns the new authoritative snapshot. */
  step(): WorldSnapshot {
    const cmd = this.inboundByTick.get(this.serverTick) ?? null;
    if (cmd) this.inboundByTick.delete(this.serverTick);
    this.authoritative = this.stepFn(cmd, this.dt);
    this.serverTick += 1;
    return this.authoritative;
  }

  // ---- CLIENT role -------------------------------------------------------

  /**
   * Assign the next predicted tick, record, locally predict, and return the
   * command to send to the server. The command is applied immediately so the
   * client sees instant feedback (prediction); it stays in `unacked` until the
   * server simulates it (signalled by a snapshot whose tick covers it).
   */
  queueCommand(payload: Uint8Array): InputCommand {
    const tick = this.predictedTick;
    this.predictedTick += 1;
    const cmd = this.recorder.record(tick, payload);
    this.unacked.push(cmd);
    this.predicted = this.stepFn(cmd, this.dt);
    return cmd;
  }

  /**
   * Store the server's authoritative snapshot and reconcile the predicted state
   * by dropping every command the server has already simulated (`tick <= s.tick`)
   * and replaying the remaining in-flight commands on top of `s`. If no `seed`
   * was supplied, the authoritative snapshot is simply adopted as the prediction.
   * Returns the reconciled predicted snapshot.
   */
  applySnapshot(s: WorldSnapshot): WorldSnapshot {
    this.authoritative = s;
    this.buffer.push(s);
    // Server has simulated exactly ticks [0, s.tick); keep commands with
    // tick >= s.tick as still in-flight.
    this.unacked = this.unacked.filter((c) => c.tick >= s.tick);
    let cur: WorldSnapshot = s;
    if (this.seed) {
      this.seed(s);
      const replay = [...this.unacked].sort((a, b) => a.tick - b.tick);
      for (const cmd of replay) cur = this.stepFn(cmd, this.dt);
    }
    this.predicted = cur;
    return this.predicted;
  }

  /**
   * Explicitly acknowledge commands up to sequence `upTo` (e.g. via a server ack
   * message), drop them from the replay set, and re-reconcile. Returns the count
   * removed from the recorder.
   */
  ack(upTo: number): number {
    const removed = this.recorder.ack(upTo);
    this.unacked = this.unacked.filter((c) => c.seq > upTo);
    if (this.seed) {
      this.seed(this.authoritative);
      const replay = [...this.unacked].sort((a, b) => a.tick - b.tick);
      let cur: WorldSnapshot = this.authoritative;
      for (const cmd of replay) cur = this.stepFn(cmd, this.dt);
      this.predicted = cur;
    }
    return removed;
  }

  /** Current predicted snapshot (client's best guess at "now"). */
  getState(): WorldSnapshot {
    return this.predicted;
  }

  /** Last authoritative snapshot received from the server. */
  getAuthoritative(): WorldSnapshot {
    return this.authoritative;
  }

  /** Commands still in flight (not yet simulated by the server). */
  pendingCommands(): readonly InputCommand[] {
    return this.unacked;
  }
}
