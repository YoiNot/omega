import { describe, it, expect } from 'vitest';
import { World } from '@omega/ecs';
import { LoopbackTransport } from '@omega/net';
import { ReplicatedServer, type ServerSystem } from './server.js';
import { ReplicatedClient } from './client.js';
import {
  makeCodec,
  seedWorld,
  registerIntegration,
  intent,
  movementSystem,
  Position,
} from './fixtures.js';

/**
 * A scripted loopback harness proving the determinism contract:
 * after N ticks of client-prediction / server-authority / reconcile over an
 * in-process transport, the client's world equals the server's world exactly.
 */
describe('convergence over LoopbackTransport', () => {
  it('client authoritative world equals server world after N ticks', () => {
    const dt = 1;
    const N = 20;
    const codec = makeCodec();
    const systems: ServerSystem[] = [movementSystem];

    const server = new ReplicatedServer(new World(), codec, { dt, systems });
    const client = new ReplicatedClient(new World(), codec, { dt, systems });
    seedWorld(server.world);
    registerIntegration(server.world);

    const transport = new LoopbackTransport();
    // The client applies every delivered frame in order; register the handler
    // BEFORE any tick() so frames are not dropped.
    transport.onMessage((frame) => {
      const { tick, data } = decodeFrame(frame);
      client.onSnapshot({ tick, data });
    });

    // Seed the client from the server's initial state.
    client.onSnapshot(server.snapshot());

    // A deterministic input script (no Math.random).
    const script: Uint8Array[] = [];
    for (let i = 0; i < N; i++) {
      const entity = i % 2; // alternate impulses on entity 0 and 1
      const vx = entity === 0 ? 1 : -1;
      const vy = i % 3 === 0 ? 1 : -1;
      script.push(intent(entity, vx, vy));
    }

    // Drive N ticks: client predicts, server simulates, snapshot reconciles.
    for (let i = 0; i < N; i++) {
      const cmd = client.sendIntent(script[i]);
      server.onCommand(cmd);
      const snap = server.advance();
      transport.send(encodeFrame(snap.tick, snap.data));
    }
    transport.tick(); // deliver every queued frame to the client

    // After reconciliation, the client's authoritative world must equal the
    // server's latest authoritative world.
    const serverWorld = new World();
    codec.deserialize(server.snapshot().data, serverWorld);

    const clientAuth = new World();
    codec.deserialize(client.authoritative().data, clientAuth);

    expect(clientAuth.getComponent(0, Position)).toEqual(serverWorld.getComponent(0, Position));
    expect(clientAuth.getComponent(1, Position)).toEqual(serverWorld.getComponent(1, Position));
    expect(client.buffer.size).toBeGreaterThan(0);
  });
});

/** Minimal frame wrapper for transport demo (tick u32 | len u32 | data). */
function encodeFrame(tick: number, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(8 + data.length);
  const v = new DataView(out.buffer);
  v.setUint32(0, tick >>> 0, true);
  v.setUint32(4, data.length, true);
  out.set(data, 8);
  return out;
}
function decodeFrame(f: Uint8Array): { tick: number; data: Uint8Array } {
  const v = new DataView(f.buffer, f.byteOffset, f.byteLength);
  const tick = v.getUint32(0, true);
  const len = v.getUint32(4, true);
  return { tick, data: f.slice(8, 8 + len) };
}
