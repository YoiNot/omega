import { describe, it, expect } from 'vitest';
import { EntityRegistry } from './archetype.js';
import { Query } from './query.js';
import { defineComponent } from './storage.js';

const Pos = defineComponent<{ x: number }>('position');
const Vel = defineComponent<{ dx: number }>('velocity');

function setup() {
  const r = new EntityRegistry();
  // e0: Pos + Vel
  const e0 = r.createEntity();
  r.attach(e0, Pos);
  r.attach(e0, Vel);
  r.setComponent(Pos, e0, { x: 0 });
  r.setComponent(Vel, e0, { dx: 1 });
  // e1: Pos only
  const e1 = r.createEntity();
  r.attach(e1, Pos);
  r.setComponent(Pos, e1, { x: 10 });
  // e2: no components
  r.createEntity();
  return { r, e0, e1 };
}

describe('Query', () => {
  it('returns only entities with ALL required components', () => {
    const { r } = setup();
    const q = new Query(r, Pos, Vel);
    expect(q.entities().sort((a, b) => a - b)).toEqual([0]); // only e0
  });

  it('returns entities with a single required component', () => {
    const { r } = setup();
    const q = new Query(r, Pos);
    expect(q.entities().sort((a, b) => a - b)).toEqual([0, 1]);
  });

  it('iteration is id-sorted and passes components in query order', () => {
    const { r, e0 } = setup();
    const seen: Array<[number, { x: number }, { dx: number }]> = [];
    new Query(r, Pos, Vel).each((id, pos, vel) => {
      seen.push([id, pos, vel]);
    });
    expect(seen).toEqual([[e0, { x: 0 }, { dx: 1 }]]);
  });

  it('empty set is handled without errors', () => {
    const r = new EntityRegistry();
    r.createEntity();
    const q = new Query(r, Pos);
    expect(q.entities()).toEqual([]);
    expect(q.size).toBe(0);
    let calls = 0;
    q.each(() => {
      calls++;
    });
    expect(calls).toBe(0);
  });

  it('size reflects the matched entity count', () => {
    const { r } = setup();
    expect(new Query(r, Pos).size).toBe(2);
    expect(new Query(r, Pos, Vel).size).toBe(1);
  });
});
