import { describe, it, expect } from 'vitest';
import { KeyboardAdapter, MouseAdapter, GamepadAdapter } from './devices.js';
import type { MouseRaw, GamepadRaw } from './devices.js';

describe('KeyboardAdapter', () => {
  it('emits a down event for a newly-held key tagged with the passed-in tick', () => {
    let held = new Set<string>(['KeyW']);
    const kb = new KeyboardAdapter((code) => held.has(code), { codes: ['KeyW', 'KeyA'] });
    const ev = kb.poll(7);
    expect(ev).toEqual([{ device: 'key', code: 'KeyW', state: 'down', value: 1, tick: 7 }]);
  });

  it('emits an up event when a key is released (still scanned via prev set)', () => {
    let held = new Set<string>(['KeyW']);
    const kb = new KeyboardAdapter((code) => held.has(code), { codes: ['KeyW'] });
    kb.poll(1); // press
    held = new Set<string>(); // release
    const ev = kb.poll(2);
    expect(ev).toEqual([{ device: 'key', code: 'KeyW', state: 'up', value: 0, tick: 2 }]);
  });

  it('emits nothing for a held key that was already down (no repeat)', () => {
    let held = new Set<string>(['KeyW']);
    const kb = new KeyboardAdapter((code) => held.has(code), { codes: ['KeyW'] });
    kb.poll(1);
    expect(kb.poll(2)).toEqual([]); // still held, no new event
  });

  it('does not detect downs for codes outside the scanned universe', () => {
    const held = new Set<string>(['Escape']); // not in codes
    const kb = new KeyboardAdapter((code) => held.has(code), { codes: ['KeyW'] });
    expect(kb.poll(5)).toEqual([]);
  });

  it('is deterministic: identical poll sequence yields identical events', () => {
    const a = new KeyboardAdapter((c) => c === 'KeyW', { codes: ['KeyW'] });
    const b = new KeyboardAdapter((c) => c === 'KeyW', { codes: ['KeyW'] });
    const seqA = [a.poll(1), a.poll(2), a.poll(3)];
    const seqB = [b.poll(1), b.poll(2), b.poll(3)];
    expect(seqA).toEqual(seqB);
  });
});

describe('MouseAdapter', () => {
  it('emits axis events clamped to [-1,1] tagged with the tick', () => {
    const raw: MouseRaw = { x: 0.5, y: -0.25, buttons: [] };
    const mouse = new MouseAdapter(() => raw);
    expect(mouse.poll(3)).toEqual([
      { device: 'mouse', code: 'X', state: 'axis', value: 0.5, tick: 3 },
      { device: 'mouse', code: 'Y', state: 'axis', value: -0.25, tick: 3 },
    ]);
  });

  it('clamps out-of-range axis values', () => {
    const raw: MouseRaw = { x: 5, y: -9, buttons: [] };
    const mouse = new MouseAdapter(() => raw);
    const ev = mouse.poll(1);
    expect(ev[0].value).toBe(1);
    expect(ev[1].value).toBe(-1);
  });

  it('emits a down/up transition for buttons', () => {
    let raw: MouseRaw = { x: 0, y: 0, buttons: ['Left'] };
    const mouse = new MouseAdapter(() => raw);
    expect(mouse.poll(1).some((e) => e.code === 'Left' && e.state === 'down')).toBe(true);
    raw = { x: 0, y: 0, buttons: [] };
    expect(mouse.poll(2).some((e) => e.code === 'Left' && e.state === 'up')).toBe(true);
  });
});

describe('GamepadAdapter', () => {
  it('emits one axis event per analog axis, tagged with tick', () => {
    const raw: GamepadRaw = { axes: [0.8, -0.3, 0], buttons: [] };
    const pad = new GamepadAdapter(() => raw);
    expect(pad.poll(4)).toEqual([
      { device: 'pad', code: 'Axis0', state: 'axis', value: 0.8, tick: 4 },
      { device: 'pad', code: 'Axis1', state: 'axis', value: -0.3, tick: 4 },
      { device: 'pad', code: 'Axis2', state: 'axis', value: 0, tick: 4 },
    ]);
  });

  it('clamps out-of-range gamepad axes', () => {
    const raw: GamepadRaw = { axes: [2, -3], buttons: [] };
    const pad = new GamepadAdapter(() => raw);
    const ev = pad.poll(1);
    expect(ev[0].value).toBe(1);
    expect(ev[1].value).toBe(-1);
  });

  it('emits button down/up transitions', () => {
    let raw: GamepadRaw = { axes: [], buttons: ['A'] };
    const pad = new GamepadAdapter(() => raw);
    expect(pad.poll(1).some((e) => e.code === 'A' && e.state === 'down')).toBe(true);
    raw = { axes: [], buttons: [] };
    expect(pad.poll(2).some((e) => e.code === 'A' && e.state === 'up')).toBe(true);
  });
});

describe('determinism / no-clock guarantees', () => {
  it('no clock source is reachable: adapters only emit what is injected', () => {
    // Two adapters, same injected input at *different* ticks, must differ only by tick.
    const raw: MouseRaw = { x: 0.1, y: 0.2, buttons: [] };
    const m1 = new MouseAdapter(() => raw);
    const m2 = new MouseAdapter(() => raw);
    const e1 = m1.poll(100);
    const e2 = m2.poll(200);
    expect(e1[0].value).toBe(e2[0].value); // value unchanged
    expect(e1[0].tick).toBe(100); // tick purely from param
    expect(e2[0].tick).toBe(200);
  });
});
