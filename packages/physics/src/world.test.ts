import { describe, it, expect } from 'vitest';
import { Vec3 } from '@omega/engine-math';
import { createBody } from './body.js';
import { PhysicsWorld } from './world.js';
import { AabbBroadphase } from './collision.js';

describe('PhysicsWorld — free fall', () => {
  it('integrates velocity and position under gravity (semi-implicit Euler)', () => {
    const w = new PhysicsWorld({ gravity: new Vec3(0, -9.81, 0), groundY: -Infinity });
    const b = createBody(1, new Vec3(0, 10, 0));
    w.addBody(b);
    const dt = 1 / 60;
    const t = 0.5; // seconds
    const steps = Math.round(t / dt);
    for (let i = 0; i < steps; i++) w.step(dt);

    // Semi-implicit (symplectic) Euler closed form: velocity uses all steps,
    // Exact semi-implicit Euler: v = -g*t ; y = y0 - g*t^2/2
    const expectedV = -9.81 * t;
    const expectedY = 10 + 0.5 * (-9.81) * t * t;
    expect(b.velocity.y).toBeCloseTo(expectedV, 4); // velocity is exact
    // Position is first-order accurate: within the expected discretization error.
    expect(b.position.y).toBeCloseTo(expectedY, 1);
    expect(b.position.x).toBeCloseTo(0, 9);
    expect(b.position.z).toBeCloseTo(0, 9);
  });

  it('does not move static bodies', () => {
    const w = new PhysicsWorld({ gravity: new Vec3(0, -9.81, 0), groundY: -Infinity });
    const s = createBody(1, new Vec3(0, 5, 0), { isStatic: true });
    w.addBody(s);
    for (let i = 0; i < 30; i++) w.step(1 / 60);
    expect(s.position.y).toBeCloseTo(5, 9);
  });

  it('supports custom gravity', () => {
    const w = new PhysicsWorld({ gravity: new Vec3(3, 0, 0), groundY: -Infinity });
    const b = createBody(1, new Vec3(0, 0, 0));
    w.addBody(b);
    w.step(1); // v.x = 3*1, x = 3*1
    expect(b.velocity.x).toBeCloseTo(3, 6);
    expect(b.position.x).toBeCloseTo(3, 6);
  });
});

describe('PhysicsWorld — ground collision', () => {
  it('bounces off the ground without sinking and eventually rests', () => {
    const w = new PhysicsWorld({ gravity: new Vec3(0, -9.81, 0), groundY: 0, solverIterations: 4 });
    const b = createBody(1, new Vec3(0, 5, 0), { restitution: 0.6, radius: 0.5 });
    w.addBody(b);

    // Falls, hits ground, bounces.
    let minY = Infinity;
    let bounced = false;
    let prevVy = b.velocity.y;
    for (let i = 0; i < 600; i++) {
      w.step(1 / 60);
      minY = Math.min(minY, b.position.y);
      if (b.velocity.y > 0 && prevVy <= 0) bounced = true;
      prevVy = b.velocity.y;
    }
    // Never sinks below the ground surface for its radius.
    expect(minY).toBeGreaterThanOrEqual(0.5 - 1e-6);
    expect(bounced).toBe(true);
    // Low-energy: resting on ground (tiny residual jitter allowed).
    expect(b.onGround).toBe(true);
    expect(Math.abs(b.velocity.y)).toBeLessThan(0.5);
    // Position clamped near rest height.
    expect(b.position.y).toBeCloseTo(0.5, 2);
  });
});

describe('PhysicsWorld — sphere-sphere', () => {
  it('two approaching equal-mass spheres collide and separate', () => {
    const w = new PhysicsWorld({ groundY: -Infinity, solverIterations: 4 });
    const a = createBody(1, new Vec3(-0.3, 0, 0), { velocity: new Vec3(1, 0, 0), restitution: 1 });
    const b = createBody(2, new Vec3(0.3, 0, 0), { velocity: new Vec3(-1, 0, 0), restitution: 1 });
    w.addBody(a); w.addBody(b);
    for (let i = 0; i < 5; i++) w.step(1 / 60);
    // They should have separated again.
    expect(a.position.x).toBeLessThan(b.position.x);
    expect(Vec3.distance(a.position, b.position)).toBeGreaterThanOrEqual(a.radius + b.radius - 1e-6);
  });

  it('equal masses exchange velocity head-on (elastic)', () => {
    const w = new PhysicsWorld({ groundY: -Infinity, solverIterations: 4 });
    const a = createBody(1, new Vec3(-0.3, 0, 0), { velocity: new Vec3(2, 0, 0), restitution: 1 });
    const b = createBody(2, new Vec3(0.3, 0, 0), { velocity: new Vec3(-2, 0, 0), restitution: 1 });
    w.addBody(a); w.addBody(b);
    w.step(1 / 60);
    expect(a.velocity.x).toBeCloseTo(-2, 5);
    expect(b.velocity.x).toBeCloseTo(2, 5);
  });
});

describe('PhysicsWorld — broadphase integration', () => {
  it('uses injected broadphase and resolves only overlapping pairs', () => {
    const bp = new AabbBroadphase();
    const w = new PhysicsWorld({ groundY: -Infinity, broadphase: bp });
    const a = createBody(1, new Vec3(0, 0, 0));
    const b = createBody(2, new Vec3(0.4, 0, 0)); // overlapping
    const c = createBody(3, new Vec3(10, 0, 0)); // far
    w.addBody(a); w.addBody(b); w.addBody(c);
    const pairs = bp.computePairs(w.bodies_());
    expect(pairs).toEqual([[1, 2]]);
  });
});

describe('PhysicsWorld — determinism', () => {
  it('identical initial conditions + dt sequence => identical final positions', () => {
    function run(): Vec3[] {
      const w = new PhysicsWorld({ gravity: new Vec3(0, -9.81, 0), groundY: 0 });
      // Several bodies forming an overlapping cluster; no Math.random.
      const seeds = [
        [0, 5, 0, 0], [1, 4.6, 0.1, 0], [2, 5.2, -0.1, 0.1], [3, 9, 0, 0],
      ] as const;
      for (const [id, x, y, z] of seeds) {
        w.addBody(createBody(id, new Vec3(x, y, z), { restitution: 0.5, radius: 0.5 }));
      }
      const dt = 1 / 60;
      const seq = [dt, dt * 2, dt, dt * 3, dt]; // irregular but deterministic
      for (const s of seq) w.step(s);
      return w.bodies_().map((b) => b.position.clone());
    }
    const a = run();
    const b = run();
    expect(a.length).toBe(b.length);
    for (let i = 0; i < a.length; i++) {
      expect(a[i].x).toBeCloseTo(b[i].x, 9);
      expect(a[i].y).toBeCloseTo(b[i].y, 9);
      expect(a[i].z).toBeCloseTo(b[i].z, 9);
    }
  });
});
