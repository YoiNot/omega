/**
 * End-to-end determinism over the LocalHub in-memory transport.
 *
 * A server-authoritative world is driven for N ticks. Two clients predict
 * locally, ship commands to the server over the hub, and reconcile against the
 * authoritative snapshots the server broadcasts back over the hub. After the
 * run, both clients' authoritative worlds equal the server's world exactly, and
 * the two clients agree with each other.
 *
 * The hub is a real fan-out transport: every peer's `send` reaches all OTHER
 * peers. To keep command frames (client->server) and snapshot frames
 * (server->client) apart, both are wrapped in a tiny typed envelope
 * (u8 kind | ...). This is the same framing a real wire protocol would use.
 */

import { describe, it, expect } from 'vitest';
import { World } from '@omega/ecs';
import { LocalHub } from '@omega/net';
import { ReplicatedServer, type ServerSystem } from './server.js';
import { ReplicatedClient } from './client.js';
import { makeCodec, seedWorld, registerIntegration, intent, movementSystem, Position } from './fixtures.js';
import { Codec } from '@omega/net-replication';

const makeNetCodec = (): Codec => makeCodec();

const KIND_CMD = 0;
const KIND_SNAP = 1;

function encodeMsg(kind: number, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(1 + body.length);
  out[0] = kind;
  out.set(body, 1);
  return out;
}
function decodeMsg(f: Uint8Array): { kind: number; body: Uint8Array } {
  return { kind: f[0], body: f.slice(1) };
}

// command envelope: u32 tick | u32 seq | u32 payloadLen | payload
function encodeCmd(cmd: { tick: number; seq: number; payload: Uint8Array }): Uint8Array {
  const out = new Uint8Array(12 + cmd.payload.length);
  const v = new DataView(out.buffer);
  v.setUint32(0, cmd.tick >>> 0, true);
  v.setUint32(4, cmd.seq >>> 0, true);
  v.setUint32(8, cmd.payload.length, true);
  out.set(cmd.payload, 12);
  return out;
}
function decodeCmd(f: Uint8Array): { tick: number; seq: number; payload: Uint8Array } {
  const v = new DataView(f.buffer, f.byteOffset, f.byteLength);
  return { tick: v.getUint32(0, true), seq: v.getUint32(4, true), payload: f.slice(12) };
}

// snapshot envelope: u32 tick | u32 len | data
function encodeSnap(s: { tick: number; data: Uint8Array }): Uint8Array {
  const out = new Uint8Array(8 + s.data.length);
  const v = new DataView(out.buffer);
  v.setUint32(0, s.tick >>> 0, true);
  v.setUint32(4, s.data.length, true);
  out.set(s.data, 8);
  return out;
}
function decodeSnap(f: Uint8Array): { tick: number; data: Uint8Array } {
  const v = new DataView(f.buffer, f.byteOffset, f.byteLength);
  const len = v.getUint32(4, true);
  return { tick: v.getUint32(0, true), data: f.slice(8, 8 + len) };
}

describe('end-to-end: two clients converge over LocalHub', () => {
  it('both clients authoritative worlds equal the server world', () => {
    const dt = 1;
    const N = 20;
    const codec = makeNetCodec();
    const systems: ServerSystem[] = [movementSystem];

    const server = new ReplicatedServer(new World(), codec, { dt, systems });
    const c0 = new ReplicatedClient(new World(), codec, { dt, systems });
    const c1 = new ReplicatedClient(new World(), codec, { dt, systems });
    seedWorld(server.world);
    registerIntegration(server.world);
    registerIntegration(c0.world);
    registerIntegration(c1.world);

    const hub = new LocalHub();
    const serverT = hub.attach();
    const c0T = hub.attach();
    const c1T = hub.attach();

    // Clients receive server snapshots; server receives client commands.
    c0T.onMessage((frame) => {
      const { kind, body } = decodeMsg(frame);
      if (kind === KIND_SNAP) c0.onSnapshot(decodeSnap(body));
    });
    c1T.onMessage((frame) => {
      const { kind, body } = decodeMsg(frame);
      if (kind === KIND_SNAP) c1.onSnapshot(decodeSnap(body));
    });
    serverT.onMessage((frame) => {
      const { kind, body } = decodeMsg(frame);
      if (kind === KIND_CMD) server.onCommand(decodeCmd(body));
    });

    // Seed both clients from the server's initial state.
    const init = server.snapshot();
    c0.onSnapshot(init);
    c1.onSnapshot(init);

    // Deterministic input scripts for the two clients (no Math.random).
    const script0: Uint8Array[] = [];
    const script1: Uint8Array[] = [];
    for (let i = 0; i < N; i++) {
      script0.push(intent(0, i % 2 === 0 ? 1 : -1, 1));
      script1.push(intent(1, 1, i % 3 === 0 ? -1 : 1));
    }

    for (let i = 0; i < N; i++) {
      const cmd0 = c0.sendIntent(script0[i]);
      const cmd1 = c1.sendIntent(script1[i]);
      // Clients ship commands to the server.
      serverT.send(encodeMsg(KIND_CMD, encodeCmd(cmd0)));
      serverT.send(encodeMsg(KIND_CMD, encodeCmd(cmd1)));
      hub.tick(); // deliver commands to server

      const snap = server.advance();
      // Server broadcasts the authoritative snapshot to both clients.
      c0T.send(encodeMsg(KIND_SNAP, encodeSnap(snap)));
      c1T.send(encodeMsg(KIND_SNAP, encodeSnap(snap)));
      hub.tick(); // deliver snapshots to clients
    }

    // After reconciliation, both clients' authoritative worlds must equal the
    // server's latest authoritative world.
    const serverWorld = new World();
    codec.deserialize(server.snapshot().data, serverWorld);

    const c0Auth = new World();
    codec.deserialize(c0.authoritative().data, c0Auth);
    const c1Auth = new World();
    codec.deserialize(c1.authoritative().data, c1Auth);

    expect(c0Auth.getComponent(0, Position)).toEqual(serverWorld.getComponent(0, Position));
    expect(c0Auth.getComponent(1, Position)).toEqual(serverWorld.getComponent(1, Position));
    expect(c1Auth.getComponent(0, Position)).toEqual(serverWorld.getComponent(0, Position));
    expect(c1Auth.getComponent(1, Position)).toEqual(serverWorld.getComponent(1, Position));

    // And the two clients agree with each other.
    expect(c0.authoritative().data).toEqual(c1.authoritative().data);
  });
});
