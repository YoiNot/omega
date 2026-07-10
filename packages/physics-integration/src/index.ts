/**
 * @omega/physics-integration — public surface.
 *
 * Integration layer wiring @omega/physics, @omega/ecs, and @omega/sim into a single
 * deterministic, fixed-timestep physics step pipeline.
 */

export {
  PhysicsBody,
  Transform,
  Velocity,
} from './components.js';

export {
  createPhysicsEntity,
  type PhysicsEntityOptions,
} from './factory.js';

export {
  PhysicsSimulation,
  type PhysicsSimulationOptions,
} from './pipeline.js';

export {
  replayPhysics,
  type PhysicsReplayOptions,
} from './replay.js';
