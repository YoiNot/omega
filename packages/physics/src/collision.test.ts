import { describe, it, expect } from 'vitest';
import { Vec3 } from '@omega/engine-math';
import { createBody, type RigidBody } from './body.js';
import {
  AabbBroadphase,
  detectSphereSphere,
  resolveSphereSphere,
  resolveSphereGround,
} from './collision.js';

function sphere(id: number, x: number, y: number, z: number, opts = {}): RigidBody {
  return createBody(id, new Vec3(x, y, z), { radius: 0.5, ...opts });
}

describe('AabbBroadphase', () => {
  it('returns overlapping pairs only', () => {
    const a = sphere(1, 0, 0, 0);
    const b = sphere(2, 0.4, 0, 0); // overlapping
    const c = sphere(3, 5, 0, 0); // far away
    const bp = new AabbBroadphase();
    const pairs = bp.computePairs([a, b, c]);
    expect(pairs).toEqual([[1, 2]]);
  });

  it('reports all pairs in a clustered group', () => {
    const a = sphere(10, 0, 0, 0);
    const b = sphere(20, 0.3, 0, 0);
    const c = sphere(30, 0, 0.3, 0);
    // a-b dist 0.3, a-c dist 0.3, b-c dist ~0.424 — all < sum of radii (1.0),
    // so every pair's AABB (and sphere) overlaps.
    const bp = new AabbBroadphase();
    const pairs = bp.computePairs([a, b, c]).sort((p, q) => p[0] - q[0] || p[1] - q[1]);
    expect(pairs).toEqual([[10, 20], [10, 30], [20, 30]]);
  });

  it('excludes non-overlapping bodies', () => {
    const a = sphere(1, 0, 0, 0);
    const b = sphere(2, 2, 0, 0); // centers 2 apart, radii 0.5 -> AABBs 1 apart
    const bp = new AabbBroadphase();
    expect(bp.computePairs([a, b])).toEqual([]);
  });

  it('handles empty and single-body input', () => {
    const bp = new AabbBroadphase();
    expect(bp.computePairs([])).toEqual([]);
    expect(bp.computePairs([sphere(1, 0, 0, 0)])).toEqual([]);
  });
});

describe('detectSphereSphere', () => {
  it('detects overlap', () => {
    const a = sphere(1, 0, 0, 0);
    const b = sphere(2, 0.7, 0, 0); // 0.7 < 1.0 sum of radii
    expect(detectSphereSphere(a, b)).toBe(true);
  });

  it('rejects separation', () => {
    const a = sphere(1, 0, 0, 0);
    const b = sphere(2, 1.5, 0, 0);
    expect(detectSphereSphere(a, b)).toBe(false);
  });
});

describe('resolveSphereSphere', () => {
  it('separates overlapping equal-mass spheres and exchanges velocity', () => {
    // Two equal masses moving toward each other along x; head-on elastic-ish.
    const a = sphere(1, -0.3, 0, 0, { velocity: new Vec3(1, 0, 0), restitution: 1 });
    const b = sphere(2, 0.3, 0, 0, { velocity: new Vec3(-1, 0, 0), restitution: 1 });
    const resolved = resolveSphereSphere(a, b);
    expect(resolved).toBe(true);
    // No penetration remains.
    const dist = Vec3.distance(a.position, b.position);
    expect(dist).toBeGreaterThanOrEqual(a.radius + b.radius - 1e-6);
    // Equal masses, perfectly elastic, head-on: velocities swap.
    expect(a.velocity.x).toBeCloseTo(-1, 5);
    expect(b.velocity.x).toBeCloseTo(1, 5);
  });

  it('moves only the dynamic body when paired with a static one', () => {
    const dyn = sphere(1, -0.3, 0, 0, { velocity: new Vec3(1, 0, 0), restitution: 1 });
    const stat = sphere(2, 0.3, 0, 0, { isStatic: true });
    resolveSphereSphere(dyn, stat);
    expect(stat.position.x).toBeCloseTo(0.3, 6);
    expect(dyn.velocity.x).toBeLessThan(0); // bounced back
  });

  it('returns false for two static bodies', () => {
    const a = sphere(1, -0.3, 0, 0, { isStatic: true });
    const b = sphere(2, 0.3, 0, 0, { isStatic: true });
    expect(resolveSphereSphere(a, b)).toBe(false);
  });

  it('no-op when not overlapping', () => {
    const a = sphere(1, -1, 0, 0);
    const b = sphere(2, 1, 0, 0);
    expect(resolveSphereSphere(a, b)).toBe(false);
  });

  it('handles coincident centers deterministically', () => {
    const a = sphere(1, 0, 0, 0, { velocity: new Vec3(0, 0, 0), restitution: 0 });
    const b = sphere(2, 0, 0, 0, { velocity: new Vec3(0, 0, 0), restitution: 0 });
    expect(() => resolveSphereSphere(a, b)).not.toThrow();
    // Separation in +y for a, -y for b keeps distance >= sum of radii.
    const dist = Vec3.distance(a.position, b.position);
    expect(dist).toBeGreaterThanOrEqual(a.radius + b.radius - 1e-6);
  });
});

describe('resolveSphereGround', () => {
  it('pushes a penetrating sphere up to rest on the ground', () => {
    const b = sphere(1, 0, -0.2, 0); // bottom at -0.7, below groundY 0
    const r = resolveSphereGround(b, 0);
    expect(r).toBe(true);
    expect(b.position.y).toBeCloseTo(0.5, 6); // center so bottom = groundY
    expect(b.onGround).toBe(true);
  });

  it('flips and damps downward velocity by restitution', () => {
    const b = sphere(1, 0, -0.2, 0, { restitution: 0.5, velocity: new Vec3(0, -4, 0) });
    resolveSphereGround(b, 0);
    expect(b.velocity.y).toBeCloseTo(2, 6); // -(-4)*0.5
    expect(b.onGround).toBe(true);
  });

  it('leaves a body above the ground untouched', () => {
    const b = sphere(1, 0, 2, 0);
    const r = resolveSphereGround(b, 0);
    expect(r).toBe(false);
    expect(b.onGround).toBe(false);
  });

  it('ignores static bodies', () => {
    const b = sphere(1, 0, -0.2, 0, { isStatic: true });
    expect(resolveSphereGround(b, 0)).toBe(false);
  });
});
