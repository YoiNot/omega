import { describe, it, expect } from 'vitest';
import { EventBus } from './events.js';
import { World, SystemStage } from './ecs.js';
import { Scheduler, Scheduler as S } from './scheduler.js';

describe('EventBus', () => {
  it('delivers to subscribers in registration order', () => {
    const bus = new EventBus<{ tick: number }>();
    const order: number[] = [];
    bus.on('tick', () => order.push(1));
    bus.on('tick', () => order.push(2));
    bus.emit('tick', 0);
    expect(order).toEqual([1, 2]);
  });

  it('off unsubscribes', () => {
    const bus = new EventBus<{ e: string }>();
    let count = 0;
    const off = bus.on('e', () => count++);
    bus.emit('e', '');
    off();
    bus.emit('e', '');
    expect(count).toBe(1);
  });

  it('unknown event types are safe no-ops', () => {
    const bus = new EventBus<{ a: number }>();
    expect(() => bus.emit('a', 1)).not.toThrow();
  });
});

describe('Scheduler fixed-timestep', () => {
  it('accumulates and runs whole steps', () => {
    const w = new World();
    const sched = new Scheduler(w, { fixedDt: 1 / 10, maxSteps: 10 });
    sched.update(0.25); // 2.5 steps
    expect(w.tick).toBe(2);
    expect(sched.stepsSinceLastUpdate).toBe(2);
    expect(sched.alpha).toBeGreaterThan(0);
    expect(sched.alpha).toBeLessThan(1);
  });

  it('caps steps to prevent spiral of death', () => {
    const w = new World();
    const sched = new Scheduler(w, { fixedDt: 1 / 60, maxSteps: 5 });
    sched.update(100); // absurd frame gap
    expect(w.tick).toBe(5);
    expect(sched.alpha).toBe(0); // accumulator reset
  });

  it('zero dt runs no steps', () => {
    const w = new World();
    const sched = new Scheduler(w);
    sched.update(0);
    expect(w.tick).toBe(0);
  });

  it('reset clears accumulator', () => {
    const w = new World();
    const sched = new S(w);
    sched.update(0.1);
    sched.reset();
    expect(sched.alpha).toBe(0);
    expect(sched.stepsSinceLastUpdate).toBe(0);
  });
});

describe('Round-trip: ECS + Scheduler integration', () => {
  it('reproduces identical state for identical frame inputs', () => {
    function build(): { w: World; s: Scheduler } {
      const w = new World();
      for (let i = 0; i < 4; i++) {
        const id = w.createEntity();
        w.addComponent('Position', id, { x: 0, y: 0, z: 0 });
        w.addComponent('Velocity', id, { vx: i + 1, vy: 0, vz: 0 });
      }
      w.registerSystem(SystemStage.Update, 0, 'move', (world, dt) => {
        const q = world.query('Position', 'Velocity');
        for (const id of q.ids) {
          const p = world.getComponent<any>('Position', id)!;
          const v = world.getComponent<any>('Velocity', id)!;
          p.x += v.vx * dt;
        }
      });
      return { w, s: new Scheduler(w, { fixedDt: 1 / 60, maxSteps: 20 }) };
    }
    const a = build();
    const b = build();
    const frames = [0.016, 0.016, 0.033, 0.016];
    for (const f of frames) { a.s.update(f); b.s.update(f); }
    const qa = a.w.query('Position');
    const qb = b.w.query('Position');
    expect(qa.ids).toEqual(qb.ids);
    for (const id of qa.ids) {
      const pa = a.w.getComponent<any>('Position', id)!;
      const pb = b.w.getComponent<any>('Position', id)!;
      expect(pa.x).toBeCloseTo(pb.x, 12);
    }
  });
});
