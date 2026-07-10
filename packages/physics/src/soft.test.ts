import { describe, it, expect } from 'vitest';
import { Vec3 } from '@omega/engine-math';
import { ConstraintWorld, buildSoftBody } from './index.js';

function snapSoft(ids: number[][][], world: ConstraintWorld): number[] {
  const out: number[] = [];
  for (const slab of ids) for (const col of slab) for (const id of col) {
    const p = world.getParticle(id)!;
    out.push(p.position.x, p.position.y, p.position.z);
  }
  return out;
}

describe('soft body — determinism + deformation', () => {
  it('a free lattice falls under gravity and is identical across two runs', () => {
    function run(): number[] {
      const w = new ConstraintWorld({ gravity: new Vec3(0, -9.81, 0), solverIterations: 6 });
      const body = buildSoftBody(w, { origin: new Vec3(0, 10, 0), dimX: 3, dimY: 3, dimZ: 3, spacing: 0.5 });
      for (let i = 0; i < 60; i++) w.step(1 / 60);
      return snapSoft(body.ids, w);
    }
    const a = run();
    const b = run();
    expect(a).toEqual(b);
  });

  it('a bottom-fixed lattice sags (free top drops) under gravity', () => {
    const w = new ConstraintWorld({ gravity: new Vec3(0, -9.81, 0), solverIterations: 8 });
    const body = buildSoftBody(w, {
      origin: new Vec3(0, 10, 0),
      dimX: 3, dimY: 3, dimZ: 3,
      spacing: 0.5,
      pinCorners: false,
      structuralStiffness: 0.2,
      shearStiffness: 0.1,
      bendStiffness: 0.05,
    });
    // Pin the bottom layer (y = origin.y) so the body hangs and sags.
    for (let x = 0; x < body.dimX; x++) {
      for (let z = 0; z < body.dimZ; z++) {
        const p = w.getParticle(body.ids[x][0][z])!;
        p.invMass = 0; p.pinned = true; p.mass = Infinity;
      }
    }
    const topBefore = w.getParticle(body.ids[0][body.dimY - 1][0])!.position.y;
    for (let i = 0; i < 120; i++) w.step(1 / 60);
    // The bottom stays fixed; the free top sags below its start (shape change).
    const bottomY = w.getParticle(body.ids[0][0][0])!.position.y;
    const topAfter = w.getParticle(body.ids[0][body.dimY - 1][0])!.position.y;
    expect(bottomY).toBeCloseTo(10, 6);
    expect(topAfter).toBeLessThan(topBefore);
    for (const slab of body.ids) for (const col of slab) for (const id of col) {
      const p = w.getParticle(id)!;
      expect(Number.isFinite(p.position.y)).toBe(true);
    }
  });
});
