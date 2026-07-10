/**
 * @omega/physics-integration — entity factory.
 *
 * `createPhysicsEntity` deterministically spawns an entity, builds its `RigidBody`
 * (pinned to the entity id so PhysicsSystem's id-sync is a no-op), and binds it to the
 * ECS under the `PhysicsBody` store name. No clock, no RNG in core logic — callers
 * supply the initial `position`; any randomized placement must come from a seeded
 * `Rng` passed in by the caller.
 */

import { World, type EntityId } from '@omega/engine-core';
import { Vec3 } from '@omega/engine-math';
import {
  createBody,
  type RigidBody,
  type RigidBodyOptions,
} from '@omega/physics';
import { PhysicsBody } from './components.js';

/** Initial placement + pass-through body options for a physics entity. */
export interface PhysicsEntityOptions extends RigidBodyOptions {
  /** Initial world-space position of the body's center. */
  position: Vec3;
}

/**
 * Create a physics entity and bind its `RigidBody` to the ECS.
 * Returns the new entity id (which equals the body's `id`).
 */
export function createPhysicsEntity(
  world: World,
  opts: PhysicsEntityOptions,
): EntityId {
  const id = world.createEntity();
  const { position, ...bodyOpts } = opts;
  const body: RigidBody = createBody(id, position, bodyOpts);
  // Bind under the PhysicsBody store name PhysicsSystem reads each tick.
  world.addComponent(PhysicsBody.name, id, body);
  return id;
}
