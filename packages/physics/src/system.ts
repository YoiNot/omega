/**
 * @omega/physics — ECS adapter.
 *
 * PhysicsSystem wraps a PhysicsWorld and registers a World system so physics is
 * stepped inside the normal ECS update (SystemStage.Update). Rigid bodies live
 * in the ComponentStore named 'PhysicsBody' (kind RigidBody); the component
 * instance is used directly as the simulation body, so after each step the
 * entity's stored component already carries the updated position/velocity.
 */

import { World, SystemStage } from '@omega/engine-core';
import type { RigidBody } from './body.js';
import { PhysicsWorld, type PhysicsWorldOptions } from './world.js';

export const PHYSICS_BODY_STORE = 'PhysicsBody';

export interface PhysicsSystemOptions extends PhysicsWorldOptions {}

export class PhysicsSystem {
  readonly world: World;
  readonly physics: PhysicsWorld;
  private registered = false;
  private readonly knownIds = new Set<number>();

  constructor(world: World, opts: PhysicsSystemOptions = {}) {
    this.world = world;
    this.physics = new PhysicsWorld(opts);
  }

  /** Register the per-tick system on the world. Idempotent. */
  register(): this {
    if (this.registered) return this;
    this.world.registerSystem(
      SystemStage.Update,
      0,
      'PhysicsSystem',
      (world, dt) => this.tick(world, dt),
    );
    this.registered = true;
    return this;
  }

  /** One simulation tick: sync ECS bodies into the world, step, write back. */
  private tick(world: World, dt: number): void {
    const store = world.store<RigidBody>(PHYSICS_BODY_STORE);

    // Discover newly-spawned physics bodies and keep their ids in sync.
    store.forEach((id, body) => {
      if (body.id !== id) body.id = id; // pin component id to entity id
      if (!this.knownIds.has(id)) {
        this.physics.addBody(body);
        this.knownIds.add(id);
      }
    });

    // Drop bodies that were removed from the ECS.
    for (const id of [...this.knownIds]) {
      if (!store.has(id)) {
        this.physics.removeBody(id);
        this.knownIds.delete(id);
      }
    }

    this.physics.step(dt);
    // Bodies mutate in place, so the ECS components already reflect new state.
  }
}
