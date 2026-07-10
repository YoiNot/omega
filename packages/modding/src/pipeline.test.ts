import { describe, it, expect, vi } from 'vitest';
import type { World } from '@omega/engine-core';
import { World as CoreWorld } from '@omega/engine-core';
import { snapshotWorld } from '@omega/save';
import type { ModManifest } from './types.js';
import {
  applyMod,
  saveModManifest,
  loadModManifest,
  canonicalStringify,
} from './index.js';

function makeWorld(): World {
  const w = new CoreWorld();
  const a = w.createEntity();
  w.addComponent('PhysicsBody', a, { mass: 1, restitution: 0.1 });
  w.addComponent('Tag', a, { label: 'alpha' });
  const b = w.createEntity();
  w.addComponent('PhysicsBody', b, { mass: 2, restitution: 0.2 });
  return w;
}

const MANIFEST: ModManifest = {
  id: 'pipeline',
  version: '2.3.1',
  rules: [
    { id: 'r1', component: 'PhysicsBody', strategy: 'merge', value: { restitution: 0.95 }, priority: 1 },
    { id: 'r2', component: 'Tag', strategy: 'merge', value: { label: 'MODDED' } },
  ],
  content: [
    { components: { PhysicsBody: { mass: 9, restitution: 0.9 }, Tag: { label: 'new' } } },
    { components: { Tag: { label: 'another' } } },
  ],
};

function runPipeline(): { worldSnap: string; bytes: Uint8Array } {
  const world = makeWorld();
  applyMod(world, MANIFEST);
  const worldSnap = canonicalStringify(snapshotWorld(world, ['PhysicsBody', 'Tag']));
  // Serialize -> reload -> re-apply to a FRESH world (the load/apply loop).
  const bytes = saveModManifest(MANIFEST);
  const reloaded = loadModManifest(bytes);
  const world2 = makeWorld();
  applyMod(world2, reloaded);
  const worldSnap2 = canonicalStringify(snapshotWorld(world2, ['PhysicsBody', 'Tag']));
  expect(worldSnap2).toBe(worldSnap); // loaded+applied == original+applied
  return { worldSnap, bytes };
}

describe('pipeline — load/apply/serialize/load/apply idempotency', () => {
  it('bytes are byte-stable across a save->load->save round trip', () => {
    const { bytes } = runPipeline();
    const reloaded = loadModManifest(bytes);
    const bytes2 = saveModManifest(reloaded);
    expect(Array.from(bytes)).toEqual(Array.from(bytes2));
  });

  it('two fully independent pipeline runs produce identical bytes and world', () => {
    const a = runPipeline();
    const b = runPipeline();
    expect(a.worldSnap).toBe(b.worldSnap);
    expect(Array.from(a.bytes)).toEqual(Array.from(b.bytes));
  });

  it('is clock-independent (no Date.now leaks): fake two timestamps, identical output', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(0);
      const atZero = runPipeline();
      vi.setSystemTime(1_000_000_000_000);
      const atFar = runPipeline();
      expect(atZero.worldSnap).toBe(atFar.worldSnap);
      expect(Array.from(atZero.bytes)).toEqual(Array.from(atFar.bytes));
    } finally {
      vi.useRealTimers();
    }
  });
});
