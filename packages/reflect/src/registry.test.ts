import { describe, it, expect } from 'vitest';
import {
  TypeRegistry,
  defaultRegistry,
  defineType,
  fromComponentDef,
} from './registry.js';
import { defineComponent } from '@omega/ecs';

describe('TypeRegistry', () => {
  it('assigns stable ids in first-registration order starting at 0', () => {
    const r = new TypeRegistry();
    const a = r.register('position');
    const b = r.register('velocity');
    const c = r.register('health');
    expect(a.id).toBe(0);
    expect(b.id).toBe(1);
    expect(c.id).toBe(2);
    expect(a.name).toBe('position');
  });

  it('is idempotent: re-registering a name keeps the same id', () => {
    const r = new TypeRegistry();
    const first = r.register('position');
    const second = r.register('position');
    expect(second).toBe(first);
    expect(second.id).toBe(first.id);
    expect(r.size).toBe(1);
  });

  it('round-trips name <-> id <-> name', () => {
    const r = new TypeRegistry();
    r.register('position');
    r.register('velocity');
    const id = r.idOf('velocity')!;
    expect(r.nameOf(id)).toBe('velocity');
    // Unknown id -> undefined, does not throw.
    expect(r.nameOf(999)).toBeUndefined();
    expect(r.idOf('nope')).toBeUndefined();
  });

  it('all() returns types in ascending id order', () => {
    const r = new TypeRegistry();
    r.register('c');
    r.register('a');
    r.register('b');
    expect(r.all().map((t) => t.name)).toEqual(['c', 'a', 'b']);
    expect(r.all().map((t) => t.id)).toEqual([0, 1, 2]);
  });

  it('define() returns clone-safe id+name token', () => {
    const r = new TypeRegistry();
    const tok = r.define<{ x: number }>('position');
    expect(tok.id).toBe(0);
    expect(tok.name).toBe('position');
    // Token is plain data: survives structuredClone (worker transport).
    const clone = structuredClone(tok);
    expect(clone).toEqual(tok);
  });

  it('same registration sequence gives identical ids across two registries', () => {
    const build = () => {
      const r = new TypeRegistry();
      r.register('a');
      r.register('b');
      r.register('c');
      return r;
    };
    const x = build();
    const y = build();
    expect(x.all()).toEqual(y.all());
  });

  it('defaultRegistry + defineType is globally stable and idempotent', () => {
    const t = defineType('reflect.test.global');
    const t2 = defineType('reflect.test.global');
    expect(t.id).toBe(t2.id);
    expect(t.name).toBe('reflect.test.global');
    defaultRegistry.clear(); // keep global registry clean
  });

  it('fromComponentDef preserves the ecs-assigned id', () => {
    const def = defineComponent<{ x: number }>('reflect.test.position');
    const tok = fromComponentDef(def);
    expect(tok.id).toBe(def.id);
    expect(tok.name).toBe(def.name);
    defaultRegistry.clear();
  });
});
