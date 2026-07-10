/**
 * @omega/physics-integration — replay.
 *
 * Replays a recorded input sequence through a fresh `Simulation` whose world has the
 * `PhysicsSystem` (and the mirror) registered, plus the same initial entities as the
 * live run, so the deterministic pipeline reproduces the exact final state. Convergence
 * is guaranteed because the pipeline is a pure function of (initial state, input
 * sequence, fixedDt) — the same records replayed through the same setup rebuild the
 * identical trajectory.
 */

import {
  World,
  SystemStage,
} from '@omega/engine-core';
import { PhysicsSystem, type RigidBody, type PhysicsSystemOptions } from '@omega/physics';
import { Simulation, type SimTickRecord, type SimulationOptions } from '@omega/sim';
import { PhysicsBody } from './components.js';

export interface PhysicsReplayOptions {
  /** Forwarded to the replayed `Simulation` (fixedDt must match the live run). */
  sim?: SimulationOptions;
  /** Forwarded to the replayed `PhysicsSystem`. */
  physics?: PhysicsSystemOptions;
  /**
   * Seeds the replayed world with the same initial entities as the live run.
   * Required: records only carry ticks, not the initial state. The callback runs
   * AFTER the physics pipeline is registered, so bodies step on the first tick.
   */
  seed: (world: World) => void;
}

/** Register the physics pipeline onto a world (used by `Simulation.replay`). */
function buildPhysicsWorld(world: World, opts: PhysicsReplayOptions): void {
  const physics = new PhysicsSystem(world, opts.physics);
  physics.register();
  world.registerSystem(
    SystemStage.PostUpdate,
    0,
    'PhysicsIntegration:mirror',
    () => {
      const ids = world.query(PhysicsBody.name).ids;
      for (const id of ids) {
        const b = world.getComponent<RigidBody>(PhysicsBody.name, id);
        if (!b) continue;
        world.addComponent('Transform', id, {
          x: b.position.x,
          y: b.position.y,
          z: b.position.z,
        });
        world.addComponent('Velocity', id, {
          x: b.velocity.x,
          y: b.velocity.y,
          z: b.velocity.z,
        });
      }
    },
  );
  // Seed the identical initial entities AFTER systems are registered.
  opts.seed(world);
}

/**
 * Deterministically replay a recorded input sequence using `Simulation.replay`.
 * The replayed world registers the physics pipeline exactly as the live run did and
 * is seeded with the same initial entities, so the final observable state matches the
 * original run byte-for-byte.
 */
export function replayPhysics(
  records: readonly SimTickRecord[],
  opts: PhysicsReplayOptions,
): Simulation {
  return Simulation.replay(
    (world) => buildPhysicsWorld(world, opts),
    records,
    opts.sim,
  );
}
