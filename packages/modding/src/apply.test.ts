import { describe, it, expect } from 'vitest';
import type { World } from '@omega/engine-core';
import { World as CoreWorld } from '@omega/engine-core';
import { snapshotWorld } from '@omega/save';
import type { ModManifest } from './types.js';
import { applyMod, canonicalStringify } from './index.js';

/** Deterministic fixture: a fresh world with 3 entities sharing two components. */
function makeWorld(): World {
  const w = new CoreWorld();
  const a = w.createEntity();
  w.addComponent('PhysicsBody', a, { mass: 1, restitution: 0.1 });
  w.addComponent('Tag', a, { label: 'alpha' });
  const b = w.createEntity();
  w.addComponent('PhysicsBody', b, { mass: 2, restitution: 0.2 });
  const c = w.createEntity();
  w.addComponent('PhysicsBody', c, { mass: 3, restitution: 0.3 });
  w.addComponent('Tag', c, { label: 'gamma' });
  return w;
}

/** Stable snapshot key (canonical-JSON bytes) of the named stores. */
function snap(world: World): string {
  return canonicalStringify(snapshotWorld(world, ['PhysicsBody', 'Tag']));
}

const MANIFEST: ModManifest = {
  id: 'demo',
  version: '1.0.0',
  rules: [
    {
      id: 'boost',
      component: 'PhysicsBody',
      strategy: 'merge',
      value: { restitution: 0.9 },
    },
  ],
  content: [{ components: { PhysicsBody: { mass: 7, restitution: 0.7 }, Tag: { label: 'delta' } } }],
};

describe('applyMod — core semantics', () => {
  it('merge strategy overlays only the listed fields', () => {
    const w = makeWorld();
    applyMod(w, MANIFEST);
    expect(w.getComponent<{ mass: number; restitution: number }>('PhysicsBody', 0)).toEqual({
      mass: 1,
      restitution: 0.9,
    });
    // Untouched entity keeps its original mass.
    expect(w.getComponent<{ mass: number }>('PhysicsBody', 1)?.mass).toBe(2);
  });

  it('replace strategy swaps the whole component instance', () => {
    const w = makeWorld();
    applyMod(w, {
      id: 'r',
      version: '1',
      rules: [{ id: 'x', component: 'PhysicsBody', strategy: 'replace', value: { mass: 50 } }],
      content: [],
    });
    // `restitution` is gone after a full replace.
    expect(w.getComponent<{ mass: number; restitution?: number }>('PhysicsBody', 0)).toEqual({
      mass: 50,
    });
  });

  it('content patches append exactly the listed entities', () => {
    const w = makeWorld();
    applyMod(w, MANIFEST);
    expect(w.count()).toBe(4);
    const last = w.count() - 1;
    expect(w.getComponent<{ label: string }>('Tag', last)).toEqual({ label: 'delta' });
  });

  it('does not mutate the input manifest (value is copied, not referenced)', () => {
    const w = makeWorld();
    applyMod(w, MANIFEST);
    // The manifest's rule value must be untouched.
    expect(MANIFEST.rules[0].value).toEqual({ restitution: 0.9 });
  });
});

describe('applyMod — determinism', () => {
  it('same manifest + same world => identical result (byte-for-byte snapshot)', () => {
    const a = makeWorld();
    const b = makeWorld();
    applyMod(a, MANIFEST);
    applyMod(b, MANIFEST);
    expect(snap(a)).toBe(snap(b));
  });

  it('result is independent of the manifest rule array order', () => {
    const rulesA = [
      { id: 'z', component: 'PhysicsBody', strategy: 'merge' as const, value: { mass: 100 } },
      { id: 'a', component: 'PhysicsBody', strategy: 'merge' as const, value: { restitution: 0.5 } },
    ];
    const rulesB = [...rulesA].reverse();
    const m1: ModManifest = { id: 'o', version: '1', rules: rulesA, content: [] };
    const m2: ModManifest = { id: 'o', version: '1', rules: rulesB, content: [] };
    const w1 = makeWorld();
    const w2 = makeWorld();
    applyMod(w1, m1);
    applyMod(w2, m2);
    expect(snap(w1)).toBe(snap(w2));
  });

  it('priority is defined: higher priority wins regardless of array order', () => {
    const loFirst = {
      id: 'p',
      version: '1',
      rules: [
        { id: 'low', component: 'PhysicsBody', strategy: 'merge' as const, value: { mass: 100 }, priority: 10 },
        { id: 'high', component: 'PhysicsBody', strategy: 'merge' as const, value: { mass: 200 }, priority: 20 },
      ],
      content: [],
    };
    const hiFirst = {
      id: 'p',
      version: '1',
      rules: [...loFirst.rules].reverse(),
      content: [],
    };
    const w1 = makeWorld();
    const w2 = makeWorld();
    applyMod(w1, loFirst);
    applyMod(w2, hiFirst);
    expect(snap(w1)).toBe(snap(w2));
    // High priority (200) must be the final value on every PhysicsBody.
    expect(w1.getComponent<{ mass: number }>('PhysicsBody', 0)?.mass).toBe(200);
    expect(w1.getComponent<{ mass: number }>('PhysicsBody', 1)?.mass).toBe(200);
  });

  it('same priority ties are broken by id (stable, order-independent)', () => {
    const m: ModManifest = {
      id: 'tie',
      version: '1',
      rules: [
        { id: 'bbb', component: 'PhysicsBody', strategy: 'merge' as const, value: { mass: 11 }, priority: 0 },
        { id: 'aaa', component: 'PhysicsBody', strategy: 'merge' as const, value: { mass: 22 }, priority: 0 },
      ],
      content: [],
    };
    const reversed: ModManifest = { ...m, rules: [...m.rules].reverse() };
    const w1 = makeWorld();
    const w2 = makeWorld();
    applyMod(w1, m);
    applyMod(w2, reversed);
    // Sorted ascending by id: 'aaa' (mass 22) applies first, then 'bbb'
    // (mass 11) overwrites it — so 'bbb' wins. Independent of array order.
    expect(snap(w1)).toBe(snap(w2));
    expect(w1.getComponent<{ mass: number }>('PhysicsBody', 0)?.mass).toBe(11);
  });
});
