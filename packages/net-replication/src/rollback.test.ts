import { describe, it, expect } from 'vitest';
import { World } from '@omega/ecs';
import { rollback, hasDiverged, RollbackStage } from './rollback.js';
import {
  makeCodec,
  seedWorld,
  Position,
  Velocity,
} from './fixtures.js';
import { Codec } from '@omega/net-replication';

const makeNetCodec = (): Codec => makeCodec();

/** Mutate entity 0's position directly (deterministic, no system needed). */
function move(world: World, id: number, x: number, y: number): void {
  world.setComponent(id, Position, { x, y });
}

describe('rollback', () => {
  it('resets a divergent client world to the authoritative snapshot', () => {
    const codec = makeNetCodec();
    const server = new World();
    seedWorld(server);
    move(server, 0, 5, 5); // server authoritative change
    const serverSnap = { tick: 1, data: codec.serialize(server) };

    // Client predicted something wrong.
    const client = new World();
    seedWorld(client);
    move(client, 0, 999, -999); // wrong prediction
    const clientSnap = { tick: 1, data: codec.serialize(client) };

    expect(hasDiverged(clientSnap, serverSnap)).toBe(true);

    rollback(client, serverSnap, codec);

    const clientAfter = { tick: 1, data: codec.serialize(client) };
    expect(clientAfter.data).toEqual(serverSnap.data);
  });

  it('rollback is deterministic regardless of prior client state', () => {
    const codec = makeNetCodec();
    const server = new World();
    seedWorld(server);
    move(server, 1, 7, 7);
    const serverSnap = { tick: 2, data: codec.serialize(server) };

    const a = new World();
    a.addComponent(a.createEntity(), Position, { x: 1, y: 1 });
    const b = new World();
    b.addComponent(b.createEntity(), Position, { x: -50, y: 200 });
    b.addComponent(b.createEntity(), Velocity, { x: 3, y: 3 });

    rollback(a, serverSnap, codec);
    rollback(b, serverSnap, codec);
    expect(codec.serialize(a)).toEqual(codec.serialize(b));
    expect(codec.serialize(a)).toEqual(serverSnap.data);
  });

  it('hasDiverged is false for identical snapshots', () => {
    const codec = makeNetCodec();
    const w = new World();
    seedWorld(w);
    const s = { tick: 0, data: codec.serialize(w) };
    const w2 = new World();
    codec.deserialize(s.data, w2);
    const s2 = { tick: 0, data: codec.serialize(w2) };
    expect(hasDiverged(s, s2)).toBe(false);
  });
});

describe('RollbackStage', () => {
  it('reconciles only when the client has diverged', () => {
    const codec = makeNetCodec();
    const server = new World();
    seedWorld(server);
    const serverSnap = { tick: 0, data: codec.serialize(server) };

    const stage = new RollbackStage();
    const clientWorld = new World();
    seedWorld(clientWorld);

    const clientSnapOk = { tick: 0, data: codec.serialize(clientWorld) };
    expect(stage.reconcile(clientWorld, clientSnapOk, serverSnap, codec)).toBe(false);

    // Diverge the client, advance server, feed new authoritative snapshot.
    move(clientWorld, 0, 42, 42);
    move(server, 0, 8, 8);
    const serverSnap2 = { tick: 1, data: codec.serialize(server) };
    const clientSnapBad = { tick: 1, data: codec.serialize(clientWorld) };
    expect(stage.reconcile(clientWorld, clientSnapBad, serverSnap2, codec)).toBe(true);
    expect(codec.serialize(clientWorld)).toEqual(serverSnap2.data);
  });

  it('records the last authoritative snapshot', () => {
    const codec = makeNetCodec();
    const server = new World();
    seedWorld(server);
    const stage = new RollbackStage();
    const client = new World();
    seedWorld(client);
    const snap0 = { tick: 0, data: codec.serialize(server) };
    stage.reconcile(client, { tick: 0, data: codec.serialize(client) }, snap0, codec);
    expect(stage.authoritative).toEqual(snap0);
  });
});
