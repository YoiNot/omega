/**
 * @omega/net — input command recording and acknowledgement.
 *
 * The client records every command it sends (keyed by a monotonic sequence
 * number) so that, when the server acknowledges receipt up to some sequence,
 * the client can drop what's confirmed and resend what is still in flight.
 *
 * Fully deterministic: given the same sequence of `record`/`ack`/`resend` calls
 * it always produces identical bookkeeping. No clocks, no randomness.
 */

/** A single player intent bound to a simulation tick. */
export interface InputCommand {
  /** Simulation tick the command was issued for. */
  readonly tick: number;
  /** Monotonic sequence number assigned by the recorder. */
  readonly seq: number;
  /** Opaque payload (e.g. encoded key/mouse state) — never interpreted here. */
  readonly payload: Uint8Array;
}

/**
 * Records outgoing commands, assigns sequence numbers, and tracks which have
 * been acknowledged by the server.
 */
export class CommandRecorder {
  /** Highest sequence number handed out so far. */
  private nextSeq = 0;
  /** Outgoing, not-yet-acked commands keyed by sequence number. */
  private readonly inflight = new Map<number, InputCommand>();

  /** Record a new command for `tick` with the given payload. Returns it. */
  record(tick: number, payload: Uint8Array): InputCommand {
    const cmd: InputCommand = { tick, seq: this.nextSeq, payload: payload.slice() };
    this.nextSeq += 1;
    this.inflight.set(cmd.seq, cmd);
    return cmd;
  }

  /**
   * Acknowledge all commands with `seq <= upTo`. Returns the count removed.
   * Out-of-range or already-acked values are harmless no-ops.
   */
  ack(upTo: number): number {
    let removed = 0;
    for (const seq of this.inflight.keys()) {
      if (seq <= upTo) {
        this.inflight.delete(seq);
        removed += 1;
      }
    }
    return removed;
  }

  /** Commands still awaiting acknowledgement, in ascending seq order. */
  resend(): InputCommand[] {
    return [...this.inflight.values()].sort((a, b) => a.seq - b.seq);
  }

  /** Sequence number that would be assigned to the next `record` call. */
  get nextSequence(): number {
    return this.nextSeq;
  }

  /** Count of commands currently awaiting acknowledgement. */
  get pendingCount(): number {
    return this.inflight.size;
  }
}
