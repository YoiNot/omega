import { describe, it, expect } from 'vitest';
import { Rng } from '@omega/engine-core';
import { KeyboardAdapter, MouseAdapter, CommandRecorder, Replayer, encodeEvents, decodeEvents } from './index.js';
import type { InputEvent } from './types.js';

/**
 * Integration: feed a SCRIPTED device stream through a recorder and replay it,
 * asserting the exact command sequence is reproduced. The Rng is used ONLY to
 * synthesize a deterministic scripted input pattern (never inside core logic).
 */
describe('integration: scripted device stream -> recorder -> replay', () => {
  it('reproduces the same commands after a full record/replay cycle', () => {
    const rng = new Rng(12345);
    const keyUniverse = ['KeyW', 'KeyA', 'KeyS', 'KeyD'];

    // Script: which keys are held at each tick (deterministic via seeded Rng).
    const script: Set<string>[] = [];
    for (let tick = 0; tick < 12; tick++) {
      const set = new Set<string>();
      for (const code of keyUniverse) if (rng.bool(0.4)) set.add(code);
      script.push(set);
    }

    let kbTick = 0;
    const kb = new KeyboardAdapter((c) => script[kbTick]?.has(c) ?? false, { codes: keyUniverse });
    // expose current tick for the injected predicate

    const rec = new CommandRecorder();
    const original: InputEvent[][] = [];

    for (let tick = 0; tick < script.length; tick++) {
      kbTick = tick;
      const events = kb.poll(tick);
      original.push(events);
      if (events.length > 0) rec.record(encodeEvents(events), tick);
    }

    // Replay the entire log and decode back to events.
    const replay = new Replayer(rec.logOf());
    const replayed = replay.all().map((c) => decodeEvents(c.payload));

    // Every recorded tick must re-emit exactly the events we captured originally.
    let idx = 0;
    for (let tick = 0; tick < script.length; tick++) {
      if (original[tick].length > 0) {
        expect(replayed[idx]).toEqual(original[tick]);
        idx++;
      }
    }
    expect(idx).toBe(rec.recordedCount);
    expect(replay.length).toBe(rec.recordedCount);
  });

  it('acknowledges a range then replays only the still-pending commands', () => {
    const raw = { x: 0, y: 0, buttons: [] as string[] };
    const mouse = new MouseAdapter(() => raw);
    const rec = new CommandRecorder();
    // tick 0: no buttons -> empty events -> no command recorded
    rec.record(encodeEvents(mouse.poll(0)), 0);
    raw.buttons = ['Left'];
    rec.record(encodeEvents(mouse.poll(1)), 1);
    raw.buttons = [];
    rec.record(encodeEvents(mouse.poll(2)), 2);

    rec.ack(1); // drops tick-0 and tick-1 commands
    expect(rec.unacked().map((c) => c.tick)).toEqual([2]);

    const replay = new Replayer(rec.logOf());
    // full log still contains all three
    expect(replay.all().map((c) => c.tick)).toEqual([0, 1, 2]);
    // replay-from filters deterministically by tick
    expect(replay.from(2).map((c) => c.tick)).toEqual([2]);
  });
});
