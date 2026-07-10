/**
 * @omega/input-core — DOM event source.
 *
 * `createInputSource` is the ONLY module that touches DOM events. It attaches
 * keyboard/mouse listeners to a `Windowish` target and funnels them into a
 * mutable `InputState`. Crucially it does NOT sample frames or read a clock:
 * the caller decides WHEN to sample (via `collectFrame`) and supplies the frame
 * index, keeping DOM time fully separated from simulation time.
 */

import { InputState } from './state.js';
import type { Windowish } from './types.js';

/** Structural shape of the keyboard event fields we consume. */
interface KeyEventish {
  readonly code?: string;
  readonly repeat?: boolean;
}

/** Structural shape of the mouse event fields we consume. */
interface MouseEventish {
  readonly button?: number;
  readonly clientX?: number;
  readonly clientY?: number;
}

/** Structural shape of the wheel event field we consume. */
interface WheelEventish {
  readonly deltaY?: number;
}

/** A live input source bound to a DOM-ish target. */
export interface InputSource {
  /** The mutable state being fed by DOM events. Sample it with `collectFrame`. */
  readonly state: InputState;
  /** Detach all listeners. Idempotent. */
  dispose(): void;
}

/**
 * Attach keyboard/mouse listeners to `target` and feed a fresh `InputState`.
 *
 * The returned `state` accumulates events between samples; it is up to the
 * caller's fixed-timestep loop to call `collectFrame(state, frame)` and then
 * `state.beginFrame()`. No clock is read here.
 */
export function createInputSource(target: Windowish): InputSource {
  const state = new InputState();

  const onKeyDown = (ev: unknown): void => {
    const e = ev as KeyEventish;
    if (e.repeat) return; // OS auto-repeat is not a new logical press
    if (typeof e.code === 'string') state.keyDown(e.code);
  };
  const onKeyUp = (ev: unknown): void => {
    const e = ev as KeyEventish;
    if (typeof e.code === 'string') state.keyUp(e.code);
  };
  const onMouseMove = (ev: unknown): void => {
    const e = ev as MouseEventish;
    state.moveMouse(e.clientX ?? 0, e.clientY ?? 0);
  };
  const onMouseDown = (ev: unknown): void => {
    const e = ev as MouseEventish;
    if (typeof e.button === 'number') state.mouseDown(e.button);
  };
  const onMouseUp = (ev: unknown): void => {
    const e = ev as MouseEventish;
    if (typeof e.button === 'number') state.mouseUp(e.button);
  };
  const onWheel = (ev: unknown): void => {
    const e = ev as WheelEventish;
    state.addWheel(e.deltaY ?? 0);
  };

  const bindings: [string, (ev: unknown) => void][] = [
    ['keydown', onKeyDown],
    ['keyup', onKeyUp],
    ['mousemove', onMouseMove],
    ['mousedown', onMouseDown],
    ['mouseup', onMouseUp],
    ['wheel', onWheel],
  ];
  for (const [type, fn] of bindings) target.addEventListener(type, fn);

  let disposed = false;
  return {
    state,
    dispose(): void {
      if (disposed) return;
      disposed = true;
      for (const [type, fn] of bindings) target.removeEventListener(type, fn);
    },
  };
}
