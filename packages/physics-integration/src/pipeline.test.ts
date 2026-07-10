import { describe, it, expect } from 'vitest';
import { Vec3 } from '@omega/engine-math';
import { World } from '@omega/engine-core';
import { type RigidBody } from '@omega/physics';
import { PhysicsBody } from '../src/components.js';
import { createPhysicsEntity } from '../src/factory.js';
import { PhysicsSimulation } from '../src/pipeline.js';

describe('factory', () => {
  it('createPhysicsEntity yields a live entity with a PhysicsBody whose id === entity id', () => {
    const world = new World();
    const id = createPhysicsEntity(world, {
      position: new Vec3(1, 5, -2),
      radius: 0.5,
      mass: 2,
    });

    expect(world.hasComponent(PhysicsBody.name, id)).toBe(true);
    const body = world.getComponent<RigidBody>(PhysicsBody.name, id);
    expect(body).toBeDefined();
    expect(body!.id).toBe(id);
    expect(body!.position.x).toBe(1);
    expect(body!.position.y).toBe(5);
    expect(body!.position.z).toBe(-2);
    expect(world.count()).toBe(1);
  });

  it('two entities get distinct, deterministic ids', () => {
    const world = new World();
    const a = createPhysicsEntity(world, { position: new Vec3(0, 0, 0) });
    const b = createPhysicsEntity(world, { position: new Vec3(1, 1, 1) });
    expect(a).not.toBe(b);
    expect(b).toBe(a + 1);
  });
});

describe('pipeline', () => {
  /** Build two identical runs from a fixed input script; compare final positions. */
  function run(): { id: number; x: number; y: number; z: number }[] {
    const world = new World();
    const sim = new PhysicsSimulation(world, {
      sim: { fixedDt: 1 / 60, maxSteps: 100 },
      physics: { gravity: new Vec3(0, -9.81, 0), groundY: 0 },
    });
    createPhysicsEntity(world, { position: new Vec3(0, 10, 0), radius: 0.5, restitution: 0.5 });
    createPhysicsEntity(world, { position: new Vec3(2, 8, 0), radius: 0.5, restitution: 0.5 });
    sim.play();
    for (let i = 0; i < 90; i++) sim.advance(1 / 30, { scripted: i });
    return sim.bodyPositions();
  }

  it('two identical runs yield byte-identical final positions', () => {
    const a = run();
    const b = run();
    expect(a).toEqual(b);
  });

  it('different frame slices with the same total time converge to the same state', () => {
    // Mirrors the proven sim.test pattern: 0.016+0.020+0.016 == 0.052 (both 3 fixed steps).
    const mk = () => {
      const world = new World();
      const sim = new PhysicsSimulation(world, {
        sim: { fixedDt: 1 / 60, maxSteps: 100 },
        physics: { gravity: new Vec3(0, -9.81, 0) },
      });
      createPhysicsEntity(world, { position: new Vec3(0, 10, 0) });
      return sim;
    };
    const simA = mk();
    simA.play();
    simA.advance(0.016); simA.advance(0.020); simA.advance(0.016);
    const simB = mk();
    simB.play();
    simB.advance(0.052);

    const a = simA.bodyPositions()[0];
    const b = simB.bodyPositions()[0];
    // Same total elapsed time => same number of fixed steps => identical positions.
    expect(a.x).toBeCloseTo(b.x, 12);
    expect(a.y).toBeCloseTo(b.y, 12);
    expect(a.z).toBeCloseTo(b.z, 12);
  });

  it('tick advances monotonically and bodies fall under gravity', () => {
    const world = new World();
    const sim = new PhysicsSimulation(world, {
      sim: { fixedDt: 1 / 60, maxSteps: 100 },
      physics: { gravity: new Vec3(0, -9.81, 0) },
    });
    createPhysicsEntity(world, { position: new Vec3(0, 10, 0) });
    sim.play();
    const before = sim.bodyPositions()[0].y;
    // Each 1/30s frame = 2 fixed steps at fixedDt 1/60 => 60 fixed steps total.
    for (let i = 0; i < 30; i++) sim.advance(1 / 30);
    const after = sim.bodyPositions()[0].y;
    expect(after).toBeLessThan(before); // fell
    expect(sim.tickCount).toBe(60); // 30 frames * 2 fixed steps each
    expect(after).toBeGreaterThanOrEqual(0.5 - 1e-6); // never below ground
  });

  it('pause() halts stepping', () => {
    const world = new World();
    const sim = new PhysicsSimulation(world, {
      sim: { fixedDt: 1 / 60, maxSteps: 100 },
      physics: { gravity: new Vec3(0, -9.81, 0) },
    });
    createPhysicsEntity(world, { position: new Vec3(0, 10, 0) });
    expect(sim.isRunning).toBe(false);
    expect(sim.advance(1)).toBe(0); // not playing -> no steps
    sim.play();
    sim.advance(0.1);
    const mid = sim.tickCount;
    sim.pause();
    expect(sim.advance(1)).toBe(0); // paused -> no steps
    expect(sim.tickCount).toBe(mid);
  });
});
