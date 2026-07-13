import { describe, it, expect } from 'vitest';
import type { World } from '@omega/engine-core';
import { World as CoreWorld } from '@omega/engine-core';
import { snapshotWorld } from '@omega/save';
import { canonicalStringify } from './canon.js';
import { sandboxMod, EVERYWHERE, type SandboxModManifest } from './sandbox.js';

/** Deterministic world: two PhysicsBody entities + one Tag-only entity. */
function makeWorld(): World {
  const w = new CoreWorld();
  const a = w.createEntity();
  w.addComponent('PhysicsBody', a, { mass: 1, restitution: 0.1 });
  w.addComponent('Tag', a, { label: 'alpha' });
  const b = w.createEntity();
  w.addComponent('PhysicsBody', b, { mass: 2, restitution: 0.2 });
  return w;
}

/** The input world must be untouched (isolation). */
function worldSignature(w: World): string {
  return canonicalStringify(snapshotWorld(w, ['PhysicsBody', 'Tag']));
}

describe('sandboxMod — isolation', () => {
  it('does not mutate the input world', () => {
    const w = makeWorld();
    const before = worldSignature(w);
    const manifest: SandboxModManifest = {
      id: 'safe',
      version: '1.0.0',
      rules: [{ id: 'r', component: 'PhysicsBody', strategy: 'merge', value: { restitution: 0.9 }, priority: 0 }],
      content: [{ components: { PhysicsBody: { mass: 9 }, Tag: { label: 'new' } } }],
      allowedComponents: ['PhysicsBody'],
      allowedContentComponents: ['PhysicsBody', 'Tag'],
      allowedEntities: EVERYWHERE,
    };
    sandboxMod(w, manifest);
    expect(worldSignature(w)).toBe(before);
  });
});

describe('sandboxMod — declared-only changes are safe', () => {
  it('passes a well-scoped manifest with @everywhere entities', () => {
    const w = makeWorld();
    const result = sandboxMod(w, {
      id: 'ok',
      version: '1.0.0',
      rules: [{ id: 'r', component: 'PhysicsBody', strategy: 'merge', value: { restitution: 0.9 } }],
      content: [{ components: { PhysicsBody: { mass: 9 } } }],
      allowedComponents: ['PhysicsBody'],
      allowedContentComponents: ['PhysicsBody'],
      allowedEntities: EVERYWHERE,
    });
    expect(result.valid).toBe(true);
    expect(result.safe).toBe(true);
    expect(result.violations).toEqual([]);
    expect(result.changes.length).toBeGreaterThan(0);
  });

  it('passes a manifest that only touches declared entities', () => {
    const w = makeWorld();
    // The PhysicsBody rule hits both entities 0 and 1 (every PhysicsBody); both
    // must be declared for the sandbox to accept it.
    const result = sandboxMod(w, {
      id: 'ok',
      version: '1.0.0',
      rules: [{ id: 'r', component: 'PhysicsBody', strategy: 'merge', value: { mass: 100 } }],
      content: [],
      allowedComponents: ['PhysicsBody'],
      allowedContentComponents: [],
      allowedEntities: [0, 1],
    });
    expect(result.safe).toBe(true);
    expect(result.changes.every((c) => c.entity === 0 || c.entity === 1)).toBe(true);
  });
});

describe('sandboxMod — undeclared changes are detected (deterministic)', () => {
  it('flags a rule that modifies a component not in allowedComponents', () => {
    const w = makeWorld();
    const result = sandboxMod(w, {
      id: 'bad',
      version: '1.0.0',
      rules: [{ id: 'r', component: 'Tag', strategy: 'merge', value: { label: 'hacked' } }],
      content: [],
      allowedComponents: ['PhysicsBody'], // Tag NOT allowed
      allowedContentComponents: [],
    });
    expect(result.valid).toBe(true); // structurally valid…
    expect(result.safe).toBe(false); // …but sandbox-invalid
    expect(result.violations.some((v) => v.includes('Tag') && v.includes('allowedComponents'))).toBe(true);
  });

  it('flags content adding an undeclared component', () => {
    const w = makeWorld();
    const result = sandboxMod(w, {
      id: 'bad',
      version: '1.0.0',
      rules: [],
      content: [{ components: { Forbidden: { x: 1 } } }],
      allowedComponents: [],
      allowedContentComponents: ['PhysicsBody'], // Forbidden NOT allowed
    });
    expect(result.safe).toBe(false);
    expect(result.violations.some((v) => v.includes('Forbidden') && v.includes('allowedContentComponents'))).toBe(true);
  });

  it('flags a rule modifying an undeclared entity', () => {
    const w = makeWorld();
    const result = sandboxMod(w, {
      id: 'bad',
      version: '1.0.0',
      rules: [{ id: 'r', component: 'PhysicsBody', strategy: 'merge', value: { mass: 100 } }],
      content: [],
      allowedComponents: ['PhysicsBody'],
      allowedContentComponents: [],
      allowedEntities: [1], // only entity 1 declared; rule hits entity 0 too
    });
    expect(result.safe).toBe(false);
    expect(result.violations.some((v) => v.includes('entity 0') && v.includes('allowedEntities'))).toBe(true);
  });

  it('EVERYWHERE on allowedComponents permits any component', () => {
    const w = makeWorld();
    const result = sandboxMod(w, {
      id: 'wide',
      version: '1.0.0',
      rules: [{ id: 'r', component: 'Tag', strategy: 'merge', value: { label: 'z' } }],
      content: [],
      allowedComponents: EVERYWHERE,
      allowedContentComponents: EVERYWHERE,
      allowedEntities: EVERYWHERE,
    });
    expect(result.safe).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it('the same manifest+world yields identical violations (determinism)', () => {
    const build = (): SandboxModManifest => ({
      id: 'bad',
      version: '1.0.0',
      rules: [
        { id: 'r1', component: 'Tag', strategy: 'merge', value: { label: 'x' } },
        { id: 'r2', component: 'PhysicsBody', strategy: 'merge', value: { mass: 5 } },
      ],
      content: [{ components: { Forbidden: { x: 1 } } }],
      allowedComponents: ['PhysicsBody'],
      allowedContentComponents: ['PhysicsBody'],
      allowedEntities: [1],
    });
    const w = makeWorld();
    const a = sandboxMod(w, build());
    const w2 = makeWorld();
    const b = sandboxMod(w2, build());
    expect(a.violations).toEqual(b.violations);
    // Stable composition: Tag/Forbidden not in component allow-lists (2), plus
    // the r1/r2 modifications to entity 0 (which is not in allowedEntities [1]).
    expect(a.violations.length).toBe(4);
  });

  it('rejects a structurally invalid manifest without applying', () => {
    const w = makeWorld();
    const result = sandboxMod(w, {
      id: '',
      version: '1.0.0',
      rules: [],
      content: [],
      allowedComponents: EVERYWHERE,
      allowedContentComponents: EVERYWHERE,
    } as SandboxModManifest);
    expect(result.valid).toBe(false);
    expect(result.safe).toBe(false);
    expect(result.validationErrors.length).toBeGreaterThan(0);
    expect(result.changes).toEqual([]);
  });
});
