/**
 * Deterministic fixture shared by @omega/net-delta tests: a tiny ECS world with
 * numeric Position + Velocity components registered for replication, mirroring
 * net-replication's fixtures but self-contained so the delta package has no
 * test-only dependency on net-replication's test files.
 */

import { defineComponent, World } from '@omega/ecs';
import { Codec } from '@omega/net-replication';

export const Position = defineComponent<{ x: number; y: number }>('position');
export const Velocity = defineComponent<{ x: number; y: number }>('velocity');

export function makeCodec(): Codec {
  const c = new Codec();
  c.registerComponent(Position, 'position');
  c.registerComponent(Velocity, 'velocity');
  return c;
}

/** Two entities at deterministic ids 0 and 1. */
export function seed(world: World): void {
  const a = world.createEntity();
  world.addComponent(a, Position, { x: 0, y: 0 });
  world.addComponent(a, Velocity, { x: 1, y: 0 });
  const b = world.createEntity();
  world.addComponent(b, Position, { x: 10, y: -4 });
  world.addComponent(b, Velocity, { x: 0, y: 2 });
}

/** Advance velocities into positions by one step (deterministic). */
export function step(world: World): void {
  for (const id of world.entities()) {
    const p = world.getComponent(id, Position);
    const v = world.getComponent(id, Velocity);
    if (p && v) world.setComponent(id, Position, { x: p.x + v.x, y: p.y + v.y });
  }
}
