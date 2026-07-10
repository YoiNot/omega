import { describe, it, expect } from 'vitest';
import { Vec3 } from '@omega/engine-math';
import { World } from '@omega/engine-core';
import { type RigidBody } from '@omega/physics';
import { PhysicsBody } from '../src/components.js';
import { createPhysicsEntity } from '../src/factory.js';
import { PhysicsSimulation } from '../src/pipeline.js';
import { replayPhysics } from '../src/replay.js';

/** Deterministically rebuild the world's initial entities (replay only replays ticks). */
function seedWorld(world: World): [number, number] {
  const id0 = createPhysicsEntity(world, { position: new Vec3(0, 10, 0), radius: 0.5, restitution: 0.5 });
  const id1 = createPhysicsEntity(world, { position: new Vec3(3, 12, 1), radius: 0.5, restitution: 0.5 });
  return [id0, id1];
}

describe('replay', () => {
  it('replaying recorded inputs reproduces the live run final positions exactly', () => {
    const world = new World();
    const sim = new PhysicsSimulation(world, {
      // maxSteps high + record per fixed step via step(), so every fixed step is a record.
      sim: { fixedDt: 1 / 60, maxSteps: 100, recordLimit: 10000 },
      physics: { gravity: new Vec3(0, -9.81, 0), groundY: 0 },
    });
    const [id0, id1] = seedWorld(world);
    sim.play();
    // Drive via single fixed steps so history() captures one record per tick.
    for (let i = 0; i < 120; i++) sim.step({ frame: i });

    const live = sim.bodyPositions();
    const records = sim.sim.history();
    expect(records.length).toBe(120);

    // Replay through the same fixedDt; builder re-seeds the identical entities.
    const replayed = replayPhysics(records, {
      sim: { fixedDt: 1 / 60, maxSteps: 100 },
      physics: { gravity: new Vec3(0, -9.81, 0), groundY: 0 },
      seed: (w) => seedWorld(w),
    });
    const r = replayed.world;
    const r0 = r.getComponent<RigidBody>(PhysicsBody.name, id0)!;
    const r1 = r.getComponent<RigidBody>(PhysicsBody.name, id1)!;

    const live0 = live.find((p) => p.id === id0)!;
    const live1 = live.find((p) => p.id === id1)!;
    expect(r0.position.x).toBeCloseTo(live0.x, 12);
    expect(r0.position.y).toBeCloseTo(live0.y, 12);
    expect(r0.position.z).toBeCloseTo(live0.z, 12);
    expect(r1.position.x).toBeCloseTo(live1.x, 12);
    expect(r1.position.y).toBeCloseTo(live1.y, 12);
    expect(r1.position.z).toBeCloseTo(live1.z, 12);
  });

  it('same variable frame sequence yields identical final state across two live runs', () => {
    const frames = [0.016, 0.020, 0.016, 0.010, 0.006, 0.025, 0.011];
    function run(): { x: number; y: number; z: number } {
      const world = new World();
      const sim = new PhysicsSimulation(world, {
        sim: { fixedDt: 1 / 60, maxSteps: 100 },
        physics: { gravity: new Vec3(0, -9.81, 0), groundY: 0 },
      });
      seedWorld(world);
      sim.play();
      for (const f of frames) sim.advance(f, { frame: f });
      return sim.bodyPositions()[0];
    }
    const a = run();
    const b = run();
    expect(a.x).toBeCloseTo(b.x, 12);
    expect(a.y).toBeCloseTo(b.y, 12);
    expect(a.z).toBeCloseTo(b.z, 12);
  });
});
