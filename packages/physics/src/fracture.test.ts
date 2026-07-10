import { describe, it, expect } from 'vitest';
import { Vec3 } from '@omega/engine-math';
import { fractureBody, planeFromStress, createBody } from './index.js';

describe('fracture — determinism + momentum conservation', () => {
  it('splits a body into two fragments with conserved momentum', () => {
    const parent = createBody(1, new Vec3(0, 5, 0), {
      mass: 4,
      radius: 1,
      velocity: new Vec3(2, 0, 0),
    });
    const res1 = fractureBody(parent, { childRadiusFraction: 0.45, separationImpulse: 1 });
    const parent2 = createBody(1, new Vec3(0, 5, 0), {
      mass: 4,
      radius: 1,
      velocity: new Vec3(2, 0, 0),
    });
    const res2 = fractureBody(parent2, { childRadiusFraction: 0.45, separationImpulse: 1 });

    // Deterministic: same inputs => same child positions/velocities.
    const c1 = res1.children, c2 = res2.children;
    expect(c1[0].position.x).toBeCloseTo(c2[0].position.x, 9);
    expect(c1[0].position.y).toBeCloseTo(c2[0].position.y, 9);
    expect(c1[1].position.x).toBeCloseTo(c2[1].position.x, 9);
    expect(c1[0].velocity.x).toBeCloseTo(c2[0].velocity.x, 9);

    // Momentum conserved: parent.p = children.p (equal/opposite separation).
    const pP = parent.mass * parent.velocity.x;
    const pC = c1[0].mass * c1[0].velocity.x + c1[1].mass * c1[1].velocity.x;
    expect(pC).toBeCloseTo(pP, 9);
    // Children move apart.
    expect(c1[0].position.x).not.toBeCloseTo(c1[1].position.x, 9);
  });

  it('planeFromStress is order-independent for the same point set', () => {
    const pts = [new Vec3(0, 0, 0), new Vec3(1, 0, 0), new Vec3(0, 1, 0)];
    const a = planeFromStress(pts, new Vec3(0, 0, 0));
    const b = planeFromStress([...pts].reverse(), new Vec3(0, 0, 0));
    expect(a.normal.x).toBeCloseTo(b.normal.x, 9);
    expect(a.normal.y).toBeCloseTo(b.normal.y, 9);
    expect(a.normal.z).toBeCloseTo(b.normal.z, 9);
  });
});
