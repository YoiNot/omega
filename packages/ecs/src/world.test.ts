import { describe, it, expect } from 'vitest';
import { World } from './world.js';
import { defineComponent } from './storage.js';
import { Rng } from '@omega/engine-core';

const Pos = defineComponent<{ x: number; y: number }>('position');
const Vel = defineComponent<{ dx: number; dy: number }>('velocity');

describe('World — end to end', () => {
  it('create -> addComponent -> query -> tick works', () => {
    const w = new World();
    const e = w.createEntity();
    w.addComponent(e, Pos, { x: 0, y: 0 });
    w.addComponent(e, Vel, { dx: 1, dy: -1 });

    let calls = 0;
    w.query(Pos, Vel).each((id, pos, vel) => {
      calls++;
      expect(id).toBe(e);
      expect(pos).toEqual({ x: 0, y: 0 });
      expect(vel).toEqual({ dx: 1, dy: -1 });
    });
    expect(calls).toBe(1);

    // A system integrates velocity into position, deterministically.
    w.registerSystem((world, dt) => {
      world.query(Pos, Vel).each((id, _p, v) => {
        const np = world.getComponent(id, Pos)!;
        np.x += v.dx * dt;
        np.y += v.dy * dt;
        world.setComponent(id, Pos, np);
      });
    }, 0);

    w.tick(0.5);
    expect(w.getComponent(e, Pos)).toEqual({ x: 0.5, y: -0.5 });
    expect(w.tickCount).toBe(1);
  });

  it('destroyEntity removes it from queries and frees the id', () => {
    const w = new World();
    const a = w.createEntity();
    const b = w.createEntity();
    w.addComponent(a, Pos, { x: 0, y: 0 });
    w.addComponent(b, Pos, { x: 1, y: 1 });
    w.destroyEntity(a);
    expect(w.isAlive(a)).toBe(false);
    expect(w.query(Pos).entities()).toEqual([b]);
    // id reuse is deterministic (FIFO free-list)
    const c = w.createEntity();
    expect(c).toBe(a);
  });

  it('removeComponent detaches from the archetype', () => {
    const w = new World();
    const e = w.createEntity();
    w.addComponent(e, Pos, { x: 0, y: 0 });
    w.addComponent(e, Vel, { dx: 1, dy: 1 });
    expect(w.query(Pos, Vel).size).toBe(1);
    w.removeComponent(e, Vel);
    expect(w.query(Pos, Vel).size).toBe(0);
    expect(w.query(Pos).size).toBe(1);
  });
});

describe('World — determinism', () => {
  function run(seed: number | string): Array<[number, number, number]> {
    const w = new World();
    const rng = new Rng(seed);
    // Spawn 10 entities with random initial positions/velocities.
    const ids: number[] = [];
    for (let i = 0; i < 10; i++) {
      const id = w.createEntity();
      ids.push(id);
      w.addComponent(id, Pos, {
        x: rng.nextRange(-100, 100),
        y: rng.nextRange(-100, 100),
      });
      if (rng.bool(0.6)) {
        w.addComponent(id, Vel, {
          dx: rng.nextRange(-5, 5),
          dy: rng.nextRange(-5, 5),
        });
      }
    }
    // Integrate 5 ticks of fixed dt.
    w.registerSystem((world, dt) => {
      world.query(Pos, Vel).each((id, _p, v) => {
        const np = world.getComponent(id, Pos)!;
        np.x += v.dx * dt;
        np.y += v.dy * dt;
        world.setComponent(id, Pos, np);
      });
    }, 0);

    for (let t = 0; t < 5; t++) w.tick(1 / 60);

    // Observable sequence: (id, x, y) for each entity that still has Pos.
    return w.query(Pos).entities().map((id) => {
      const p = w.getComponent(id, Pos)!;
      return [id, Math.round(p.x * 1000) / 1000, Math.round(p.y * 1000) / 1000];
    });
  }

  it('identical seed => identical observable sequence', () => {
    const a = run('omega-deterministic-seed');
    const b = run('omega-deterministic-seed');
    expect(a).toEqual(b);
    expect(a.length).toBe(10);
  });

  it('different seeds => different sequences (sanity that RNG is actually used)', () => {
    const a = run('seed-a');
    const b = run('seed-b');
    expect(a).not.toEqual(b);
  });

  it('tick count advances deterministically', () => {
    const w = new World();
    w.registerSystem(() => {}, 0);
    w.tick(0.016);
    w.tick(0.016);
    expect(w.tickCount).toBe(2);
  });
});
