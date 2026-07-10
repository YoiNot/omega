import { describe, it, expect } from 'vitest';
import { Vec3 } from '@omega/engine-math';
import {
  ConstraintWorld,
  buildRope,
  buildCloth,
  createDistanceConstraint,
} from './constraints.js';

// addHelper is not exported; helper below mirrors world.addParticle for tests.
function snap(world: ConstraintWorld): number[] {
  return world.particles_().flatMap((p) => [p.position.x, p.position.y, p.position.z]);
}

describe('ConstraintWorld — distance constraint is rigid', () => {
  it('keeps two linked dynamic particles near the rest length under gravity', () => {
    const w = new ConstraintWorld({ gravity: new Vec3(0, -9.81, 0), solverIterations: 8 });
    const a = w.addParticle(new Vec3(0, 5, 0));
    const b = w.addParticle(new Vec3(0.4, 5, 0));
    w.addConstraint(createDistanceConstraint(a.id, b.id, 0.5, 1));
    for (let i = 0; i < 60; i++) w.step(1 / 60);
    const d = Vec3.distance(a.position, b.position);
    expect(d).toBeCloseTo(0.5, 3);
  });

  it('a pinned endpoint lets the rest of the chain hang without exploding', () => {
    const w = new ConstraintWorld({ gravity: new Vec3(0, -9.81, 0), solverIterations: 8 });
    const ids = buildRope(w, { start: new Vec3(0, 10, 0), segments: 6, segmentLength: 0.5 });
    for (let i = 0; i < 120; i++) w.step(1 / 60);
    // Top node stays put; lowest node hangs below it (total rope length ~3).
    const top = w.getParticle(ids[0])!;
    const bottom = w.getParticle(ids[ids.length - 1])!;
    expect(top.position.y).toBeCloseTo(10, 6);
    expect(bottom.position.y).toBeLessThan(10);
    // No NaN / explosion.
    for (const p of w.particles_()) {
      expect(Number.isFinite(p.position.x)).toBe(true);
      expect(Number.isFinite(p.position.y)).toBe(true);
      expect(Number.isFinite(p.position.z)).toBe(true);
    }
  });
});

describe('constraints — determinism (rope)', () => {
  it('identical initial conditions + dt sequence => identical trajectory', () => {
    function run(): number[] {
      const w = new ConstraintWorld({ gravity: new Vec3(0, -9.81, 0), solverIterations: 6 });
      buildRope(w, { start: new Vec3(0, 10, 0), segments: 8, segmentLength: 0.5 });
      const seq = [1 / 60, 1 / 30, 1 / 60, 1 / 120, 1 / 60];
      for (const dt of seq) w.step(dt);
      return snap(w);
    }
    const a = run();
    const b = run();
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(0);
  });
});

describe('constraints — determinism (cloth)', () => {
  it('hanging cloth produces identical positions across two runs', () => {
    function run(): number[] {
      const w = new ConstraintWorld({ gravity: new Vec3(0, -9.81, 0), solverIterations: 6 });
      buildCloth(w, {
        origin: new Vec3(-2, 10, 0),
        cols: 6,
        rows: 6,
        spacing: 0.5,
        pinTopRow: true,
        pinTopCornersOnly: true,
        shear: true,
      });
      for (let i = 0; i < 90; i++) w.step(1 / 60);
      return snap(w);
    }
    const a = run();
    const b = run();
    expect(a).toEqual(b);
  });

  it('top corners stay pinned', () => {
    const w = new ConstraintWorld({ gravity: new Vec3(0, -9.81, 0), solverIterations: 6 });
    const cloth = buildCloth(w, {
      origin: new Vec3(-2, 10, 0),
      cols: 6,
      rows: 6,
      spacing: 0.5,
      pinTopRow: true,
      pinTopCornersOnly: true,
    });
    for (let i = 0; i < 60; i++) w.step(1 / 60);
    const tl = w.getParticle(cloth.ids[0][0])!;
    const tr = w.getParticle(cloth.ids[0][cloth.cols - 1])!;
    expect(tl.position.x).toBeCloseTo(-2, 6);
    expect(tl.position.y).toBeCloseTo(10, 6);
    expect(tr.position.x).toBeCloseTo(-2 + 5 * 0.5, 6);
    expect(tr.position.y).toBeCloseTo(10, 6);
  });
});

describe('constraints — stiffness acts as springiness', () => {
  it('low stiffness stretches more under load than high stiffness', () => {
    // A heavy bottom node hangs from a pinned top node via one link: the link
    // must carry real tension, so a springy link visibly stretches.
    function settle(stiffness: number): number {
      const w = new ConstraintWorld({ gravity: new Vec3(0, -9.81, 0), solverIterations: 8 });
      const top = w.addParticle(new Vec3(0, 5, 0), { pinned: true });
      const bottom = w.addParticle(new Vec3(0, 4.5, 0), { mass: 5 });
      w.addConstraint(createDistanceConstraint(top.id, bottom.id, 0.5, stiffness));
      for (let i = 0; i < 200; i++) w.step(1 / 60);
      return Vec3.distance(top.position, bottom.position);
    }
    const soft = settle(0.1);
    const stiff = settle(1);
    expect(stiff).toBeCloseTo(0.5, 3); // rigid => holds rest length
    expect(soft).toBeGreaterThan(stiff); // springy => stretched
  });
});
