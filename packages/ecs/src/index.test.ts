import { describe, it, expect } from 'vitest';
import * as ecs from './index.js';

describe('index exports', () => {
  it('exposes core public symbols', () => {
    expect(typeof ecs.defineComponent).toBe('function');
    expect(typeof ecs.SparseSet).toBe('function');
    expect(typeof ecs.ComponentStore).toBe('function');
    expect(typeof ecs.Archetype).toBe('function');
    expect(typeof ecs.EntityRegistry).toBe('function');
    expect(typeof ecs.Query).toBe('function');
    expect(typeof ecs.SystemScheduler).toBe('function');
    expect(typeof ecs.World).toBe('function');
  });

  it('can build a working world purely from the barrel', () => {
    const Pos = ecs.defineComponent<{ x: number }>('position');
    const w = new ecs.World();
    const e = w.createEntity();
    w.addComponent(e, Pos, { x: 1 });
    const q = w.query(Pos);
    expect(q.size).toBe(1);
    expect(q.entities()).toEqual([e]);
  });
});
