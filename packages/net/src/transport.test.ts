import { describe, it, expect } from 'vitest';
import { LoopbackTransport } from './transport.js';

describe('LoopbackTransport', () => {
  it('delivers sent bytes to a registered receiver', () => {
    const t = new LoopbackTransport();
    const received: Uint8Array[] = [];
    t.onMessage((m) => received.push(m));

    const frame = new Uint8Array([1, 2, 3, 4]);
    t.send(frame);
    expect(t.pending).toBe(1);

    const delivered = t.tick();
    expect(delivered).toBe(1);
    expect(received).toHaveLength(1);
    expect([...received[0]]).toEqual([1, 2, 3, 4]);
    expect(t.pending).toBe(0);
  });

  it('does not invoke callbacks synchronously from send', () => {
    const t = new LoopbackTransport();
    let calls = 0;
    t.onMessage(() => { calls += 1; });
    t.send(new Uint8Array([9]));
    expect(calls).toBe(0); // async-only
    t.tick();
    expect(calls).toBe(1);
  });

  it('delivers copies so the caller can mutate its buffer', () => {
    const t = new LoopbackTransport();
    const got: Uint8Array[] = [];
    t.onMessage((m) => got.push(m));

    const frame = new Uint8Array([5, 6]);
    t.send(frame);
    frame[0] = 99; // mutate after send
    t.tick();

    expect([...got[0]]).toEqual([5, 6]); // delivered copy is pristine
  });

  it('delivers the same frame to multiple receivers', () => {
    const t = new LoopbackTransport();
    const a: Uint8Array[] = [];
    const b: Uint8Array[] = [];
    t.onMessage((m) => a.push(m));
    t.onMessage((m) => b.push(m));
    t.send(new Uint8Array([7, 8]));
    t.tick();
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
    expect([...a[0]]).toEqual([7, 8]);
    expect([...b[0]]).toEqual([7, 8]);
  });

  it('close stops delivery and drops pending frames', () => {
    const t = new LoopbackTransport();
    let calls = 0;
    t.onMessage(() => { calls += 1; });
    t.send(new Uint8Array([1]));
    t.close();
    expect(t.isClosed).toBe(true);
    expect(t.pending).toBe(0);
    expect(t.tick()).toBe(0);
    expect(calls).toBe(0);
    // sends after close are ignored
    t.send(new Uint8Array([2]));
    expect(t.pending).toBe(0);
  });

  it('flushAsync delivers queued frames on a microtask', async () => {
    const t = new LoopbackTransport();
    const got: Uint8Array[] = [];
    t.onMessage((m) => got.push(m));
    t.send(new Uint8Array([3, 2, 1]));
    await t.flushAsync();
    expect(got).toHaveLength(1);
    expect([...got[0]]).toEqual([3, 2, 1]);
  });

  it('contains no Math.random in its delivery path', () => {
    // Re-deliver several frames; outcome is purely a function of send order.
    const t = new LoopbackTransport();
    const out: number[] = [];
    t.onMessage((m) => out.push(m[0]));
    for (let i = 0; i < 5; i++) t.send(new Uint8Array([i]));
    t.tick();
    expect(out).toEqual([0, 1, 2, 3, 4]);
  });
});
