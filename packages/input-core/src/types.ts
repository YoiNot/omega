/**
 * @omega/input-core — deterministic, frame-stable input snapshots.
 *
 * This package sits ABOVE raw DOM events and BELOW the simulation. It turns a
 * stream of keyboard / mouse observations into compact, replay-safe
 * `InputFrame` snapshots (struct-of-arrays, typed) that are fully decoupled from
 * DOM/wall-clock time.
 *
 * Determinism contract: nothing in the core (`state`, `buffer`) reads a clock or
 * generates randomness. The frame index on every snapshot is ALWAYS supplied by
 * the caller (the fixed-timestep scheduler). Key identities are derived with the
 * deterministic hash from @omega/engine-core, so the same code always maps to
 * the same id on every platform and every replay.
 */

/**
 * A single frame-stable input snapshot in struct-of-arrays form.
 *
 * All arrays are sorted ascending so that two snapshots built from the same
 * logical state compare byte-for-byte identical (order independence of the
 * underlying Sets is removed here). Typed arrays keep it compact and cheap to
 * copy into a replay buffer or serialize over the wire.
 */
export interface InputFrame {
  /** Caller-supplied simulation frame index (never read from a clock). */
  readonly frame: number;

  /** 32-bit key ids currently held down, ascending. */
  readonly heldKeys: Uint32Array;
  /** 32-bit key ids that transitioned to down THIS frame, ascending. */
  readonly pressedKeys: Uint32Array;
  /** 32-bit key ids that transitioned to up THIS frame, ascending. */
  readonly releasedKeys: Uint32Array;

  /** Pointer X (normalized or pixel — the source decides), decoupled from time. */
  readonly mouseX: number;
  /** Pointer Y. */
  readonly mouseY: number;

  /** Bitmask of mouse buttons currently held (bit N = button N). */
  readonly mouseButtons: number;
  /** Bitmask of mouse buttons that went down THIS frame. */
  readonly mousePressed: number;
  /** Bitmask of mouse buttons that went up THIS frame. */
  readonly mouseReleased: number;

  /** Accumulated wheel delta for the frame. */
  readonly wheel: number;
}

/**
 * Minimal structural type for an event target (a `Window`, `HTMLElement`, or any
 * test double). Avoids a hard dependency on a live DOM so the source can be
 * driven by fakes in unit tests.
 */
export interface Windowish {
  addEventListener(type: string, listener: (ev: unknown) => void): void;
  removeEventListener(type: string, listener: (ev: unknown) => void): void;
}
