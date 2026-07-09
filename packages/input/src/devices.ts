/**
 * @omega/input — device adapters.
 *
 * Each adapter translates *injected* raw device state into a flat `InputEvent[]`
 * tagged with the caller-supplied `tick`. Adapters hold NO global state beyond
 * what is necessary for edge detection (the previous down/up set), and they never
 * touch `window`/`document`/a clock — the raw source is supplied by the caller so
 * the logic is unit-testable in isolation (no DOM required).
 *
 * Determinism: given the same sequence of `poll(tick)` calls over the same raw
 * sources, an adapter always emits the identical event stream. No `Math.random`,
 * no `Date.now`, no wall-clock anywhere in this file.
 */

import type { EventState, InputDevice, InputEvent } from './types.js';

/** Inline clamp to [-1,1] — avoids pulling @omega/engine-math into core deps. */
function clamp11(v: number): number {
  return v < -1 ? -1 : v > 1 ? 1 : v;
}

/* ------------------------------------------------------------------ *
 * Keyboard
 * ------------------------------------------------------------------ */

/** Predicate: is `code` currently held? */
export type KeyHeldFn = (code: string) => boolean;

/**
 * Adapter over a held-key predicate. Emits `down` on a held transition and `up`
 * on a release. New downs are only observed for codes present in `codes`; the
 * previous tick's held set is always re-scanned so releases are never missed.
 */
export class KeyboardAdapter implements InputDevice {
  private readonly isDown: KeyHeldFn;
  private readonly universe: readonly string[];
  private prev = new Set<string>();

  constructor(isDown: KeyHeldFn, opts: { codes?: readonly string[] } = {}) {
    this.isDown = isDown;
    this.universe = [...(opts.codes ?? [])];
  }

  poll(tick: number): InputEvent[] {
    const scan = this.universe.length > 0 ? this.universe : [...this.prev];
    const now = new Set<string>();
    for (const code of scan) if (this.isDown(code)) now.add(code);

    const events: InputEvent[] = [];
    for (const code of now) {
      if (!this.prev.has(code)) {
        events.push({ device: 'key', code, state: 'down', value: 1, tick });
      }
    }
    for (const code of this.prev) {
      if (!now.has(code)) {
        events.push({ device: 'key', code, state: 'up', value: 0, tick });
      }
    }

    this.prev = now;
    return events;
  }
}

/* ------------------------------------------------------------------ *
 * Mouse
 * ------------------------------------------------------------------ */

/** Snapshot of raw mouse state for one poll (mutate it between polls in tests). */
export interface MouseRaw {
  /** Normalized pointer X in [-1,1]. */
  x: number;
  /** Normalized pointer Y in [-1,1]. */
  y: number;
  /** Currently pressed button codes (e.g. 'Left', 'Right'). */
  buttons: readonly string[];
}

export type MouseSource = () => MouseRaw;

/**
 * Adapter over a raw mouse source. Emits an `axis` event for each axis on every
 * poll (value clamped to [-1,1]) plus `down`/`up` transitions for buttons.
 */
export class MouseAdapter implements InputDevice {
  private readonly source: MouseSource;
  private prev = new Set<string>();

  constructor(source: MouseSource) {
    this.source = source;
  }

  poll(tick: number): InputEvent[] {
    const s = this.source();
    const now = new Set(s.buttons);
    const events: InputEvent[] = [
      { device: 'mouse', code: 'X', state: 'axis', value: clamp11(s.x), tick },
      { device: 'mouse', code: 'Y', state: 'axis', value: clamp11(s.y), tick },
    ];
    for (const b of now) {
      if (!this.prev.has(b)) {
        events.push({ device: 'mouse', code: b, state: 'down', value: 1, tick });
      }
    }
    for (const b of this.prev) {
      if (!now.has(b)) {
        events.push({ device: 'mouse', code: b, state: 'up', value: 0, tick });
      }
    }
    this.prev = now;
    return events;
  }
}

/* ------------------------------------------------------------------ *
 * Gamepad
 * ------------------------------------------------------------------ */

/** Snapshot of raw gamepad state for one poll. */
export interface GamepadRaw {
  /** Analog axis values in [-1,1], indexed by axis number (e.g. 0 = left stick X). */
  axes: readonly number[];
  /** Currently pressed button codes (e.g. 'A', 'B', 'Shoulder'). */
  buttons: readonly string[];
}

export type GamepadSource = () => GamepadRaw;

/**
 * Adapter over a raw gamepad source. Emits one `axis` event per analog axis
 * (clamped to [-1,1]) plus `down`/`up` transitions for buttons. Axis codes are
 * `Axis0`, `Axis1`, … so they remain stable and deterministic across replays.
 */
export class GamepadAdapter implements InputDevice {
  private readonly source: GamepadSource;
  private prev = new Set<string>();

  constructor(source: GamepadSource) {
    this.source = source;
  }

  poll(tick: number): InputEvent[] {
    const s = this.source();
    const now = new Set(s.buttons);
    const events: InputEvent[] = [];

    for (let i = 0; i < s.axes.length; i++) {
      events.push({ device: 'pad', code: `Axis${i}`, state: 'axis', value: clamp11(s.axes[i]), tick });
    }
    for (const b of now) {
      if (!this.prev.has(b)) {
        events.push({ device: 'pad', code: b, state: 'down', value: 1, tick });
      }
    }
    for (const b of this.prev) {
      if (!now.has(b)) {
        events.push({ device: 'pad', code: b, state: 'up', value: 0, tick });
      }
    }
    this.prev = now;
    return events;
  }
}

/** Re-exported for consumers building ad-hoc adapters. */
export type { EventState };
