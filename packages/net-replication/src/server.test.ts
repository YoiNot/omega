import { describe, it, expect } from 'vitest';
import { World } from '@omega/ecs';
import { ReplicatedServer } from './server.js';
import {
  makeCodec,
  seedWorld,
  registerIntegration,
  intent,
  movementSystem,
  Position,
  Velocity,
} from './fixtures.js';

function makeServer(dt = 1): ReplicatedServer {
  const world = new World();
  seedWorld(world);
  registerIntegration(world);
  const codec = makeCodec();
  return new ReplicatedServer(world, codec, { dt, systems: [movementSystem] });
}

/** Decode a snapshot's data into a fresh world and return it. */
function decode(codec: ReturnType<typeof makeCodec>, snap: { data: Uint8Array }): World {
  const w = new World();
  codec.deserialize(snap.data, w);
  return w;
}

describe('ReplicatedServer', () => {
  it('starts at tick 0 and advances monotonically with each step', () => {
    const server = makeServer();
    expect(server.tick).toBe(0);
    server.advance();
    expect(server.tick).toBe(1);
    server.advance();
    expect(server.tick).toBe(2);
    const snap = server.advance();
    expect(snap.tick).toBe(3);
    expect(server.tick).toBe(3);
  });

  it('applies a command on the correct tick and reflects it in the snapshot', () => {
    const server = makeServer(1); // dt=1 simplifies integration math
    // Entity 0 starts at (0,0) v(0,0); impulse sets v -> (5,-2).
    server.onCommand({ tick: 0, seq: 0, payload: intent(0, 5, -2) });
    const s0 = server.advance(); // tick 1: integrates v into position
    expect(s0.tick).toBe(1);

    const w = decode(server.codec, s0);
    // One tick of v=(5,-2) at dt=1 => position (5,-2).
    expect(w.getComponent(0, Velocity)).toEqual({ x: 5, y: -2 });
    expect(w.getComponent(0, Position)).toEqual({ x: 5, y: -2 });
  });

  it('accumulates ticks across multiple commands into the snapshot', () => {
    const server = makeServer(1);
    server.onCommand({ tick: 0, seq: 0, payload: intent(1, 2, 0) }); // entity1 v += (2,0)
    const s1 = server.advance(); // entity1 pos (10,-4) + 2*1 = (12,-4)
    const w = decode(server.codec, s1);
    expect(w.getComponent(1, Velocity)).toEqual({ x: 3, y: 0 }); // 1 + 2
    expect(w.getComponent(1, Position)).toEqual({ x: 13, y: -4 }); // (10,-4) + 3*1
  });

  it('ignores a command whose tick is in the past (server only simulates tick === serverTick)', () => {
    const server = makeServer(1);
    // Server already at tick 0; a command for tick 5 will not be picked up.
    server.onCommand({ tick: 5, seq: 0, payload: intent(0, 9, 9) });
    const s0 = server.advance();
    const w = decode(server.codec, s0);
    // Entity 0 untouched: still (0,0) v(0,0).
    expect(w.getComponent(0, Position)).toEqual({ x: 0, y: 0 });
    expect(w.getComponent(0, Velocity)).toEqual({ x: 0, y: 0 });
  });
});
