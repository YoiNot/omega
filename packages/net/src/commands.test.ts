import { describe, it, expect } from 'vitest';
import { CommandRecorder, InputCommand } from './commands.js';

describe('CommandRecorder', () => {
  it('assigns strictly increasing sequence numbers', () => {
    const r = new CommandRecorder();
    const c1 = r.record(0, new Uint8Array([1]));
    const c2 = r.record(1, new Uint8Array([2]));
    const c3 = r.record(2, new Uint8Array([3]));
    expect(c1.seq).toBe(0);
    expect(c2.seq).toBe(1);
    expect(c3.seq).toBe(2);
    expect(c1.seq).toBeLessThan(c2.seq);
    expect(c2.seq).toBeLessThan(c3.seq);
    expect(r.nextSequence).toBe(3);
  });

  it('stamps the tick on each command', () => {
    const r = new CommandRecorder();
    const c = r.record(42, new Uint8Array([0]));
    expect(c.tick).toBe(42);
  });

  it('copies payloads so later mutation does not leak', () => {
    const r = new CommandRecorder();
    const p = new Uint8Array([9]);
    const c = r.record(0, p);
    p[0] = 0;
    expect([...c.payload]).toEqual([9]);
  });

  it('ack removes acknowledged commands', () => {
    const r = new CommandRecorder();
    r.record(0, new Uint8Array([1]));
    r.record(1, new Uint8Array([2]));
    r.record(2, new Uint8Array([3]));
    expect(r.pendingCount).toBe(3);
    const removed = r.ack(1);
    expect(removed).toBe(2);
    expect(r.pendingCount).toBe(1);
    expect(r.resend().map((c) => c.seq)).toEqual([2]);
  });

  it('resend returns unacked commands in ascending seq order', () => {
    const r = new CommandRecorder();
    r.record(0, new Uint8Array([10]));
    r.record(1, new Uint8Array([11]));
    r.record(2, new Uint8Array([12]));
    r.ack(0);
    const unacked = r.resend();
    expect(unacked.map((c: InputCommand) => c.seq)).toEqual([1, 2]);
    // payloads intact & ordered
    expect([...unacked[0].payload]).toEqual([11]);
    expect([...unacked[1].payload]).toEqual([12]);
  });

  it('is deterministic for identical record/ack sequences', () => {
    const build = () => {
      const r = new CommandRecorder();
      const seqs: number[] = [];
      for (let i = 0; i < 4; i++) seqs.push(r.record(i, new Uint8Array([i])).seq);
      r.ack(1);
      return r.resend().map((c) => c.seq);
    };
    expect(build()).toEqual([2, 3]);
    expect(build()).toEqual([2, 3]); // identical
  });

  it('handles ack with no matching commands gracefully', () => {
    const r = new CommandRecorder();
    r.record(0, new Uint8Array([1]));
    expect(r.ack(5)).toBe(1); // acks the only one (seq 0 <= 5)
    expect(r.ack(5)).toBe(0); // nothing left
    expect(r.pendingCount).toBe(0);
  });

  it('reuses sequence numbers monotonically after acks', () => {
    const r = new CommandRecorder();
    r.record(0, new Uint8Array([1]));
    r.ack(0);
    const c = r.record(1, new Uint8Array([2]));
    expect(c.seq).toBe(1); // never reused
  });
});
