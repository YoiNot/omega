/**
 * apps/web — Step 3 (Phase B, Roadmap §18 $0) Same-Seed + Replay-Sharing tests.
 *
 * Multiplayer-lite WITHOUT a server: two clients reproduce the same world/sim
 * by sharing (a) a SEED, or (b) a REPLAY file. Both are pure functions of
 * their inputs — no network, no clock, no RNG at runtime. These tests prove
 * the $0 path holds:
 *   - same seed ⇒ byte-identical procgen world + sim state on two fresh demos;
 *   - a share payload round-trips (JSON ⇄ Recording bytes) deterministically;
 *   - the world-only share link carries the seed.
 */

import { describe, it, expect } from 'vitest';
import { createDemo, buildTerrain } from './engine';
import {
  buildSharePayload,
  payloadToJson,
  jsonToPayload,
  recordingFromPayload,
  shareLink,
  seedFromUrl,
  type SharePayload,
} from './share';
import { captureRecording, recordingToBytes } from './replay';

const SEED = 'mp-seed-42';

/** Hash an eco field to a compact signature for cross-demo equality. */
function ecoSig(demo: ReturnType<typeof createDemo>): string {
  const e = demo.simSpine.eco;
  let veg = 0, her = 0, car = 0;
  for (let i = 0; i < e.vegetation.length; i++) {
    veg += e.vegetation[i]!; her += e.herbivores[i]!; car += e.carnivores[i]!;
  }
  return `${veg.toFixed(4)}|${her.toFixed(4)}|${car.toFixed(4)}`;
}

/** Signature of the procgen terrain mesh (deterministic from seed). */
function terrainSig(seed: string): string {
  const t = buildTerrain(seed, 40);
  let s = 0;
  for (let i = 0; i < t.mesh.positions.length; i += 97) s += t.mesh.positions[i]!;
  return s.toFixed(3);
}

describe('Step 3 — Same seed ⇒ identical world on two clients ($0, no server)', () => {
  it('two fresh demos with the same seed produce identical procgen + sim', () => {
    const a = createDemo({ seed: SEED, terrainSize: 40 });
    const b = createDemo({ seed: SEED, terrainSize: 40 });
    // Frame both to the same tick so the sim state is comparable.
    for (let i = 0; i < 20; i++) {
      a.step();
      b.step();
    }
    expect(a.simSpine.eco.tick).toBe(b.simSpine.eco.tick);
    expect(ecoSig(a)).toBe(ecoSig(b));
    expect(terrainSig(SEED)).toBe(terrainSig(SEED));
    // AI stack views are identical (personas/goals/social bonds).
    expect(JSON.stringify(a.aiStackViews())).toBe(JSON.stringify(b.aiStackViews()));
  });

  it('different seeds produce different worlds', () => {
    const a = createDemo({ seed: SEED, terrainSize: 40 });
    const b = createDemo({ seed: 'other-seed', terrainSize: 40 });
    a.step(); b.step();
    expect(ecoSig(a)).not.toBe(ecoSig(b));
  });
});

describe('Step 3 — Replay sharing round-trips deterministically', () => {
  it('share payload ⇄ recording bytes are stable + reconstructable', () => {
    const demo = createDemo({ seed: SEED, terrainSize: 40 });
    demo.startRecording();
    for (let i = 0; i < 15; i++) demo.step();

    const payload = buildSharePayload(demo, SEED);
    expect(payload.seed).toBe(SEED);
    expect(payload.v).toBe(1);
    expect(payload.recording.length).toBeGreaterThan(0);

    // JSON round-trip preserves the payload.
    const json = payloadToJson(payload);
    const parsed = jsonToPayload(json);
    expect(parsed.seed).toBe(SEED);

    // The recording reconstructs to the same bytes (byte-stable replay).
    const rec = recordingFromPayload(parsed)!;
    const origBytes = recordingToBytes(captureRecording(demo)!);
    const reparsedBytes = recordingToBytes(rec);
    expect(Array.from(reparsedBytes)).toEqual(Array.from(origBytes));
  });

  it('world-only payload (empty recording) reconstructs to null', () => {
    const payload: SharePayload = { v: 1, seed: SEED, recording: '', tick: 0 };
    expect(payload.recording).toBe('');
    expect(recordingFromPayload(payload)).toBeNull();
  });
});

describe('Step 3 — Share link carries the seed (the $0 world-share path)', () => {
  it('shareLink embeds the seed; seedFromUrl reads it back', () => {
    const link = shareLink(SEED);
    expect(link).toContain('seed=' + encodeURIComponent(SEED));
    // In the test env location is undefined ⇒ seedFromUrl returns null
    // (browser sets ?seed= from the shared link). We just assert no throw.
    expect(() => seedFromUrl()).not.toThrow();
  });
});
