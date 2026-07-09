import { describe, it, expect } from 'vitest';
import { Vec3 } from '@omega/engine-math';
import { createBody } from './body.js';

describe('createBody', () => {
  it('creates a dynamic body with cloned position', () => {
    const p = new Vec3(1, 2, 3);
    const b = createBody(7, p, { mass: 2, radius: 0.5 });
    expect(b.id).toBe(7);
    expect(b.mass).toBe(2);
    expect(b.invMass).toBeCloseTo(0.5);
    expect(b.radius).toBe(0.5);
    expect(b.onGround).toBe(false);
    // Position is a clone, not the same reference.
    expect(b.position).not.toBe(p);
    expect(b.position.x).toBe(1);
  });

  it('defaults velocity to zero and restitution to 0.2', () => {
    const b = createBody(1, new Vec3(0, 0, 0));
    expect(b.velocity.x).toBe(0);
    expect(b.velocity.y).toBe(0);
    expect(b.velocity.z).toBe(0);
    expect(b.restitution).toBe(0.2);
  });

  it('static bodies get invMass 0 and mass Infinity', () => {
    const s = createBody(2, new Vec3(0, 0, 0), { isStatic: true });
    expect(s.invMass).toBe(0);
    expect(s.mass).toBe(Infinity);
    expect(s.onGround).toBe(false);
  });

  it('non-positive mass is treated as static', () => {
    const b = createBody(3, new Vec3(0, 0, 0), { mass: 0 });
    expect(b.invMass).toBe(0);
  });

  it('carries initial velocity (cloned)', () => {
    const v = new Vec3(0, -5, 1);
    const b = createBody(4, new Vec3(0, 0, 0), { velocity: v });
    expect(b.velocity.y).toBe(-5);
    expect(b.velocity).not.toBe(v);
  });
});
