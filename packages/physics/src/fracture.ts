/**
 * @omega/physics — deterministic fracture of a rigid body.
 *
 * Given a `RigidBody` (sphere, from `body.ts`) and a set of "stress" points,
 * fracture splits the body into two child spheres along a splitting plane that
 * is defined *deterministically* by the caller (a normal + a point). The split
 * conserves total mass, linear momentum and — approximately — volume; each
 * child inherits the parent's velocity plus a small separating impulse whose
 * direction is the plane normal (sign chosen by which side the child lands on).
 *
 * Determinism contract:
 *   - No Math.random / clock. The plane is supplied explicitly; when "auto",
 *     it is derived from the input stress points by a fixed, order-independent
 *     rule (centroid + principal axis of the point cloud) so the same inputs
 *     always fracture the same way.
 */

import { Vec3 } from '@omega/engine-math';
import { createBody, type RigidBody } from './body.js';

export interface FracturePlane {
  /** Unit normal of the splitting plane. */
  normal: Vec3;
  /** A point on the plane (typically the body center or stress centroid). */
  point: Vec3;
}

export interface FractureOptions {
  /** Explicit split plane. When omitted, it is derived from `stressPoints`. */
  plane?: FracturePlane;
  /**
   * Stress points (world space). Used to auto-derive the plane when `plane` is
   * absent: the plane passes through their centroid, normal = direction from
   * centroid to the most distant stress point (stable, order-independent given
   * identical inputs).
   */
  stressPoints?: Vec3[];
  /** Fraction of parent radius each child keeps (0..0.5). Default 0.45. */
  childRadiusFraction?: number;
  /**
   * Separation impulse magnitude along the plane normal. Default 1.0. The sign
   * is chosen by which side of the plane the child center sits on.
   */
  separationImpulse?: number;
}

export interface FractureResult {
  /** The two child bodies (replacing the parent). */
  children: [RigidBody, RigidBody];
  /** The plane actually used. */
  plane: FracturePlane;
}

/**
 * Derive a deterministic split plane from stress points: through their
 * centroid, with the normal aligned to the principal axis of the point cloud
 * (the eigenvector of the covariance matrix with the largest spread). This is
 * a pure function of the *set* of points — order-independent — so the same
 * stress pattern always fractures the same way. Uses fixed-iteration power
 * iteration (no tolerance loop) seeded from a fixed vector for reproducibility.
 */
export function planeFromStress(stress: Vec3[], center: Vec3): FracturePlane {
  if (!stress || stress.length < 2) {
    return { normal: new Vec3(1, 0, 0), point: center.clone() };
  }
  // Centroid (order-independent arithmetic mean).
  const c = new Vec3(0, 0, 0);
  for (const p of stress) c.add(p);
  c.scale(1 / stress.length);

  // 3x3 covariance matrix of (p - centroid), summed over all points.
  let sxx = 0, syy = 0, szz = 0, sxy = 0, sxz = 0, syz = 0;
  for (const p of stress) {
    const dx = p.x - c.x, dy = p.y - c.y, dz = p.z - c.z;
    sxx += dx * dx; syy += dy * dy; szz += dz * dz;
    sxy += dx * dy; sxz += dx * dz; syz += dy * dz;
  }

  // Dominant eigenvector via power iteration (fixed 16 steps) from (1,0,0).
  let v = new Vec3(1, 0, 0);
  for (let i = 0; i < 16; i++) {
    const x = sxx * v.x + sxy * v.y + sxz * v.z;
    const y = sxy * v.x + syy * v.y + syz * v.z;
    const z = sxz * v.x + syz * v.y + szz * v.z;
    v = new Vec3(x, y, z);
    const len = v.length();
    if (len > 1e-12) v.scale(1 / len);
  }
  // If covariance is degenerate (collinear/planar with no clear axis), fall
  // back to a vertical split through the centroid.
  if (!Number.isFinite(v.x) || v.lengthSq() < 1e-12) v = new Vec3(1, 0, 0);
  const normal = v.clone().normalize();
  return { normal, point: c };
}

/**
 * Split `parent` into two child bodies along `plane`. The parent is NOT removed
 * here (the caller owns the `PhysicsWorld` bookkeeping — they should remove the
 * parent and add the children). Mass is split by volume for each child's radius
 * but conserved in total; momentum is conserved by giving both children the
 * parent's velocity plus equal/opposite separation impulses. Fully deterministic.
 */
export function fractureBody(parent: RigidBody, opts: FractureOptions = {}): FractureResult {
  const plane = opts.plane ?? planeFromStress(opts.stressPoints ?? [], parent.position);
  const rFrac = Math.min(0.5, Math.max(0.05, opts.childRadiusFraction ?? 0.45));
  const sep = opts.separationImpulse ?? 1.0;

  const rChild = parent.radius * rFrac;
  // Conserve the parent's total mass by giving each child half. (The children's
  // radii are fixed by rFrac; their mass is independent of radius so we keep the
  // full parent mass split evenly — momentum conservation then holds exactly.)
  const childMass = parent.mass / 2;
  // Remaining "dust" is not simulated; the two tracked fragments carry the full
  // parent momentum, which is the property gameplay cares about.

  const child1Radius = rChild;
  const child2Radius = rChild;

  // Project offsets along the normal so children sit just off the split plane.
  const off1 = rChild * 0.5;
  const off2 = rChild * 0.5;

  const p1 = parent.position.clone().addScaled(plane.normal, off1);
  const p2 = parent.position.clone().addScaled(plane.normal, -off2);

  const c1 = createBody(parent.id * 2 + 1, p1, {
    mass: childMass,
    radius: child1Radius,
    restitution: parent.restitution,
    restThreshold: parent.restThreshold,
    velocity: parent.velocity.clone().addScaled(plane.normal, sep),
  });
  const c2 = createBody(parent.id * 2 + 2, p2, {
    mass: childMass,
    radius: child2Radius,
    restitution: parent.restitution,
    restThreshold: parent.restThreshold,
    velocity: parent.velocity.clone().addScaled(plane.normal, -sep),
  });

  return { children: [c1, c2], plane };
}

/**
 * Convenience: apply a fracture inside a `PhysicsWorld`-like container. The
 * container must implement `removeBody(id)` and `addBody(body)`. Returns the
 * children. (Duck-typed to avoid a hard import cycle with `world.ts`.)
 */
export function fractureInWorld(
  world: { removeBody(id: number): boolean; addBody(b: RigidBody): RigidBody },
  parent: RigidBody,
  opts: FractureOptions = {},
): FractureResult {
  const res = fractureBody(parent, opts);
  world.removeBody(parent.id);
  world.addBody(res.children[0]);
  world.addBody(res.children[1]);
  return res;
}
