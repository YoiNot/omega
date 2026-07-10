/**
 * @omega/input-core — mutable input state and the pure frame sampler.
 *
 * `InputState` is a mutable accumulator that raw event handlers write into. It is
 * NOT frame-stable by itself. `collectFrame` reads a state and produces an
 * immutable, sorted, typed `InputFrame` — this is the ONLY sampling boundary and
 * it is a pure function of (state, frame): no clock, no randomness, no hidden
 * DOM time. After sampling, edge sets (pressed/released, wheel) are cleared for
 * the next frame via `beginFrame`.
 */

import { hashString64 } from '@omega/engine-core';
import { Vec2 } from '@omega/engine-math';
import type { InputFrame } from './types.js';

/** Low 32 bits of the deterministic FNV-1a hash of a key code. */
export function keyId(code: string): number {
  return Number(hashString64(code) & 0xffffffffn) >>> 0;
}

/**
 * Mutable input accumulator. Handlers call the mutation methods; the sampler
 * (`collectFrame`) reads it. Held sets persist across frames; edge sets and the
 * wheel accumulator are transient and cleared by `beginFrame`.
 */
export class InputState {
  /** Currently held key ids. */
  readonly held = new Set<number>();
  /** Key ids that went down since the last `beginFrame`. */
  readonly pressed = new Set<number>();
  /** Key ids that went up since the last `beginFrame`. */
  readonly released = new Set<number>();

  /** Pointer position, decoupled from wall-clock time. */
  readonly mouse = new Vec2(0, 0);

  /** Mouse button bitmasks. */
  mouseButtons = 0;
  mousePressed = 0;
  mouseReleased = 0;

  /** Accumulated wheel delta for the current frame. */
  wheel = 0;

  /** Register a key-down. Idempotent: repeat-downs of a held key are ignored. */
  keyDown(code: string): void {
    const id = keyId(code);
    if (this.held.has(id)) return;
    this.held.add(id);
    this.pressed.add(id);
    this.released.delete(id);
  }

  /** Register a key-up. */
  keyUp(code: string): void {
    const id = keyId(code);
    if (!this.held.has(id)) return;
    this.held.delete(id);
    this.released.add(id);
    this.pressed.delete(id);
  }

  /** Set pointer position (source decides normalized vs pixel coordinates). */
  moveMouse(x: number, y: number): void {
    this.mouse.set(x, y);
  }

  /** Register a mouse button-down (button index 0..30). */
  mouseDown(button: number): void {
    const bit = 1 << button;
    if ((this.mouseButtons & bit) !== 0) return;
    this.mouseButtons |= bit;
    this.mousePressed |= bit;
    this.mouseReleased &= ~bit;
  }

  /** Register a mouse button-up. */
  mouseUp(button: number): void {
    const bit = 1 << button;
    if ((this.mouseButtons & bit) === 0) return;
    this.mouseButtons &= ~bit;
    this.mouseReleased |= bit;
    this.mousePressed &= ~bit;
  }

  /** Accumulate a wheel delta for the current frame. */
  addWheel(delta: number): void {
    this.wheel += delta;
  }

  /**
   * Clear transient (per-frame edge) state. Call AFTER sampling a frame, before
   * accepting the next frame's events. Held keys and mouse position persist.
   */
  beginFrame(): void {
    this.pressed.clear();
    this.released.clear();
    this.mousePressed = 0;
    this.mouseReleased = 0;
    this.wheel = 0;
  }

  /** Reset everything to the empty state (held + edges + pointer). */
  reset(): void {
    this.held.clear();
    this.beginFrame();
    this.mouse.set(0, 0);
    this.mouseButtons = 0;
  }
}

/** Sorted Uint32Array from a numeric set (order-independent output). */
function sortedU32(set: ReadonlySet<number>): Uint32Array {
  const out = Uint32Array.from(set);
  out.sort();
  return out;
}

/**
 * Sample a `state` into an immutable, sorted `InputFrame` for the given `frame`.
 *
 * PURE: depends only on (state, frame). No `Date.now`, no `Math.random`, no DOM
 * access. Calling it twice with the same state and frame yields byte-identical
 * arrays and scalar fields. It does NOT mutate the state (call `beginFrame`
 * yourself once you are done with the returned frame).
 */
export function collectFrame(state: InputState, frame: number): InputFrame {
  return {
    frame,
    heldKeys: sortedU32(state.held),
    pressedKeys: sortedU32(state.pressed),
    releasedKeys: sortedU32(state.released),
    mouseX: state.mouse.x,
    mouseY: state.mouse.y,
    mouseButtons: state.mouseButtons,
    mousePressed: state.mousePressed,
    mouseReleased: state.mouseReleased,
    wheel: state.wheel,
  };
}
