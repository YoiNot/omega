/**
 * @omega/input — deterministic command recorder & replayer.
 *
 * The recorder assigns monotonic sequence numbers to outgoing commands and tracks
 * which are still unacknowledged. The replayer replays a captured command stream
 * bit-for-bit from a given tick.
 *
 * A small length-prefixed serializer (`encodeEvents` / `decodeEvents`) turns a tick's
 * `InputEvent`s into the opaque `Uint8Array` payload carried by each `InputCommand`.
 * Encoding is fully deterministic: identical input always yields identical bytes.
 *
 * Determinism contract: no clocks, no randomness. `tick` is always passed in. The only
 * intended use of @omega/engine-core `Rng` is to synthesize *test* data.
 */

import type { InputCommand, InputEvent } from './types.js';

/* ------------------------------------------------------------------ *
 * Length-prefixed payload codec
 * ------------------------------------------------------------------ */

const enc = new TextEncoder();
const dec = new TextDecoder();

const DEVICE_CODE: Record<InputEvent['device'], number> = { key: 0, mouse: 1, pad: 2 };
const STATE_CODE: Record<InputEvent['state'], number> = { down: 0, up: 1, axis: 2 };
const CODE_DEVICE = ['key', 'mouse', 'pad'] as const;
const CODE_STATE = ['down', 'up', 'axis'] as const;

/**
 * Serialize a list of events into a compact, deterministic `Uint8Array`.
 * Layout: u16 event-count, then per event:
 *   u8 device, u8 state, u8 codeLen, codeLen UTF-8 bytes, f32 LE value, i32 LE tick.
 */
export function encodeEvents(events: readonly InputEvent[]): Uint8Array {
  const parts: Uint8Array[] = [];
  const header = new Uint8Array(2);
  const dv = new DataView(header.buffer);
  dv.setUint16(0, events.length, true);
  parts.push(header);

  for (const e of events) {
    const codeBytes = enc.encode(e.code);
    const rec = new Uint8Array(1 + 1 + 1 + codeBytes.length + 4 + 4);
    const rdv = new DataView(rec.buffer);
    rdv.setUint8(0, DEVICE_CODE[e.device]);
    rdv.setUint8(1, STATE_CODE[e.state]);
    rdv.setUint8(2, codeBytes.length);
    rec.set(codeBytes, 3);
    const off = 3 + codeBytes.length;
    rdv.setFloat32(off, e.value, true);
    rdv.setInt32(off + 4, e.tick, true);
    parts.push(rec);
  }

  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let pos = 0;
  for (const p of parts) { out.set(p, pos); pos += p.length; }
  return out;
}

/** Inverse of {@link encodeEvents}. Throws on malformed input (defensive). */
export function decodeEvents(payload: Uint8Array): InputEvent[] {
  if (payload.length < 2) throw new Error('decodeEvents: payload too short');
  const dv = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  const count = dv.getUint16(0, true);
  const out: InputEvent[] = [];
  let pos = 2;
  for (let i = 0; i < count; i++) {
    if (pos + 2 > payload.length) throw new Error('decodeEvents: truncated record');
    const device = CODE_DEVICE[dv.getUint8(pos)];
    const state = CODE_STATE[dv.getUint8(pos + 1)];
    const codeLen = dv.getUint8(pos + 2);
    pos += 3;
    if (pos + codeLen + 8 > payload.length) throw new Error('decodeEvents: truncated code/value');
    const code = dec.decode(payload.subarray(pos, pos + codeLen));
    pos += codeLen;
    const value = dv.getFloat32(pos, true);
    const tick = dv.getInt32(pos + 4, true);
    pos += 8;
    out.push({ device, state, code, value, tick });
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * CommandRecorder
 * ------------------------------------------------------------------ */

/**
 * Records outgoing commands, assigns monotonic sequence numbers, and tracks which
 * are still awaiting acknowledgement. Keeps a full ordered log of every recorded
 * command so the stream can be replayed deterministically (acked commands are
 * dropped from the *inflight* set but preserved in the log).
 */
export class CommandRecorder {
  /** Highest sequence number handed out so far. */
  private nextSeq = 0;
  /** Outgoing, not-yet-acked commands keyed by sequence number. */
  private readonly inflight = new Map<number, InputCommand>();
  /** Full ordered log (every command ever recorded) — used for replay. */
  private readonly log: InputCommand[] = [];

  /** Record a command for `tick` with the given payload; returns the stamped command. */
  record(payload: Uint8Array, tick: number): InputCommand {
    const cmd: InputCommand = { tick, seq: this.nextSeq, payload: payload.slice() };
    this.nextSeq += 1;
    this.inflight.set(cmd.seq, cmd);
    this.log.push(cmd);
    return cmd;
  }

  /**
   * Acknowledge all commands with `seq <= upTo` (drops them from the inflight set).
   * Out-of-range / already-acked values are harmless no-ops. Returns count removed.
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
  unacked(): InputCommand[] {
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

  /** Total number of commands ever recorded (acked or not). */
  get recordedCount(): number {
    return this.log.length;
  }

  /** Immutable copy of the full recorded log, in recording order. */
  logOf(): InputCommand[] {
    return this.log.map((c) => ({ ...c, payload: c.payload.slice() }));
  }
}

/* ------------------------------------------------------------------ *
 * Replayer
 * ------------------------------------------------------------------ */

/**
 * Replays a recorded command stream deterministically. Commands are internally
 * sorted by ascending `seq` so replay order is independent of the input array's
 * ordering. `from(tick)` yields every command with `tick >= start` (inclusive).
 */
export class Replayer {
  private readonly commands: InputCommand[];

  constructor(commands: readonly InputCommand[]) {
    this.commands = commands
      .map((c) => ({ ...c, payload: c.payload.slice() }))
      .sort((a, b) => a.seq - b.seq);
  }

  /** Replay every captured command in seq order. */
  all(): InputCommand[] {
    return this.commands.map((c) => ({ ...c, payload: c.payload.slice() }));
  }

  /** Replay commands with `tick >= start`, in seq order. */
  from(start: number): InputCommand[] {
    return this.commands
      .filter((c) => c.tick >= start)
      .map((c) => ({ ...c, payload: c.payload.slice() }));
  }

  /** Number of commands in the stream. */
  get length(): number {
    return this.commands.length;
  }
}
