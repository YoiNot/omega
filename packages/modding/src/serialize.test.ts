import { describe, it, expect } from 'vitest';
import type { ModManifest } from './types.js';
import { saveModManifest, loadModManifest, manifestToCanonicalString } from './index.js';

function baseManifest(): ModManifest {
  return {
    id: 'demo',
    version: '1.0.0',
    rules: [
      {
        id: 'boost',
        component: 'PhysicsBody',
        strategy: 'merge',
        // Intentionally one key order here...
        value: { mass: 100, restitution: 0.5 },
        priority: 5,
      },
    ],
    content: [{ components: { PhysicsBody: { mass: 7, restitution: 0.7 }, Tag: { label: 'delta' } } }],
  };
}

function reorderedManifest(): ModManifest {
  // ...and the opposite key order here. Logically identical, different insertion.
  return {
    id: 'demo',
    version: '1.0.0',
    rules: [
      {
        id: 'boost',
        component: 'PhysicsBody',
        strategy: 'merge',
        value: { restitution: 0.5, mass: 100 },
        priority: 5,
      },
    ],
    content: [{ components: { Tag: { label: 'delta' }, PhysicsBody: { restitution: 0.7, mass: 7 } } }],
  };
}

describe('serialize — round-trip', () => {
  it('save -> load restores a deep-equal manifest', () => {
    const m = baseManifest();
    const m2 = loadModManifest(saveModManifest(m));
    expect(m2).toEqual(m);
  });

  it('load normalizes missing rule/content arrays to empty', () => {
    const partial = saveModManifest({ id: 'x', version: '1' } as unknown as ModManifest);
    const loaded = loadModManifest(partial);
    expect(loaded.rules).toEqual([]);
    expect(loaded.content).toEqual([]);
    expect(loaded.id).toBe('x');
  });

  it('throws on a non-manifest byte stream', () => {
    expect(() => loadModManifest(new Uint8Array([0, 1, 2, 3, 4, 5]))).toThrow();
  });
});

describe('serialize — byte stability (deterministic format)', () => {
  it('key-insertion-order does not change the byte output', () => {
    const a = saveModManifest(baseManifest());
    const b = saveModManifest(reorderedManifest());
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it('canonical string form is order-independent too', () => {
    expect(manifestToCanonicalString(baseManifest())).toBe(
      manifestToCanonicalString(reorderedManifest()),
    );
  });

  it('serialization is idempotent at the byte level (save == save of loaded)', () => {
    const bytes = saveModManifest(baseManifest());
    const reload = loadModManifest(bytes);
    const bytes2 = saveModManifest(reload);
    expect(Array.from(bytes)).toEqual(Array.from(bytes2));
  });
});
