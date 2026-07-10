import { describe, it, expect } from 'vitest';
import { World } from '@omega/ecs';
import { ReplicatedServer, type ServerSystem } from './server.js';
import { ReplicatedClient } from './client.js';
import {
  makeCodec,
  seedWorld,
  registerIntegration,
  intent,
  movementSystem,
  Position,
  Velocity,
} from './fixtures.js';

interface Pair {
  server: ReplicatedServer;
  client: ReplicatedClient;
}

/** Mirror a server + client sharing identical codec + systems / dt. */
function makePair(dt = 1): Pair {
  const codec = makeCodec();
  const systems: ServerSystem[] = [movementSystem];
  const server = new ReplicatedServer(new World(), codec, { dt, systems });
  const client = new ReplicatedClient(new World(), codec, { dt, systems });
  // The client world must run the SAME integration system as the server world;
  // snapshotToWorld only rebuilds entities, so register it once up front.
  registerIntegration(client.world);
  // Seed BOTH worlds before the client snapshots the server's initial state, so
  // the client starts from the same authoritative base as the server.
  seedWorld(server.world);
  registerIntegration(server.world);
  client.onSnapshot(server.snapshot());
  return { server, client };
}

function decode(codec: ReturnType<typeof makeCodec>, snap: { data: Uint8Array }): World {
  const w = new World();
  codec.deserialize(snap.data, w);
  return w;
}

describe('ReplicatedClient — prediction & reconciliation', () => {
  it('predicts locally on sendIntent', () => {
    const { client } = makePair(1);
    // Entity 0 is at (0,0); impulse -> v(4,0). Prediction after one tick: (4,0).
    const cmd = client.sendIntent(intent(0, 4, 0));
    expect(cmd.tick).toBe(0);
    const w = decode(client.codec, client.state());
    expect(w.getComponent(0, Velocity)).toEqual({ x: 4, y: 0 });
    expect(w.getComponent(0, Position)).toEqual({ x: 4, y: 0 });
  });

  it('reconciles to the authoritative state when a snapshot arrives', () => {
    const { server, client } = makePair(1);
    // Server: entity 0 gets impulse v(4,0) on tick 0.
    server.onCommand({ tick: 0, seq: 0, payload: intent(0, 4, 0) });
    const snap0 = server.advance(); // server authoritative: (4,0)

    // Client independently predicted the same.
    client.sendIntent(intent(0, 4, 0));
    client.onSnapshot(snap0); // reconcile

    // Authoritative and predicted must match exactly.
    const auth = decode(client.codec, client.authoritative());
    const pred = decode(client.codec, client.state());
    expect(pred.getComponent(0, Position)).toEqual({ x: 4, y: 0 });
    expect(pred.getComponent(0, Position)).toEqual(auth.getComponent(0, Position));
    expect(client.pendingCommands()).toHaveLength(0);
  });

  it('replays in-flight commands so prediction converges to the server view', () => {
    const { server, client } = makePair(1);
    // Tick 0: both apply impulse (3,0) -> entity0 (3,0).
    server.onCommand({ tick: 0, seq: 0, payload: intent(0, 3, 0) });
    const snap0 = server.advance();
    client.sendIntent(intent(0, 3, 0));
    client.onSnapshot(snap0);

    // Client predicts tick 1 locally with a NEW impulse (0,2), before the
    // server has simulated it. It must diverge from the server momentarily.
    const cmd1 = client.sendIntent(intent(0, 0, 2)); // predicted: (6,2) after integration
    expect(client.state().tick).toBe(2);
    const predEarly = decode(client.codec, client.state());
    expect(predEarly.getComponent(0, Position)).toEqual({ x: 6, y: 2 });

    // Server simulates cmd1 on tick 1.
    server.onCommand(cmd1);
    const snap1 = server.advance(); // server: (6,2)
    expect(snap1.tick).toBe(2);

    client.onSnapshot(snap1);
    const pred = decode(client.codec, client.state());
    const auth = decode(client.codec, client.authoritative());
    expect(pred.getComponent(0, Position)).toEqual({ x: 6, y: 2 });
    expect(pred.getComponent(0, Position)).toEqual(auth.getComponent(0, Position));
  });

  it('two clients with the same input script + same snapshots converge identically', () => {
    const build = () => {
      const codec = makeCodec();
      const systems: ServerSystem[] = [movementSystem];
      const server = new ReplicatedServer(new World(), codec, { dt: 1, systems });
      const client = new ReplicatedClient(new World(), codec, { dt: 1, systems });
      seedWorld(server.world);
      registerIntegration(server.world);
      registerIntegration(client.world);
      client.onSnapshot(server.snapshot());

      const script = [
        intent(0, 1, 0),
        intent(1, 0, 2),
        intent(0, -1, 0),
        intent(1, 0, -2),
      ];
      for (const p of script) {
        const cmd = client.sendIntent(p);
        server.onCommand(cmd);
      }
      for (let i = 0; i < script.length; i++) client.onSnapshot(server.advance());
      return decode(client.codec, client.state());
    };
    const a = build();
    const b = build();
    expect(a.getComponent(0, Position)).toEqual(b.getComponent(0, Position));
    expect(a.getComponent(1, Position)).toEqual(b.getComponent(1, Position));
  });
});
