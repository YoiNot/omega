import { describe, it, expect } from 'vitest';
import { SystemScheduler } from './scheduler.js';
import { World } from './world.js';

describe('SystemScheduler', () => {
  it('runs systems in ascending priority order', () => {
    const sch = new SystemScheduler();
    const order: string[] = [];
    sch.register(() => order.push('low'), 100, 'low');
    sch.register(() => order.push('high'), 0, 'high');
    sch.register(() => order.push('mid'), 50, 'mid');
    const w = new World();
    sch.run(w, 1 / 60);
    expect(order).toEqual(['high', 'mid', 'low']);
  });

  it('ties are broken by registration order (deterministic)', () => {
    const sch = new SystemScheduler();
    const order: number[] = [];
    sch.register(() => order.push(0), 0);
    sch.register(() => order.push(1), 0);
    sch.register(() => order.push(2), 0);
    sch.run(new World(), 0.016);
    expect(order).toEqual([0, 1, 2]);
  });

  it('same registration => identical order across two schedulers', () => {
    const build = () => {
      const s = new SystemScheduler();
      const order: number[] = [];
      for (let i = 0; i < 5; i++) s.register(() => order.push(i), i % 2, `s${i}`);
      return { s, order };
    };
    const a = build();
    const b = build();
    a.s.run(new World(), 0.01);
    b.s.run(new World(), 0.01);
    expect(a.order).toEqual(b.order);
  });

  it('dt is passed through to every system', () => {
    const sch = new SystemScheduler();
    const dts: number[] = [];
    const w = new World();
    sch.register((_w, dt) => dts.push(dt), 0);
    sch.register((_w, dt) => dts.push(dt), 0);
    sch.run(w, 0.123);
    expect(dts).toEqual([0.123, 0.123]);
  });

  it('register returns and count reflects systems', () => {
    const sch = new SystemScheduler();
    sch.register(() => {}, 0);
    sch.register(() => {}, 1);
    expect(sch.count).toBe(2);
    sch.clear();
    expect(sch.count).toBe(0);
  });
});
