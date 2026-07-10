import { describe, it, expect } from 'vitest';
import { LocalHub } from './hub.js';
import { LoopbackTransport } from './transport.js';

describe('LocalHub transport', () => {
  it('broadcasts a sender frame to all other attached peers', () => {
    const hub = new LocalHub();
    const server = hub.attach();
    const c1 = hub.attach();
    const c2 = hub.attach();
    expect(hub.peerCount).toBe(3);

    const gotC1: Uint8Array[] = [];
    const gotC2: Uint8Array[] = [];
    const gotServer: Uint8Array[] = [];
    c1.onMessage((m) => gotC1.push(m));
    c2.onMessage((m) => gotC2.push(m));
    server.onMessage((m) => gotServer.push(m));

    const frame = new Uint8Array([1, 2, 3, 4]);
    server.send(frame); // server -> both clients, not itself
    hub.tick();

    expect(gotServer).toHaveLength(0);
    expect(gotC1).toHaveLength(1);
    expect(gotC2).toHaveLength(1);
    expect([...gotC1[0]]).toEqual([1, 2, 3, 4]);
    expect([...gotC2[0]]).toEqual([1, 2, 3, 4]);
  });

  it('delivers frames in FIFO order', () => {
    const hub = new LocalHub();
    const a = hub.attach();
    const b = hub.attach();
    const recv: number[] = [];
    b.onMessage((m) => recv.push(m[0]));
    for (let i = 0; i < 5; i++) a.send(new Uint8Array([i]));
    hub.tick();
    expect(recv).toEqual([0, 1, 2, 3, 4]);
  });

  it('close() detaches a peer so it receives no further frames', () => {
    const hub = new LocalHub();
    const a = hub.attach();
    const b = hub.attach();
    let count = 0;
    b.onMessage(() => count++);
    a.send(new Uint8Array([9]));
    hub.tick();
    expect(count).toBe(1);
    b.close();
    expect(hub.peerCount).toBe(1);
    a.send(new Uint8Array([9]));
    hub.tick();
    expect(count).toBe(1); // still 1, b got nothing after close
  });

  it('flushAsync delivers frames on the next microtask', async () => {
    const hub = new LocalHub();
    const a = hub.attach();
    const b = hub.attach();
    let delivered = 0;
    b.onMessage(() => delivered++);
    a.send(new Uint8Array([7]));
    const p = hub.flushAsync();
    expect(delivered).toBe(0); // not synchronous
    await p;
    expect(delivered).toBe(1);
  });

  it('is a real Transport (same shape as LoopbackTransport)', () => {
    const hub = new LocalHub();
    const t: LoopbackTransport = hub.attach() as unknown as LoopbackTransport;
    expect(typeof t.send).toBe('function');
    expect(typeof t.onMessage).toBe('function');
    expect(typeof t.close).toBe('function');
  });
});
