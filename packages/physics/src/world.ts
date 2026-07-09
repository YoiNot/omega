/**
 * @omega/physics — physics world.
 *
 * Semi-implicit (symplectic) Euler integration: integrate velocity first, then
 * advance position by the new velocity. This is more stable than explicit Euler
 * for gravity-driven motion and is the standard for simple rigid-body sims.
 */

import { Vec3 } from '@omega/engine-math';
import type { RigidBody } from './body.js';
import {
  AabbBroadphase,
  detectSphereSphere,
  resolveSphereSphere,
  resolveSphereGround,
} from './collision.js';

export interface PhysicsWorldOptions {
  /** Constant acceleration applied to all dynamic bodies. Default (0,-9.81,0). */
  gravity?: Vec3;
  /** Ground plane height (y). Default 0. Set to -Infinity to disable. */
  groundY?: number;
  /** Broadphase implementation. Defaults to AabbBroadphase. */
  broadphase?: AabbBroadphase;
  /** Iterations of constraint resolution per step. Default 2. */
  solverIterations?: number;
}

export class PhysicsWorld {
  readonly gravity: Vec3;
  groundY: number;
  readonly broadphase: AabbBroadphase;
  solverIterations: number;

  private readonly bodies = new Map<number, RigidBody>();

  constructor(opts: PhysicsWorldOptions = {}) {
    this.gravity = opts.gravity ? opts.gravity.clone() : new Vec3(0, -9.81, 0);
    this.groundY = opts.groundY ?? 0;
    this.broadphase = opts.broadphase ?? new AabbBroadphase();
    this.solverIterations = opts.solverIterations ?? 2;
  }

  addBody(body: RigidBody): RigidBody {
    this.bodies.set(body.id, body);
    return body;
  }

  removeBody(id: number): boolean {
    return this.bodies.delete(id);
  }

  getBody(id: number): RigidBody | undefined {
    return this.bodies.get(id);
  }

  /** All bodies, ascending by id (deterministic iteration). */
  bodies_(): RigidBody[] {
    return [...this.bodies.values()].sort((a, b) => a.id - b.id);
  }

  /** Advance the simulation by dt seconds. */
  step(dt: number): void {
    const bodies = this.bodies_();

    // 1) Integrate velocity (gravity) and position (semi-implicit Euler).
    for (const b of bodies) {
      if (b.invMass === 0) continue; // static
      b.velocity.x += this.gravity.x * dt;
      b.velocity.y += this.gravity.y * dt;
      b.velocity.z += this.gravity.z * dt;
      b.position.x += b.velocity.x * dt;
      b.position.y += b.velocity.y * dt;
      b.position.z += b.velocity.z * dt;
    }

    // 2) Resolve collisions over several solver iterations for stability.
    for (let iter = 0; iter < this.solverIterations; iter++) {
      // Broadphase -> narrowphase/resolve sphere-sphere.
      const pairs = this.broadphase.computePairs(bodies);
      for (const [ia, ib] of pairs) {
        const a = this.bodies.get(ia);
        const b = this.bodies.get(ib);
        if (!a || !b) continue;
        if (detectSphereSphere(a, b)) resolveSphereSphere(a, b);
      }
      // Ground contact for each dynamic body.
      for (const b of bodies) resolveSphereGround(b, this.groundY);
    }
  }
}
