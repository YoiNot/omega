/**
 * apps/web — replay determinism for the full vertical slice.
 *
 * The existing integration.test.ts already proves the physics record→replay
 * identity. This file extends the proof to the AI: the @omega/replay Recorder
 * now snapshots BOTH the physics bodies and the GOAP agent components every
 * tick, and Playback must reconstruct the agents' tile-by-tile motion
 * bit-for-bit — record → save → load → play yields identical world states.
 */

import { describe, it, expect } from 'vitest';
import {
  runHeadless,
  recordHeadless,
  replayHeadless,
} from './engine';
import { serializeRecording, loadRecording } from '@omega/replay';

describe('apps/web vertical-slice replay determinism', () => {
  const SEED = 'omega-demo';
  const TICKS = 120;

  it('the run spawns GOAP agents and advances them deterministically', () => {
    const a = runHeadless(SEED, TICKS);
    const b = runHeadless(SEED, TICKS);
    expect(a.agents.length).toBeGreaterThan(0);
    // Whole observable state (physics + net + agents) is reproducible.
    expect(b).toEqual(a);
  });

  it('agents actually moved from spawn (nav executed)', () => {
    const early = runHeadless(SEED, 1);
    const late = runHeadless(SEED, TICKS);
    // At least one agent changed tile between tick 1 and tick TICKS.
    const moved = late.agents.some((a, i) => {
      const e = early.agents[i]!;
      return a[1] !== e[1] || a[2] !== e[2];
    });
    expect(moved).toBe(true);
  });

  it('record → save → load → play rebuilds physics AND agents bit-for-bit', () => {
    const { recording, result } = recordHeadless(SEED, TICKS);
    expect(recording.frames.length).toBe(TICKS);
    // Round-trip the recording through the byte file format.
    const bytes = serializeRecording(recording, 0);
    const loaded = loadRecording(bytes);
    // Playback from the loaded recording reconstructs the world tick-for-tick.
    const replayed = replayHeadless(loaded, TICKS);
    expect(replayed.physics).toEqual(result.physics);
    expect(replayed.agents).toEqual(result.agents);
  });

  it('two recordings from the same seed are byte-identical', () => {
    const a = serializeRecording(recordHeadless(SEED, TICKS).recording, 0);
    const b = serializeRecording(recordHeadless(SEED, TICKS).recording, 0);
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it('playback of a shorter recording matches the live run of the same length', () => {
    const HALF = TICKS / 2;
    const { recording, result } = recordHeadless(SEED, HALF);
    expect(recording.frames.length).toBe(HALF);
    const loaded = loadRecording(serializeRecording(recording, 0));
    // Replaying the full (HALF-length) recording rebuilds the same end state the
    // live HALF-tick run produced — physics AND agents, bit-for-bit.
    const replayed = replayHeadless(loaded, HALF);
    expect(replayed.agents).toEqual(result.agents);
    expect(replayed.physics).toEqual(result.physics);
  });
});
