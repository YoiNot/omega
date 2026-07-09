/**
 * @omega/physics — rigid body definition.
 *
 * A RigidBody is a simple sphere (radius) with linear dynamics only: position,
 * velocity, mass. Rotation is intentionally out of scope for v1. Static bodies
 * use invMass = 0 so the solver leaves them untouched.
 */

import { Vec3 } from '@omega/engine-math';

export interface RigidBodyOptions {
  /** Mass in arbitrary units. Use <= 0 or isStatic for immovable bodies. Default 1. */
  mass?: number;
  /** Sphere radius. Default 0.5. */
  radius?: number;
  /** Coefficient of restitution in [0,1]. Default 0.2 (slightly inelastic). */
  restitution?: number;
  /** Initial velocity. Default zero. */
  velocity?: Vec3;
  /** Make the body static (immovable). Overrides mass. */
  isStatic?: boolean;
}

export interface RigidBody {
  id: number;
  position: Vec3;
  velocity: Vec3;
  mass: number;
  invMass: number;
  radius: number;
  restitution: number;
  onGround: boolean;
}

/**
 * Create a RigidBody. Static bodies (isStatic or mass <= 0) get invMass = 0.
 * Position is cloned so callers retain ownership of their Vec3.
 */
export function createBody(
  id: number,
  position: Vec3,
  opts: RigidBodyOptions = {},
): RigidBody {
  const mass = opts.mass ?? 1;
  const isStatic = opts.isStatic ?? false;
  const invMass = isStatic || mass <= 0 ? 0 : 1 / mass;
  return {
    id,
    position: position.clone(),
    velocity: opts.velocity ? opts.velocity.clone() : new Vec3(0, 0, 0),
    mass: isStatic ? Infinity : mass,
    invMass,
    radius: opts.radius ?? 0.5,
    restitution: opts.restitution ?? 0.2,
    onGround: false,
  };
}
