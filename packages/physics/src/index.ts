/**
 * @omega/physics — deterministic rigid-body physics for PROJECT OMEGA.
 *
 * Public surface: body factory, collision primitives + broadphase, the physics
 * world, and an ECS adapter that runs physics inside a World's update stage.
 */

export { createBody, type RigidBody, type RigidBodyOptions } from './body.js';
export {
  AabbBroadphase,
  detectSphereSphere,
  resolveSphereSphere,
  resolveSphereGround,
} from './collision.js';
export {
  PhysicsWorld,
  type PhysicsWorldOptions,
} from './world.js';
export {
  PhysicsSystem,
  PHYSICS_BODY_STORE,
  type PhysicsSystemOptions,
} from './system.js';
