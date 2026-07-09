import { describe, it, expect } from 'vitest';
import { CommandRecorder, Replayer, encodeEvents, decodeEvents } from './recorder.js';
import type { InputEvent } from './types.js';

/** Build a deterministic event list for a tick (no RNG needed for core logic). */
function evs(tick: number, codes: string[]): InputEvent[] {
  return codes.map((code) => ({ device: 'key', code, state: 'down', value: 1, tick }));
}

describe('CommandRecorder', () => {
  it('assigns strictly increasing sequence numbers', () => {
    const r = new CommandRecorder();
    const c1 = r.record(new Uint8Array([1]), 0);
    const c2 = r.record(new Uint8Array([2]), 1);
    const c3 = r.record(new Uint8Array([3]), 2);
    expect(c1.seq).toBe(0);
    expect(c2.seq).toBe(1);
    expect(c3.seq).toBe(2);
    expect(r.nextSequence).toBe(3);
  });

  it('stamps the tick on each recorded command', () => {
    const r = new CommandRecorder();
    const c = r.record(new Uint8Array([0]), 42);
    expect(c.tick).toBe(42);
  });

  it('copies payloads so later mutation does not leak', () => {
    const r = new CommandRecorder();
    const p = new Uint8Array([9]);
    const c = r.record(p, 0);
    p[0] = 0;
    expect([...c.payload]).toEqual([9]);
  });

  it('ack removes acknowledged commands from the inflight set', () => {
    const r = new CommandRecorder();
    r.record(new Uint8Array([1]), 0);
    r.record(new Uint8Array([2]), 1);
    r.record(new Uint8Array([3]), 2);
    expect(r.pendingCount).toBe(3);
    expect(r.ack(1)).toBe(2);
    expect(r.pendingCount).toBe(1);
    expect(r.unacked().map((c) => c.seq)).toEqual([2]);
  });

  it('unacked returns pending commands in ascending seq order', () => {
    const r = new CommandRecorder();
    r.record(new Uint8Array([10]), 0);
    r.record(new Uint8Array([11]), 1);
    r.record(new Uint8Array([12]), 2);
    r.ack(0);
    const unacked = r.unacked();
    expect(unacked.map((c) => c.seq)).toEqual([1, 2]);
    expect([...unacked[0].payload]).toEqual([11]);
    expect([...unacked[1].payload]).toEqual([12]);
  });

  it('keeps the full log even after acks (for replay)', () => {
    const r = new CommandRecorder();
    r.record(new Uint8Array([1]), 0);
    r.record(new Uint8Array([2]), 1);
    r.ack(0);
    expect(r.recordedCount).toBe(2);
    expect(r.logOf().map((c) => c.seq)).toEqual([0, 1]);
  });

  it('handles ack with no / no-more matching commands gracefully', () => {
    const r = new CommandRecorder();
    r.record(new Uint8Array([1]), 0);
    expect(r.ack(5)).toBe(1); // acks the only (seq 0 <= 5)
    expect(r.ack(5)).toBe(0); // nothing left
    expect(r.pendingCount).toBe(0);
  });

  it('never reuses sequence numbers after acks', () => {
    const r = new CommandRecorder();
    r.record(new Uint8Array([1]), 0);
    r.ack(0);
    const c = r.record(new Uint8Array([2]), 1);
    expect(c.seq).toBe(1);
  });

  it('is deterministic for identical record/ack sequences', () => {
    const build = () => {
      const r = new CommandRecorder();
      const seqs: number[] = [];
      for (let i = 0; i < 4; i++) seqs.push(r.record(new Uint8Array([i]), i).seq);
      r.ack(1);
      return r.unacked().map((c) => c.seq);
    };
    expect(build()).toEqual([2, 3]);
    expect(build()).toEqual([2, 3]);
  });
});

describe('payload codec', () => {
  it('round-trips a stream of mixed events exactly', () => {
    const events: InputEvent[] = [
      { device: 'key', code: 'KeyW', state: 'down', value: 1, tick: 0 },
      { device: 'mouse', code: 'X', state: 'axis', value: -0.5, tick: 0 },
      { device: 'pad', code: 'Axis0', state: 'axis', value: 0.25, tick: 1 },
      { device: 'key', code: 'KeyA', state: 'up', value: 0, tick: 2 },
    ];
    expect(decodeEvents(encodeEvents(events))).toEqual(events);
  });

  it('produces byte-identical output for identical input', () => {
    const a = encodeEvents(evs(3, ['KeyW', 'KeyA']));
    const b = encodeEvents(evs(3, ['KeyW', 'KeyA']));
    expect([...a]).toEqual([...b]);
  });

  it('throws on truncated payloads (defensive)', () => {
    expect(() => decodeEvents(new Uint8Array([0]))).toThrow();
  });
});

describe('Replayer', () => {
  it('reproduces the exact command sequence in seq order', () => {
    const r = new CommandRecorder();
    const cmds = [
      r.record(encodeEvents(evs(0, ['KeyW'])), 0),
      r.record(encodeEvents(evs(1, ['KeyA'])), 1),
      r.record(encodeEvents(evs(2, ['KeyS'])), 2),
    ];
    const replay = new Replayer(cmds);
    expect(replay.all().map((c) => c.seq)).toEqual([0, 1, 2]);
    expect(replay.length).toBe(3);
  });

  it('replays from a given tick, dropping earlier commands', () => {
    const r = new CommandRecorder();
    r.record(encodeEvents(evs(0, ['KeyW'])), 0);
    r.record(encodeEvents(evs(1, ['KeyA'])), 1);
    r.record(encodeEvents(evs(2, ['KeyS'])), 2);
    r.record(encodeEvents(evs(3, ['KeyD'])), 3);
    const replay = new Replayer(r.logOf());
    const from2 = replay.from(2);
    expect(from2.map((c) => c.tick)).toEqual([2, 3]);
  });

  it('is deterministic regardless of input array ordering', () => {
    const r = new CommandRecorder();
    const c0 = r.record(encodeEvents(evs(0, ['KeyW'])), 0);
    const c1 = r.record(encodeEvents(evs(1, ['KeyA'])), 1);
    const forward = new Replayer([c0, c1]).all().map((c) => c.seq);
    const reversed = new Replayer([c1, c0]).all().map((c) => c.seq);
    expect(forward).toEqual([0, 1]);
    expect(reversed).toEqual([0, 1]); // sorted internally
  });

  it('does not mutate the source commands on replay', () => {
    const r = new CommandRecorder();
    const c = r.record(new Uint8Array([7]), 0);
    const replay = new Replayer([c]);
    const got = replay.all()[0];
    got.payload[0] = 99;
    expect(c.payload[0]).toBe(7);
  });
});
