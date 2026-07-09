/**
 * @omega/input — core types.
 *
 * The input layer translates raw device state into a flat, deterministic stream
 * of `InputEvent`s, which are then packed into `InputCommand`s and recorded for
 * acknowledgement / replay.
 *
 * Determinism contract: NO module here reads a clock or generates randomness.
 * The `tick` on every event/command is ALWAYS passed in by the caller (the fixed
 * timestep scheduler). The only place randomness is allowed is seeded test data,
 * via @omega/engine-core `Rng`.
 */

/** The kind of physical device that produced an event. */
export type DeviceKind = 'key' | 'mouse' | 'pad';

/** Transition of a digital button, or movement of an analog axis. */
export type EventState = 'down' | 'up' | 'axis';

/** A single quantized input observation bound to a simulation tick. */
export interface InputEvent {
  /** Which device produced it. */
  readonly device: DeviceKind;
  /** Stable identity for the control (e.g. 'KeyW', 'MouseX', 'Pad0-Axis0'). */
  readonly code: string;
  /** 'down' | 'up' for buttons, 'axis' for continuous motion. */
  readonly state: EventState;
  /** Normalized value. 0/1 for buttons, [-1,1] for axes. */
  readonly value: number;
  /** Simulation tick the observation belongs to (PASSED IN, never read from a clock). */
  readonly tick: number;
}

/** A command bound to a tick, carrying an opaque encoded payload for transport. */
export interface InputCommand {
  /** Simulation tick the command was recorded for. */
  readonly tick: number;
  /** Monotonic sequence number assigned by the recorder. */
  readonly seq: number;
  /** Encoded payload (never interpreted here). */
  readonly payload: Uint8Array;
}

/** A source of input observations. Adapters poll once per tick. */
export interface InputDevice {
  /** Return the events observed since the last poll, tagged with `tick`. */
  poll(tick: number): InputEvent[];
}

/** A drain for finished commands. */
export interface InputSink {
  /** Pull and clear any commands produced since the last call. */
  consume(): InputCommand[];
}
