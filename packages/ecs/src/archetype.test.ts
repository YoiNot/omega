import { describe, it, expect } from 'vitest';
import { EntityRegistry, Archetype } from './archetype.js';
import { defineComponent } from './storage.js';

const Pos = defineComponent<{ x: number }>('position');
const Vel = defineComponent<{ dx: number }>('velocity');
const Tag = defineComponent<{}>('tag');

describe('EntityRegistry — entity lifecycle', () => {
  it('allocates ids from a monotonic counter', () => {
    const r = new EntityRegistry();
    expect(r.createEntity()).toBe(0);
    expect(r.createEntity()).toBe(1);
    expect(r.createEntity()).toBe(2);
    expect(r.count).toBe(3);
  });

  it('reuses destroyed ids in FIFO (deterministic) order', () => {
    const r = new EntityRegistry();
    const a = r.createEntity(); // 0
    const b = r.createEntity(); // 1
    const c = r.createEntity(); // 2
    r.destroyEntity(b); // free 1
    r.destroyEntity(a); // free 0  -> queue [1, 0]
    const x = r.createEntity(); // reuse 1 (oldest freed)
    const y = r.createEntity(); // reuse 0
    expect(x).toBe(1);
    expect(y).toBe(0);
    expect(c).toBe(2);
    expect(r.count).toBe(3);
  });

  it('destroy is idempotent for unknown/already-dead ids', () => {
    const r = new EntityRegistry();
    const a = r.createEntity();
    r.destroyEntity(a);
    expect(() => r.destroyEntity(a)).not.toThrow();
    expect(r.count).toBe(0);
    expect(r.isAlive(a)).toBe(false);
  });
});

describe('EntityRegistry — archetype transitions', () => {
  it('attach/detach moves an entity between archetypes', () => {
    const r = new EntityRegistry();
    const e = r.createEntity();
    r.attach(e, Pos);
    expect(r.hasComponent(Pos, e)).toBe(true);
    // with only Pos it lives in the [Pos] archetype
    expect(r.entitiesWithAll([Pos])).toEqual([e]);
    expect(r.entitiesWithAll([Vel])).toEqual([]);

    r.attach(e, Vel);
    expect(r.entitiesWithAll([Pos, Vel])).toEqual([e]);

    r.detach(e, Vel);
    expect(r.entitiesWithAll([Pos, Vel])).toEqual([]);
    expect(r.entitiesWithAll([Pos])).toEqual([e]);
  });

  it('detaching all components returns an entity to the empty archetype', () => {
    const r = new EntityRegistry();
    const e = r.createEntity();
    r.attach(e, Tag);
    expect(r.entitiesWithAll([Tag])).toEqual([e]);
    r.detach(e, Tag);
    expect(r.entitiesWithAll([Tag])).toEqual([]);
    expect(r.allEntities()).toEqual([e]); // still alive, just untyped
  });

  it('destroying an entity removes it from its archetype and components', () => {
    const r = new EntityRegistry();
    const e = r.createEntity();
    r.attach(e, Pos);
    r.setComponent(Pos, e, { x: 5 });
    r.destroyEntity(e);
    expect(r.isAlive(e)).toBe(false);
    expect(r.entitiesWithAll([Pos])).toEqual([]);
    expect(r.hasComponent(Pos, e)).toBe(false);
  });

  it('deterministic ascending-id iteration across archetypes', () => {
    const r = new EntityRegistry();
    const ids = [r.createEntity(), r.createEntity(), r.createEntity(), r.createEntity()];
    // give various signatures; all should sort by id regardless
    r.attach(ids[0], Pos);
    r.attach(ids[1], Pos);
    r.attach(ids[1], Vel);
    r.attach(ids[3], Pos);
    expect(r.entitiesWithAll([Pos])).toEqual([ids[0], ids[1], ids[3]]);
    expect(r.entitiesWithAll([Pos, Vel])).toEqual([ids[1]]);
    expect(r.allEntities()).toEqual([0, 1, 2, 3]);
  });

  it('empty query (no components) returns all live entities', () => {
    const r = new EntityRegistry();
    const a = r.createEntity();
    r.createEntity();
    r.attach(a, Pos);
    expect(r.entitiesWithAll([]).sort((x, y) => x - y).length).toBe(2);
  });
});

describe('Archetype', () => {
  it('keeps entities sorted by id on insert/remove', () => {
    const arch = new Archetype([Pos, Vel]);
    arch.add(5);
    arch.add(1);
    arch.add(3);
    expect(arch.entities).toEqual([1, 3, 5]);
    arch.remove(3);
    expect(arch.entities).toEqual([1, 5]);
  });

  it('containsAll checks the component signature', () => {
    const arch = new Archetype([Pos, Vel]);
    expect(arch.containsAll([Pos.id, Vel.id])).toBe(true);
    expect(arch.containsAll([Pos.id])).toBe(true);
    expect(arch.containsAll([Pos.id, Vel.id, Tag.id])).toBe(false);
  });
});
