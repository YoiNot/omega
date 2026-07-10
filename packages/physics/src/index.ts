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

// --- Roadmap §11: bound / soft bodies, fluids, fracture, orbital mechanics ---
export {
  createParticle,
  type Particle,
  type ParticleOptions,
  createDistanceConstraint,
  type DistanceConstraint,
  ConstraintWorld,
  type ConstraintWorldOptions,
  buildRope,
  type RopeOptions,
  buildCloth,
  type ClothOptions,
  type Cloth,
} from './constraints.js';
export {
  buildSoftBody,
  type SoftBody,
  type SoftBodyOptions,
  softBodyCenter,
} from './soft.js';
export {
  FluidWorld,
  type FluidParticle,
  type FluidWorldOptions,
  fillBlock,
} from './fluid.js';
export {
  fractureBody,
  fractureInWorld,
  planeFromStress,
  type FracturePlane,
  type FractureOptions,
  type FractureResult,
} from './fracture.js';
export {
  NBodySystem,
  createOrbitalBody,
  type OrbitalBody,
  type NBodyOptions,
  elementsFromState,
  keplerStep,
  type KeplerElements,
} from './orbital.js';
