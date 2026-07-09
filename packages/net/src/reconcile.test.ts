import { describe, it, expect } from 'vitest';
import { ServerAuthoritativeSim, StepFn, SeedFn } from './reconcile.js';
import { makeSnapshot, WorldSnapshot, asFloat32 } from './snapshot.js';

/**
 * A tiny deterministic world: a single particle with 2D position.
 * Command payload = Float32[vx, vy]; each tick adds v*dt to the position.
 * The step function owns its position in a closure; `seed` resets it so the
 * client can replay unacked commands from any authoritative base.
 */
function makeWorld() {
  let pos = new Float32Array([0, 0]);
  let tick = 0;
  const step: StepFn = (cmd, d) => {
    tick += 1;
    if (cmd) {
      const v = new Float32Array(cmd.payload.buffer, cmd.payload.byteOffset, 2);
      pos[0] += v[0] * d;
      pos[1] += v[1] * d;
    }
    return makeSnapshot(tick, pos.slice());
  };
  const seed: SeedFn = (base: WorldSnapshot) => {
    pos = asFloat32(base).slice();
  };
  return { step, seed };
}

function payload(x: number, y: number): Uint8Array {
  return new Uint8Array(new Float32Array([x, y]).buffer.slice(0));
}

describe('ServerAuthoritativeSim — server role', () => {
  it('applies authoritative ticks and advances the tick counter', () => {
    const { step } = makeWorld();
    const server = new ServerAuthoritativeSim(step, makeSnapshot(0, [0, 0]));
    expect(server.currentTick).toBe(0);
    server.step();
    server.step();
    expect(server.currentTick).toBe(2);
    expect([...asFloat32(server.getAuthoritative())]).toEqual([0, 0]);
  });

  it('applies a received command on the next tick', () => {
    const { step } = makeWorld();
    const server = new ServerAuthoritativeSim(step, makeSnapshot(0, [0, 0]), { dt: 1 });
    server.receiveCommand({ tick: 0, seq: 0, payload: payload(2, -1) });
    server.step(); // tick 1: applies the command
    expect([...asFloat32(server.getAuthoritative())]).toEqual([2, -1]);
    server.step(); // tick 2: no command -> stays
    expect([...asFloat32(server.getAuthoritative())]).toEqual([2, -1]);
  });
});

describe('ServerAuthoritativeSim — client prediction & reconciliation', () => {
  it('predicts locally on queueCommand', () => {
    const { step, seed } = makeWorld();
    const client = new ServerAuthoritativeSim(step, makeSnapshot(0, [0, 0]), { seed, dt: 1 });
    client.queueCommand(payload(3, 4));
    expect([...asFloat32(client.getState())]).toEqual([3, 4]);
  });

  it('fully reconciles to the authoritative state when all commands are acked', () => {
    const s = makeWorld();
    const c = makeWorld();
    const server = new ServerAuthoritativeSim(s.step, makeSnapshot(0, [0, 0]), { dt: 1 });
    const client = new ServerAuthoritativeSim(c.step, makeSnapshot(0, [0, 0]), { seed: c.seed, dt: 1 });

    const moves = [payload(1, 0), payload(0, 2), payload(-1, 0)];
    for (let i = 0; i < moves.length; i++) {
      const cmd = client.queueCommand(moves[i]);
      server.receiveCommand(cmd);
      const snap = server.step();
      client.applySnapshot(snap);
      client.ack(cmd.seq);
    }
    // Once every command is acknowledged, predicted must equal authoritative exactly.
    expect([...asFloat32(client.getState())]).toEqual([...asFloat32(server.getAuthoritative())]);
    expect([...asFloat32(client.getState())]).toEqual([0, 2]);
    expect(client.pendingCommands()).toHaveLength(0);
  });

  it('replays unacked commands over the latest authoritative snapshot', () => {
    const s = makeWorld();
    const c = makeWorld();
    const server = new ServerAuthoritativeSim(s.step, makeSnapshot(0, [0, 0]), { dt: 1 });
    const client = new ServerAuthoritativeSim(c.step, makeSnapshot(0, [0, 0]), { seed: c.seed, dt: 1 });

    const c0 = client.queueCommand(payload(5, 0)); // tick 0, predicted (5,0)
    server.receiveCommand(c0);
    const snap0 = server.step(); // server simulates c0 on tick 0 -> (5,0)
    client.applySnapshot(snap0); // server simulated tick 0 => c0 no longer in flight
    client.ack(0); // c0 acked

    const c1 = client.queueCommand(payload(0, 7)); // tick 1, predicted (5,7), c1 unacked
    // server has NOT yet received c1; client already predicts it locally
    expect([...asFloat32(client.getState())]).toEqual([5, 7]);
    expect(client.pendingCommands().map((x) => x.seq)).toEqual([1]);

    // Server catches up: receives c1 (its tick 1) and applies it on tick 1.
    server.receiveCommand(c1);
    const snap1 = server.step(); // (5,7) on tick 1
    client.applySnapshot(snap1); // c1.tick(1) >= snap1.tick(1)? no -> dropped -> (5,7)
    client.ack(1);
    expect([...asFloat32(client.getState())]).toEqual([...asFloat32(server.getAuthoritative())]);
  });

  it('converges with identical inputs across two independent clients', () => {
    const mk = () => {
      const s = makeWorld();
      const c = makeWorld();
      const server = new ServerAuthoritativeSim(s.step, makeSnapshot(0, [0, 0]));
      const client = new ServerAuthoritativeSim(c.step, makeSnapshot(0, [0, 0]), { seed: c.seed, dt: 0.25 });
      const plan = [payload(1, 1), payload(1, -1), payload(-2, 0)];
      for (const p of plan) {
        const cmd = client.queueCommand(p); // tick advances 0,1,2
        server.receiveCommand(cmd);
      }
      for (let i = 0; i < plan.length; i++) {
        const snap = server.step(); // server applies commands on ticks 0,1,2
        client.applySnapshot(snap);
      }
      client.ack(2); // ack all
      return client.getState();
    };
    const a = mk();
    const b = mk();
    expect([...asFloat32(a)]).toEqual([...asFloat32(b)]); // identical given identical inputs
    // Net displacement is zero; compare approximately (float32 accumulation).
    const f = asFloat32(a);
    expect(Math.abs(f[0])).toBeLessThan(1e-6);
    expect(Math.abs(f[1])).toBeLessThan(1e-6);
  });

  it('buffers authoritative snapshots for interpolation', () => {
    const s = makeWorld();
    const server = new ServerAuthoritativeSim(s.step, makeSnapshot(0, [0, 0]));
    for (let i = 0; i < 3; i++) server.step();
    const c = makeWorld();
    const client = new ServerAuthoritativeSim(c.step, makeSnapshot(0, [0, 0]), { seed: c.seed });
    client.applySnapshot(server.getAuthoritative());
    expect(client.buffer.size).toBe(1);
    expect(client.buffer.latest()!.tick).toBe(server.getAuthoritative().tick);
  });
});
