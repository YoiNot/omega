import { describe, it, expect } from 'vitest';
import { World, SystemStage, ComponentStore } from './ecs.js';

interface Position { x: number; y: number; z: number; }
interface Velocity { vx: number; vy: number; vz: number; }
interface Health { hp: number; }

describe('ECS entities & components', () => {
  it('creates and destroys entities with id reuse', () => {
    const w = new World();
    const a = w.createEntity();
    const b = w.createEntity();
    expect(b).toBe(a + 1);
    w.destroyEntity(a);
    const c = w.createEntity();
    expect(c).toBe(a); // reused
    expect(w.count()).toBe(2);
  });

  it('adds/gets/removes components', () => {
    const w = new World();
    const id = w.spawn<Position>('Position', () => ({ x: 1, y: 2, z: 3 }));
    expect(w.getComponent<Position>('Position', id)?.x).toBe(1);
    expect(w.hasComponent('Velocity', id)).toBe(false);
    w.addComponent<Velocity>('Velocity', id, { vx: 0, vy: 1, vz: 0 });
    expect(w.hasComponent('Velocity', id)).toBe(true);
    w.removeComponent('Velocity', id);
    expect(w.hasComponent('Velocity', id)).toBe(false);
  });

  it('destroying an entity removes all components', () => {
    const w = new World();
    const id = w.createEntity();
    w.addComponent<Health>('Health', id, { hp: 10 });
    w.destroyEntity(id);
    expect(w.getComponent<Health>('Health', id)).toBeUndefined();
    expect(w.isAlive(id)).toBe(false);
  });
});

describe('ECS queries', () => {
  function makeWorld(n: number): World {
    const w = new World();
    for (let i = 0; i < n; i++) {
      const id = w.createEntity();
      w.addComponent<Position>('Position', id, { x: i, y: 0, z: 0 });
      if (i % 2 === 0) w.addComponent<Velocity>('Velocity', id, { vx: 1, vy: 0, vz: 0 });
    }
    return w;
  }

  it('query returns only entities with all components, ascending id', () => {
    const w = makeWorld(10);
    const q = w.query('Position', 'Velocity');
    expect(q.ids).toEqual([0, 2, 4, 6, 8]);
    const [pos, vel] = q.get(4) as [Position, Velocity];
    expect(pos.x).toBe(4);
    expect(vel.vx).toBe(1);
  });

  it('query with single component', () => {
    const w = makeWorld(5);
    const q = w.query('Position');
    expect(q.ids).toEqual([0, 1, 2, 3, 4]);
  });

  it('ComponentStore keys are ascending and stable', () => {
    const s = new ComponentStore<Position>('Position');
    s.add(5, { x: 0, y: 0, z: 0 });
    s.add(1, { x: 0, y: 0, z: 0 });
    s.add(9, { x: 0, y: 0, z: 0 });
    expect(s.keys()).toEqual([1, 5, 9]);
  });
});

describe('ECS systems & scheduler ordering', () => {
  it('runs systems in stage then order', () => {
    const w = new World();
    const log: string[] = [];
    w.registerSystem(SystemStage.Update, 20, 'b', () => log.push('b'));
    w.registerSystem(SystemStage.PreUpdate, 0, 'a', () => log.push('a'));
    w.registerSystem(SystemStage.Update, 5, 'c', () => log.push('c'));
    w.registerSystem(SystemStage.PostUpdate, 0, 'd', () => log.push('d'));
    for (let i = 0; i < 2; i++) w.step(1 / 60);
    // Order: stage asc, then order asc -> PreUpdate(a), Update[c(5),b(20)], PostUpdate(d)
    expect(log).toEqual(['a', 'c', 'b', 'd', 'a', 'c', 'b', 'd']);
    expect(w.tick).toBe(2);
  });

  it('a system can move entities by integrating velocity', () => {
    const w = new World();
    for (let i = 0; i < 3; i++) {
      const id = w.createEntity();
      w.addComponent<Position>('Position', id, { x: 0, y: 0, z: 0 });
      w.addComponent<Velocity>('Velocity', id, { vx: 1, vy: 0, vz: 0 });
    }
    w.registerSystem(SystemStage.Update, 0, 'integrate', (world, dt) => {
      const q = world.query('Position', 'Velocity');
      for (const id of q.ids) {
        const [p, v] = q.get(id) as [Position, Velocity];
        p.x += v.vx * dt;
      }
    });
    w.step(1); // dt = 1
    const first = w.getComponent<Position>('Position', w.query('Position').ids[0])!;
    expect(first.x).toBeCloseTo(1, 10);
    expect(w.tick).toBe(1);
  });
});
