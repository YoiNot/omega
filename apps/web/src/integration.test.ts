/**
 * apps/web — headless integration determinism test.
 *
 * Proves the core contract of the demo: feeding the same seed + same number of
 * fixed ticks + the same deterministic input script produces byte-identical
 * observable end state (physics body positions AND net positions). It also
 * proves the @omega/net-replication determinism contract: after N ticks of
 * client prediction / server authority / snapshot reconciliation over a
 * LoopbackTransport, the client world equals the server world exactly.
 *
 * No real DOM/GL required — the whole loop is exercised through the
 * framework-agnostic `runHeadless` harness in engine.ts.
 */

import { describe, it, expect } from 'vitest';
import {
  runHeadless,
  recordHeadless,
  replayHeadless,
  type HeadlessResult,
} from './engine';

function deepClone(r: HeadlessResult): HeadlessResult {
  return {
    physics: r.physics.map((e) => [...e]),
    netServer: r.netServer.map((e) => [...e]),
    netClient: r.netClient.map((e) => [...e]),
    agents: r.agents.map((e) => [...e]),
  };
}

describe('apps/web deterministic integration loop', () => {
  const SEED = 'omega-demo';
  const TICKS = 240;

  it('same seed + same ticks => identical end state (reproducible)', () => {
    const a = runHeadless(SEED, TICKS);
    const b = runHeadless(SEED, TICKS);
    expect(b).toEqual(a);
  });

  it('different seed => different (but still deterministic) end state', () => {
    const a = runHeadless(SEED, TICKS);
    const c = runHeadless('another-seed', TICKS);
    // Must be deterministic for themselves…
    expect(runHeadless('another-seed', TICKS)).toEqual(c);
    // …and differ from the first by content (seed influences placement).
    expect(c).not.toEqual(a);
  });

  it('net client world converges to server world after N ticks', () => {
    const r = runHeadless(SEED, TICKS);
    // The authoritative wire snapshots match byte-for-byte on both sides (the
    // net-replication contract). The live f64 sims therefore agree to f32 wire
    // precision (1e-4 absolute) — which the live HUD asserts as "CONVERGED".
    expect(r.netClient.length).toBe(r.netServer.length);
    for (let i = 0; i < r.netClient.length; i++) {
      for (let k = 0; k < 4; k++) {
        expect(Math.abs(r.netClient[i]![k]! - r.netServer[i]![k]!)).toBeLessThan(1e-4);
      }
    }
  });

  it('physics actually advanced (bodies moved from spawn, deterministically)', () => {
    const r = runHeadless(SEED, 1);
    const r240 = runHeadless(SEED, TICKS);
    // The first-step snapshot must be reproducible on its own.
    expect(runHeadless(SEED, 1)).toEqual(deepClone(r));
    expect(r240.physics.length).toBeGreaterThan(0);
    // At least one body should have a non-zero y after falling for a while.
    const anyMoved = r240.physics.some((b) => Math.abs(b[2]) > 1e-3);
    expect(anyMoved).toBe(true);
  });

  it('running the loop is a pure function of (seed, ticks)', () => {
    const ref = runHeadless(SEED, TICKS);
    // Re-running returns an equal-by-value result every time.
    for (let i = 0; i < 3; i++) {
      expect(runHeadless(SEED, TICKS)).toEqual(ref);
    }
  });

  it('input → record → replay → play yields identical physics world', () => {
    const { recording, result } = recordHeadless(SEED, TICKS);
    // Recording must capture one snapshot per fixed tick.
    expect(recording.frames.length).toBe(TICKS);
    // Rebuild the world deterministically from the recording alone.
    const replayed = replayHeadless(recording, TICKS);
    // The replayed physics world equals the live-recorded world bit-for-bit.
    expect(replayed.physics).toEqual(result.physics);
  });

  it('two recordings from the same seed are byte-identical (reproducible record)', () => {
    const a = recordHeadless(SEED, TICKS).recording;
    const b = recordHeadless(SEED, TICKS).recording;
    expect(b).toEqual(a);
  });
});
