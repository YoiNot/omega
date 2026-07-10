import { describe, it, expect } from 'vitest';
import { Vec3 } from '@omega/engine-math';
import { World, Rng } from '@omega/engine-core';
import { type RigidBody } from '@omega/physics';
import { createPhysicsEntity } from '../src/factory.js';
import { PhysicsSimulation } from '../src/pipeline.js';

describe('determinism', () => {
  it('randomized initial placement from a seeded Rng is identical across two runs', () => {
    const seed = 1337;

    function build(): World {
      const world = new World();
      const sim = new PhysicsSimulation(world, {
        sim: { fixedDt: 1 / 60, maxSteps: 100 },
        physics: { gravity: new Vec3(0, -9.81, 0) },
      });
      const rng = new Rng(seed);
      for (let i = 0; i < 5; i++) {
        const x = rng.nextRange(-5, 5);
        const y = rng.nextRange(5, 15);
        const z = rng.nextRange(-5, 5);
        createPhysicsEntity(world, { position: new Vec3(x, y, z), radius: 0.5 });
      }
      sim.play();
      for (let i = 0; i < 100; i++) sim.advance(1 / 30);
      return world;
    }

    const a = build();
    const b = build();
    const pa = a.query('PhysicsBody').ids.map((id) => {
      const body = a.getComponent<RigidBody>('PhysicsBody', id)!;
      return [body.position.x, body.position.y, body.position.z];
    });
    const pb = b.query('PhysicsBody').ids.map((id) => {
      const body = b.getComponent<RigidBody>('PhysicsBody', id)!;
      return [body.position.x, body.position.y, body.position.z];
    });
    expect(pa).toEqual(pb);
  });

  it('different seeds yield different placements (sanity that Rng is real)', () => {
    const rngA = new Rng(1);
    const rngB = new Rng(2);
    const a = rngA.nextF64();
    const b = rngB.nextF64();
    expect(a).not.toBe(b);
  });
});
