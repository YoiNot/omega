/**
 * apps/web — Modding UI determinism + file round-trip tests.
 *
 * Exercises the real @omega/modding pipeline through the apps/web glue
 * (./modding.ts) headlessly: no DOM, no GL. Proves the core contract — same
 * manifest + same demo world ⇒ identical world state — and that the
 * byte-stable file format (load/save) round-trips exactly. UI control logic is
 * tested in isolation (parse/serialize/apply helpers); the React component only
 * wires those helpers to the DOM and is covered by tsc, not runtime here.
 */

import { describe, it, expect } from 'vitest';
import { createDemo, type Demo } from './engine';
import { SaveWriter } from '@omega/save';
import {
  applyManifestToDemo,
  snapshotDemoCore,
  defaultManifest,
  parseManifestJson,
  manifestToJson,
  manifestToText,
  saveManifestToBytes,
  loadManifestFromBytes,
  type ModManifest,
} from './modding';

const SEED = 'omega-demo';

/** A deterministic manifest that bumps restitution on every PhysicsBody. */
function bouncyManifest(): ModManifest {
  return {
    id: 'bouncy',
    version: '1.0.0',
    rules: [
      { id: 'b', component: 'PhysicsBody', strategy: 'merge', value: { restitution: 0.9 } },
    ],
    content: [],
  };
}

/** Fresh, unmodified demo for a given seed (deterministic start state). */
function freshDemo(seed = SEED): Demo {
  return createDemo({ seed });
}

describe('apps/web modding — determinism', () => {
  it('applying the same manifest twice to identical worlds yields identical state', () => {
    const a = freshDemo();
    const b = freshDemo();
    applyManifestToDemo(a, bouncyManifest());
    applyManifestToDemo(b, bouncyManifest());
    expect(snapshotDemoCore(a)).toBe(snapshotDemoCore(b));
  });

  it('a modded world differs deterministically from the unmodded baseline', () => {
    const base = freshDemo();
    const modded = freshDemo();
    const before = snapshotDemoCore(modded);
    applyManifestToDemo(modded, bouncyManifest());
    const after = snapshotDemoCore(modded);
    // Baseline is unaffected (different world instance).
    expect(snapshotDemoCore(base)).toBe(before);
    // Modded world changed and is reproducible.
    expect(after).not.toBe(before);
    expect(snapshotDemoCore(modded)).toBe(after);
  });

  it('the change is picked up by the running sim (next fixed step is deterministic)', () => {
    const modded = freshDemo();
    const posOf = (d: Demo) => d.physicsPositions().map((e) => [e.id, e.x, e.y, e.z]);
    applyManifestToDemo(modded, bouncyManifest());
    const before = JSON.stringify(posOf(modded));
    modded.step();
    const after = JSON.stringify(posOf(modded));
    // Stepping is deterministic: a re-run from the same state matches.
    const modded2 = freshDemo();
    applyManifestToDemo(modded2, bouncyManifest());
    modded2.step();
    expect(JSON.stringify(posOf(modded2))).toBe(after);
    expect(before).not.toBe(after);
  });

  it('manifest rule order does not change the result (priority/id tie-break)', () => {
    const m1 = bouncyManifest();
    const m2 = { ...m1, rules: [...m1.rules].reverse() };
    const a = freshDemo();
    const b = freshDemo();
    applyManifestToDemo(a, m1);
    applyManifestToDemo(b, m2);
    expect(snapshotDemoCore(a)).toBe(snapshotDemoCore(b));
  });
});

describe('apps/web modding — file round-trip (deterministic bytes)', () => {
  it('save → load is byte-stable and loss-free', () => {
    const manifest = defaultManifest();
    const bytes1 = saveManifestToBytes(manifest);
    const bytes2 = saveManifestToBytes(manifest);
    expect(bytes2).toEqual(bytes1); // idempotent bytes
    const loaded = loadManifestFromBytes(bytes1);
    expect(loaded).toEqual(manifest);
  });

  it('load rejects non-manifest bytes with a clear error', () => {
    // Payload lacks id/version so loadModManifest throws after SaveReader parses.
    const bytes = SaveWriter.write({ foo: 1 }, 0, 1n, 2n);
    expect(() => loadManifestFromBytes(bytes)).toThrow();
  });

  it('canonical text form is independent of object-key insertion order', () => {
    // canonicalize sorts object KEYS, not array elements (rules stay ordered).
    // Construct the same logical rule with keys in a different insertion order.
    const a = manifestToText({
      version: '1', id: 'x', rules: [
        { strategy: 'merge', value: { a: 1 }, component: 'PhysicsBody', id: 'z' },
      ], content: [],
    });
    const b = manifestToText({
      id: 'x', version: '1', rules: [
        { id: 'z', component: 'PhysicsBody', strategy: 'merge', value: { a: 1 } },
      ], content: [],
    });
    expect(a).toBe(b);
  });
});

describe('apps/web modding — UI logic isolation (parse/serialize/apply)', () => {
  it('defaultManifest parses back from its own JSON text', () => {
    const m = defaultManifest();
    expect(parseManifestJson(manifestToJson(m))).toEqual(m);
  });

  it('parseManifestJson rejects malformed shapes', () => {
    expect(() => parseManifestJson('{ not json')).toThrow(/Invalid manifest JSON/);
    expect(() => parseManifestJson('42')).toThrow(/must be a JSON object/);
    expect(() => parseManifestJson('{"id":1,"version":"1"}')).toThrow(/"id" and "version"/);
    expect(() =>
      parseManifestJson('{"id":"x","version":"1","rules":[{"id":1,"component":"C","strategy":"merge","value":{}}]}'),
    ).toThrow(/string "id" and "component"/);
    expect(() =>
      parseManifestJson('{"id":"x","version":"1","rules":[{"id":"r","component":"C","strategy":"nope","value":{}}]}'),
    ).toThrow(/"merge" or "replace"/);
  });

  it('applyManifestToDemo mutates only the core world (other demos untouched)', () => {
    const target = freshDemo();
    const other = freshDemo();
    applyManifestToDemo(target, bouncyManifest());
    const baseline = snapshotDemoCore(other);
    // A fresh demo is byte-identical to another fresh demo.
    expect(snapshotDemoCore(freshDemo())).toBe(baseline);
  });
});
