/**
 * @omega/input-core — determinism & replay tests.
 *
 * These tests assert the three core guarantees:
 *  1. Frame sampling is idempotent for the same event sequence.
 *  2. Replay: the same event sequence yields a frame-for-frame identical
 *     `InputFrame` sequence.
 *  3. `collectFrame` is pure — no hidden `Date.now`/`Math.random`, no dependence
 *     on wall-clock time.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  InputState,
  InputBuffer,
  collectFrame,
  keyId,
  createInputSource,
  type InputFrame,
} from './index.js';

/** A scripted input action applied to a state before a sample. */
type Action =
  | { t: 'down'; code: string }
  | { t: 'up'; code: string }
  | { t: 'move'; x: number; y: number }
  | { t: 'mdown'; b: number }
  | { t: 'mup'; b: number }
  | { t: 'wheel'; d: number };

/** One frame's worth of scripted actions. */
type Script = Action[][];

function apply(state: InputState, actions: Action[]): void {
  for (const a of actions) {
    switch (a.t) {
      case 'down': state.keyDown(a.code); break;
      case 'up': state.keyUp(a.code); break;
      case 'move': state.moveMouse(a.x, a.y); break;
      case 'mdown': state.mouseDown(a.b); break;
      case 'mup': state.mouseUp(a.b); break;
      case 'wheel': state.addWheel(a.d); break;
    }
  }
}

/** Run a full script through a fresh state, returning the sampled frames. */
function run(script: Script): InputFrame[] {
  const state = new InputState();
  const frames: InputFrame[] = [];
  for (let f = 0; f < script.length; f++) {
    apply(state, script[f]);
    frames.push(collectFrame(state, f));
    state.beginFrame();
  }
  return frames;
}

/** Structural equality of two frames (typed arrays compared element-wise). */
function frameEqual(a: InputFrame, b: InputFrame): boolean {
  return (
    a.frame === b.frame &&
    a.mouseX === b.mouseX &&
    a.mouseY === b.mouseY &&
    a.mouseButtons === b.mouseButtons &&
    a.mousePressed === b.mousePressed &&
    a.mouseReleased === b.mouseReleased &&
    a.wheel === b.wheel &&
    a.heldKeys.length === b.heldKeys.length &&
    a.heldKeys.every((v, i) => v === b.heldKeys[i]) &&
    a.pressedKeys.length === b.pressedKeys.length &&
    a.pressedKeys.every((v, i) => v === b.pressedKeys[i]) &&
    a.releasedKeys.length === b.releasedKeys.length &&
    a.releasedKeys.every((v, i) => v === b.releasedKeys[i])
  );
}

const SCRIPT: Script = [
  [{ t: 'down', code: 'KeyW' }, { t: 'move', x: 10, y: 20 }],
  [{ t: 'down', code: 'KeyA' }, { t: 'mdown', b: 0 }, { t: 'wheel', d: 3 }],
  [{ t: 'up', code: 'KeyW' }, { t: 'move', x: 11, y: 19 }],
  [{ t: 'mup', b: 0 }, { t: 'down', code: 'Space' }],
  [{ t: 'up', code: 'KeyA' }, { t: 'up', code: 'Space' }],
];

describe('keyId', () => {
  it('is deterministic and stable per code', () => {
    expect(keyId('KeyW')).toBe(keyId('KeyW'));
    expect(keyId('KeyW')).not.toBe(keyId('KeyA'));
    expect(keyId('KeyW') >>> 0).toBe(keyId('KeyW')); // 32-bit unsigned
  });
});

describe('collectFrame idempotency', () => {
  it('sampling the same state twice yields identical frames', () => {
    const state = new InputState();
    apply(state, SCRIPT[0]);
    const a = collectFrame(state, 0);
    const b = collectFrame(state, 0);
    expect(frameEqual(a, b)).toBe(true);
  });

  it('does not mutate the state when sampling', () => {
    const state = new InputState();
    apply(state, [{ t: 'down', code: 'KeyW' }, { t: 'mdown', b: 1 }]);
    const before = { held: state.held.size, pressed: state.pressed.size, mb: state.mouseButtons };
    collectFrame(state, 0);
    collectFrame(state, 0);
    expect(state.held.size).toBe(before.held);
    expect(state.pressed.size).toBe(before.pressed);
    expect(state.mouseButtons).toBe(before.mb);
  });

  it('produces sorted, order-independent key arrays', () => {
    const s1 = new InputState();
    s1.keyDown('KeyZ'); s1.keyDown('KeyA'); s1.keyDown('KeyM');
    const s2 = new InputState();
    s2.keyDown('KeyM'); s2.keyDown('KeyZ'); s2.keyDown('KeyA');
    const f1 = collectFrame(s1, 0);
    const f2 = collectFrame(s2, 0);
    expect(Array.from(f1.heldKeys)).toEqual(Array.from(f2.heldKeys));
    // ascending
    for (let i = 1; i < f1.heldKeys.length; i++) {
      expect(f1.heldKeys[i] >= f1.heldKeys[i - 1]).toBe(true);
    }
  });
});

describe('replay determinism', () => {
  it('the same event sequence yields a frame-for-frame identical sequence', () => {
    const a = run(SCRIPT);
    const b = run(SCRIPT);
    expect(a.length).toBe(b.length);
    for (let i = 0; i < a.length; i++) {
      expect(frameEqual(a[i], b[i])).toBe(true);
    }
  });

  it('replay through the ring buffer preserves the sequence', () => {
    const frames = run(SCRIPT);
    const buf = new InputBuffer(64);
    for (const f of frames) buf.push(f);
    const out = buf.toArray();
    expect(out.length).toBe(frames.length);
    for (let i = 0; i < frames.length; i++) {
      expect(frameEqual(out[i], frames[i])).toBe(true);
    }
  });

  it('is independent of wall-clock time between samples', () => {
    // Force Date.now / performance.now to diverge wildly between the two runs.
    const a = (() => {
      vi.useFakeTimers();
      vi.setSystemTime(0);
      const r = run(SCRIPT);
      vi.useRealTimers();
      return r;
    })();
    const b = (() => {
      vi.useFakeTimers();
      vi.setSystemTime(1_000_000_000);
      const r = run(SCRIPT);
      vi.useRealTimers();
      return r;
    })();
    for (let i = 0; i < a.length; i++) {
      expect(frameEqual(a[i], b[i])).toBe(true);
    }
  });
});

describe('edge semantics', () => {
  it('pressed fires once, held persists, released fires once', () => {
    const state = new InputState();
    state.keyDown('KeyW');
    const f0 = collectFrame(state, 0);
    expect(Array.from(f0.pressedKeys)).toEqual([keyId('KeyW')]);
    expect(Array.from(f0.heldKeys)).toEqual([keyId('KeyW')]);
    state.beginFrame();

    // Repeat down while held is idempotent.
    state.keyDown('KeyW');
    const f1 = collectFrame(state, 1);
    expect(f1.pressedKeys.length).toBe(0);
    expect(Array.from(f1.heldKeys)).toEqual([keyId('KeyW')]);
    state.beginFrame();

    state.keyUp('KeyW');
    const f2 = collectFrame(state, 2);
    expect(Array.from(f2.releasedKeys)).toEqual([keyId('KeyW')]);
    expect(f2.heldKeys.length).toBe(0);
  });

  it('mouse buttons use bitmasks with correct edges', () => {
    const state = new InputState();
    state.mouseDown(0);
    state.mouseDown(2);
    const f0 = collectFrame(state, 0);
    expect(f0.mouseButtons).toBe(0b101);
    expect(f0.mousePressed).toBe(0b101);
    state.beginFrame();

    state.mouseUp(0);
    const f1 = collectFrame(state, 1);
    expect(f1.mouseButtons).toBe(0b100);
    expect(f1.mouseReleased).toBe(0b001);
    expect(f1.mousePressed).toBe(0);
  });

  it('wheel accumulates within a frame and resets after beginFrame', () => {
    const state = new InputState();
    state.addWheel(2);
    state.addWheel(3);
    expect(collectFrame(state, 0).wheel).toBe(5);
    state.beginFrame();
    expect(collectFrame(state, 1).wheel).toBe(0);
  });
});

describe('createInputSource', () => {
  /** Minimal fake target capturing listeners so we can dispatch synthetic events. */
  function makeTarget() {
    const map = new Map<string, ((ev: unknown) => void)[]>();
    return {
      addEventListener(type: string, fn: (ev: unknown) => void) {
        const arr = map.get(type) ?? [];
        arr.push(fn);
        map.set(type, arr);
      },
      removeEventListener(type: string, fn: (ev: unknown) => void) {
        const arr = map.get(type);
        if (arr) map.set(type, arr.filter((f) => f !== fn));
      },
      fire(type: string, ev: unknown) {
        for (const fn of map.get(type) ?? []) fn(ev);
      },
      count(type: string) {
        return (map.get(type) ?? []).length;
      },
    };
  }

  it('feeds DOM-ish events into state and samples deterministically', () => {
    const target = makeTarget();
    const src = createInputSource(target);
    target.fire('keydown', { code: 'KeyW', repeat: false });
    target.fire('mousemove', { clientX: 42, clientY: 7 });
    target.fire('mousedown', { button: 0 });
    target.fire('wheel', { deltaY: 4 });

    const f = collectFrame(src.state, 0);
    expect(Array.from(f.pressedKeys)).toEqual([keyId('KeyW')]);
    expect(f.mouseX).toBe(42);
    expect(f.mouseY).toBe(7);
    expect(f.mouseButtons).toBe(0b1);
    expect(f.wheel).toBe(4);
  });

  it('ignores OS auto-repeat keydown', () => {
    const target = makeTarget();
    const src = createInputSource(target);
    target.fire('keydown', { code: 'KeyW', repeat: false });
    collectFrame(src.state, 0);
    src.state.beginFrame();
    target.fire('keydown', { code: 'KeyW', repeat: true }); // auto-repeat
    const f = collectFrame(src.state, 1);
    expect(f.pressedKeys.length).toBe(0);
  });

  it('dispose detaches listeners and is idempotent', () => {
    const target = makeTarget();
    const src = createInputSource(target);
    expect(target.count('keydown')).toBe(1);
    src.dispose();
    src.dispose();
    expect(target.count('keydown')).toBe(0);
  });
});

describe('InputBuffer', () => {
  it('rejects non-positive capacity', () => {
    expect(() => new InputBuffer(0)).toThrow();
    expect(() => new InputBuffer(-1)).toThrow();
    expect(() => new InputBuffer(1.5)).toThrow();
  });

  it('overwrites oldest when full and keeps chronological order', () => {
    const buf = new InputBuffer(3);
    const mk = (n: number): InputFrame => collectFrame(new InputState(), n);
    for (let i = 0; i < 5; i++) buf.push(mk(i));
    expect(buf.size).toBe(3);
    expect(buf.toArray().map((f) => f.frame)).toEqual([2, 3, 4]);
    expect(buf.last()?.frame).toBe(4);
    expect(buf.at(0)?.frame).toBe(2);
    expect(buf.at(-1)).toBeUndefined();
    expect(buf.at(3)).toBeUndefined();
  });

  it('clear empties the buffer', () => {
    const buf = new InputBuffer(2);
    buf.push(collectFrame(new InputState(), 0));
    buf.clear();
    expect(buf.size).toBe(0);
    expect(buf.last()).toBeUndefined();
  });
});

describe('reset', () => {
  it('clears held, edges and pointer', () => {
    const state = new InputState();
    state.keyDown('KeyW');
    state.mouseDown(0);
    state.moveMouse(5, 5);
    state.reset();
    const f = collectFrame(state, 0);
    expect(f.heldKeys.length).toBe(0);
    expect(f.mouseButtons).toBe(0);
    expect(f.mouseX).toBe(0);
    expect(f.mouseY).toBe(0);
  });
});
