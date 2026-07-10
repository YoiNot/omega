/**
 * @omega/physics-integration — deterministic fixed-tick physics pipeline.
 *
 * Composes three existing packages into one ordered, deterministic step:
 *
 *   sim.tick (world.step / scheduler.update)
 *     -> PhysicsSystem (Update stage): ECS<->PhysicsWorld sync + physics.step
 *     -> PipelineSystem (PostUpdate stage): mirror body state into view components
 *
 * `PhysicsSimulation` is a pure function of (initial world state, input sequence,
 * fixedDt). Feeding two instances the same scripted input sequence with the same
 * fixed frameDt yields byte-identical observable state (entity positions) after the
 * same number of ticks. Time/tick are passed in as parameters; no clock is read.
 */

import {
  World,
  SystemStage,
  type EntityId,
} from '@omega/engine-core';
import {
  PhysicsSystem,
  type PhysicsSystemOptions,
  type RigidBody,
} from '@omega/physics';
import { Simulation, type SimulationOptions } from '@omega/sim';
import { PhysicsBody } from './components.js';

export interface PhysicsSimulationOptions {
  /** Forwarded to `Simulation` (fixedDt / maxSteps / recordLimit). */
  sim?: SimulationOptions;
  /** Forwarded to `PhysicsSystem` (gravity / groundY / solverIterations ...). */
  physics?: PhysicsSystemOptions;
}

/**
 * A composed, deterministic physics simulation over an ECS `World`.
 *
 * The underlying `World` is owned by the `Simulation`; the `PhysicsSystem` is
 * registered on that same world, so every fixed step automatically runs the
 * physics sync ECS->PhysicsWorld->ECS before the optional view mirror.
 */
export class PhysicsSimulation {
  readonly world: World;
  readonly sim: Simulation;
  readonly physics: PhysicsSystem;
  /** Number of fixed physics steps performed (monotonic). */
  tickCount = 0;

  constructor(world: World, opts: PhysicsSimulationOptions = {}) {
    this.world = world;
    this.sim = new Simulation(world, opts.sim);
    this.physics = new PhysicsSystem(world, opts.physics);
    this.physics.register();
    // Mirror body state into the Transform/Velocity view columns each tick.
    world.registerSystem(
      SystemStage.PostUpdate,
      0,
      'PhysicsIntegration:mirror',
      () => this.mirror(),
    );
  }

  play(): void { this.sim.play(); }
  pause(): void { this.sim.pause(); }
  get isRunning(): boolean { return this.sim.isRunning; }

  /** Feed elapsed seconds; advances only while running. Returns fixed steps run. */
  advance(frameDt: number, input?: unknown): number {
    return this.sim.advance(frameDt, input);
  }

  /** Deterministic single fixed step (also records the tick for replay). */
  step(input?: unknown): void {
    this.sim.step(input);
  }

  /** Observable state: position of every physics body, ascending by entity id. */
  bodyPositions(): { id: EntityId; x: number; y: number; z: number }[] {
    const out: { id: EntityId; x: number; y: number; z: number }[] = [];
    const ids = this.world.query(PhysicsBody.name).ids;
    for (const id of ids) {
      const b = this.world.getComponent<RigidBody>(PhysicsBody.name, id);
      if (!b) continue;
      out.push({ id, x: b.position.x, y: b.position.y, z: b.position.z });
    }
    return out;
  }

  /** Mirror body position/velocity into the optional Transform/Velocity views. */
  private mirror(): void {
    this.tickCount++;
    const ids = this.world.query(PhysicsBody.name).ids;
    for (const id of ids) {
      const b = this.world.getComponent<RigidBody>(PhysicsBody.name, id);
      if (!b) continue;
      this.world.addComponent('Transform', id, {
        x: b.position.x,
        y: b.position.y,
        z: b.position.z,
      });
      this.world.addComponent('Velocity', id, {
        x: b.velocity.x,
        y: b.velocity.y,
        z: b.velocity.z,
      });
    }
  }
}
