/**
 * Shared fixtures for @omega/net-replication tests.
 *
 * A tiny but realistic replicated world: each entity has a numeric `Position`
 * and a numeric `Velocity`. A movement system integrates velocity into position
 * per tick, driven by a command payload encoding a velocity impulse on the
 * command's target entity. The same codec + systems are reused by the server and
 * the client (mirrored), satisfying the requirement that the client's step
 * function mirror the server's for bit-for-bit reconciliation.
 */

import { defineComponent, World } from '@omega/ecs';
import { Codec } from './codec.js';
import type { ServerSystem } from './server.js';
import type { InputCommand } from '@omega/net';

/** A replicated component: 2D position. */
export const Position = defineComponent<{ x: number; y: number }>('position');
/** A replicated component: 2D velocity. */
export const Velocity = defineComponent<{ x: number; y: number }>('velocity');
/** A local-only (non-replicated) component — must NOT cross the wire. */
export const RenderHint = defineComponent<{ color: string }>('render-hint');

/** Build a codec with Position + Velocity registered (RenderHint is local). */
export function makeCodec(): Codec {
  const codec = new Codec();
  codec.registerComponent(Position, 'position');
  codec.registerComponent(Velocity, 'velocity');
  return codec;
}

/** Encode a movement intent for `entity` as a flat f32 buffer [entity, vx, vy]. */
export function intent(entity: number, vx: number, vy: number): Uint8Array {
  const f = new Float32Array([entity, vx, vy]);
  return new Uint8Array(f.buffer.slice(0));
}

/**
 * Read a movement intent back out of a command payload.
 * Returns { entity, vx, vy } or null if the payload is malformed.
 */
export function readIntent(cmd: InputCommand | null): { entity: number; vx: number; vy: number } | null {
  if (!cmd) return null;
  if (cmd.payload.byteLength < 12) return null;
  const f = new Float32Array(cmd.payload.buffer, cmd.payload.byteOffset, 3);
  return { entity: f[0], vx: f[1], vy: f[2] };
}

/**
 * The movement system: applies the command's velocity impulse to the target
 * entity's current Velocity, then the world's `tick` integrates. This is the
 * command-application system (runs when a command is present).
 */
export const movementSystem: ServerSystem = (world, cmd) => {
  const intent = readIntent(cmd);
  if (!intent) return;
  const id = intent.entity;
  if (!world.isAlive(id)) return;
  const cur = world.getComponent(id, Velocity) ?? { x: 0, y: 0 };
  world.setComponent(id, Velocity, { x: cur.x + intent.vx, y: cur.y + intent.vy });
};

/**
 * The integration system: each world.tick, velocity is added to position.
 * Registered as a normal ECS system on the world so both server and client run
 * it identically during `world.tick()`.
 */
export function registerIntegration(world: World): void {
  world.registerSystem((w, dt) => {
    for (const id of w.entities()) {
      const v = w.getComponent(id, Velocity);
      const p = w.getComponent(id, Position);
      if (v && p) {
        w.setComponent(id, Position, { x: p.x + v.x * dt, y: p.y + v.y * dt });
      }
    }
  }, 0, 'integrate');
}

/** Populate `world` with two replicated entities (deterministic ids 0 and 1). */
export function seedWorld(world: World): void {
  const a = world.createEntity();
  world.addComponent(a, Position, { x: 0, y: 0 });
  world.addComponent(a, Velocity, { x: 0, y: 0 });
  world.addComponent(a, RenderHint, { color: 'red' }); // local-only
  const b = world.createEntity();
  world.addComponent(b, Position, { x: 10, y: -4 });
  world.addComponent(b, Velocity, { x: 1, y: 0 });
  world.addComponent(b, RenderHint, { color: 'blue' }); // local-only
}
