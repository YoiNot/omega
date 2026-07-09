/**
 * @omega/physics — collision detection & resolution.
 *
 * Broadphase is a naive AABB sweep (O(n^2)) that returns candidate body-id
 * pairs whose sphere bounding boxes overlap. Narrowphase is true sphere-sphere
 * (detectSphereSphere) + an analytic ground plane. Resolution uses positional
 * correction (split by inverse mass) plus a normal-impulse with restitution.
 *
 * Everything is deterministic: no Math.random, only Vec3 math from engine-math.
 */

import { Vec3 } from '@omega/engine-math';
import type { RigidBody } from './body.js';

/** Axis-aligned bounding box of a sphere. */
interface Aabb {
  minX: number; minY: number; minZ: number;
  maxX: number; maxY: number; maxZ: number;
}

function aabbOf(b: RigidBody): Aabb {
  const r = b.radius;
  return {
    minX: b.position.x - r, maxX: b.position.x + r,
    minY: b.position.y - r, maxY: b.position.y + r,
    minZ: b.position.z - r, maxZ: b.position.z + r,
  };
}

function aabbOverlap(a: Aabb, b: Aabb): boolean {
  return (
    a.minX <= b.maxX && b.minX <= a.maxX &&
    a.minY <= b.maxY && b.minY <= a.maxY &&
    a.minZ <= b.maxZ && b.minZ <= a.maxZ
  );
}

/**
 * Naive broadphase: returns all unique pairs [i, j] (i < j) of body ids whose
 * sphere AABBs overlap. O(n^2); fine for the body counts physics targets.
 */
export class AabbBroadphase {
  computePairs(bodies: Iterable<RigidBody>): [number, number][] {
    const list = [...bodies];
    const n = list.length;
    const boxes = list.map(aabbOf);
    const pairs: [number, number][] = [];
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        if (aabbOverlap(boxes[i], boxes[j])) pairs.push([list[i].id, list[j].id]);
      }
    }
    return pairs;
  }
}

/**
 * Narrowphase: are spheres a and b actually overlapping (surface distance < 0)?
 */
export function detectSphereSphere(a: RigidBody, b: RigidBody): boolean {
  const dx = b.position.x - a.position.x;
  const dy = b.position.y - a.position.y;
  const dz = b.position.z - a.position.z;
  const r = a.radius + b.radius;
  return dx * dx + dy * dy + dz * dz < r * r;
}

/**
 * Resolve a sphere-sphere overlap: separate by penetration (split by inverse
 * mass) and apply a normal impulse with restitution. No-op for two static
 * bodies. Mutates both bodies in place. Returns true if a contact was resolved.
 */
export function resolveSphereSphere(a: RigidBody, b: RigidBody): boolean {
  const sum = a.invMass + b.invMass;
  if (sum === 0) return false; // both static

  let nx = b.position.x - a.position.x;
  let ny = b.position.y - a.position.y;
  let nz = b.position.z - a.position.z;
  let dist = Math.sqrt(nx * nx + ny * ny + nz * nz);

  const rsum = a.radius + b.radius;
  if (dist >= rsum) return false; // not overlapping

  // Degenerate case: coincident centers — pick a stable arbitrary axis.
  if (dist < 1e-9) {
    nx = 0; ny = 1; nz = 0; dist = 1;
  } else {
    const inv = 1 / dist;
    nx *= inv; ny *= inv; nz *= inv;
  }

  const penetration = rsum - dist;

  // Positional correction (Baumgarte-style split by inverse mass).
  const corr = penetration / sum;
  a.position.x -= nx * corr * a.invMass;
  a.position.y -= ny * corr * a.invMass;
  a.position.z -= nz * corr * a.invMass;
  b.position.x += nx * corr * b.invMass;
  b.position.y += ny * corr * b.invMass;
  b.position.z += nz * corr * b.invMass;

  // Relative velocity along the normal.
  const rvx = b.velocity.x - a.velocity.x;
  const rvy = b.velocity.y - a.velocity.y;
  const rvz = b.velocity.z - a.velocity.z;
  const relN = rvx * nx + rvy * ny + rvz * nz;

  // Already separating — only the position fix mattered.
  if (relN > 0) return true;

  const e = Math.min(a.restitution, b.restitution);
  const jImpulse = -(1 + e) * relN / sum;

  a.velocity.x -= nx * jImpulse * a.invMass;
  a.velocity.y -= ny * jImpulse * a.invMass;
  a.velocity.z -= nz * jImpulse * a.invMass;
  b.velocity.x += nx * jImpulse * b.invMass;
  b.velocity.y += ny * jImpulse * b.invMass;
  b.velocity.z += nz * jImpulse * b.invMass;

  return true;
}

/**
 * Resolve a sphere against a static ground plane at y = groundY. Pushes the body
 * up so its lowest point rests on the plane, flips & damps the downward velocity
 * by restitution. Sets onGround when in contact. Mutates the body in place.
 * Returns true if a contact was resolved.
 */
export function resolveSphereGround(b: RigidBody, groundY: number): boolean {
  if (b.invMass === 0) return false; // static
  const bottom = b.position.y - b.radius;
  if (bottom >= groundY) {
    // Not touching — clear ground flag only if well above the plane.
    if (bottom > groundY + 1e-4) b.onGround = false;
    return false;
  }
  const penetration = groundY - bottom;
  b.position.y += penetration;
  if (b.velocity.y < 0) {
    b.velocity.y = -b.velocity.y * b.restitution;
  }
  b.onGround = true;
  return true;
}
