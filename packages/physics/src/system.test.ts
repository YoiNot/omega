import { describe, it, expect } from 'vitest';
import { Vec3 } from '@omega/engine-math';
import { World, SystemStage } from '@omega/engine-core';
import { createBody, type RigidBody } from './body.js';
import { PhysicsSystem, PHYSICS_BODY_STORE } from './system.js';

describe('PhysicsSystem — ECS integration', () => {
  it('steps physics for entities carrying a PhysicsBody component', () => {
    const world = new World();
    const sys = new PhysicsSystem(world, {
      gravity: new Vec3(0, -9.81, 0),
      groundY: 0,
    });
    sys.register();

    // Spawn three falling spheres with a ground plane below them.
    const ids: number[] = [];
    for (let i = 0; i < 3; i++) {
      const id = world.spawn<RigidBody>(PHYSICS_BODY_STORE, () =>
        createBody(i, new Vec3(i * 2 - 2, 5 + i, 0), { radius: 0.5, restitution: 0.5 }),
      );
      ids.push(id);
    }

    // Advance the world N steps via the Update stage.
    const dt = 1 / 60;
    const steps = 600;
    let everOnGround = false;
    let minY = Infinity;
    for (let i = 0; i < steps; i++) {
      world.runStage(SystemStage.Update, dt);
      for (const id of ids) {
        const body = world.getComponent<RigidBody>(PHYSICS_BODY_STORE, id)!;
        if (body.onGround) everOnGround = true;
        minY = Math.min(minY, body.position.y);
      }
    }

    // Each body fell from its start height toward the ground.
    for (let i = 0; i < 3; i++) {
      const body = world.getComponent<RigidBody>(PHYSICS_BODY_STORE, ids[i])!;
      expect(body.position.y).toBeLessThan(5 + i); // fell
      expect(body.position.y).toBeGreaterThanOrEqual(0.5 - 1e-6); // never below ground
      expect(body.onGround).toBe(true); // came to rest on ground
    }
    expect(everOnGround).toBe(true);
  });

  it('stops simulating when a body component is removed', () => {
    const world = new World();
    const sys = new PhysicsSystem(world, { groundY: -Infinity });
    sys.register();
    const id = world.spawn<RigidBody>(PHYSICS_BODY_STORE, () =>
      createBody(0, new Vec3(0, 5, 0)),
    );
    world.runStage(SystemStage.Update, 1 / 60);
    const before = world.getComponent<RigidBody>(PHYSICS_BODY_STORE, id)!.position.y;

    world.removeComponent(PHYSICS_BODY_STORE, id);
    world.runStage(SystemStage.Update, 1 / 60);

    // Body no longer tracked: its component is gone. World has no bodies.
    expect(world.getComponent(PHYSICS_BODY_STORE, id)).toBeUndefined();
    // Sanity: before it had fallen at least a little.
    expect(before).toBeLessThan(5);
  });

  it('register() is idempotent', () => {
    const world = new World();
    const sys = new PhysicsSystem(world);
    sys.register().register();
    expect(world.systemCount()).toBe(1);
  });
});
