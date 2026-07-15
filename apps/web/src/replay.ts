/**
 * apps/web — deterministic replay glue for the live demo.
 *
 * Thin browser adapter over @omega/replay. The demo already attaches a
 * `Recorder` (when `record: true`) that snapshots the physics + GOAP-agent
 * world every fixed tick via the time-core scheduler — this module exposes the
 * Record → Stop → Save/Load (byte file round-trip) → Play controls the UI needs,
 * and a headless `Playback` that reconstructs the world tick-for-tick.
 *
 * All helpers are pure functions of their arguments (no clock, no randomness):
 * `serializeRecording` fixes `createdAt` to 0 so the bytes are reproducible, and
 * `Playback.playTo` rebuilds from frame 0 so the same recording always yields the
 * same world. UI-only DOM code (download/upload) lives in replay-panel.tsx.
 */

import { World as CoreWorld } from '@omega/engine-core';
import {
  Playback,
  serializeRecording,
  loadRecording,
  type Recording,
} from '@omega/replay';
import type { RigidBody } from '@omega/physics';
import { PhysicsBody } from '@omega/physics-integration';
import { AGENT_STORE, type AgentComponent } from './ai';
import { RESOURCE_STORE, BLOCKER_STORE, WANDERER_STORE } from './entities';
import { PLAYER_STORE } from './player';
import { STRUCTURE_STORE } from './construction';
import type { Demo } from './engine';

/** Component stores captured by the demo recorder (full observable world). */
export const REPLAY_STORES = [
  PhysicsBody.name,
  AGENT_STORE,
  RESOURCE_STORE,
  BLOCKER_STORE,
  WANDERER_STORE,
  PLAYER_STORE,
  STRUCTURE_STORE,
] as const;

/** Fixed `createdAt` so serialized replay bytes are byte-stable/reproducible. */
const FIXED_CREATED_AT = 0;

/** A reconstructed world frame: observable physics + agent state at one tick. */
export interface ReplayFrameState {
  tick: number;
  physics: { id: number; x: number; y: number; z: number }[];
  agents: { id: number; tx: number; tz: number; delivered: number }[];
}

/** Number of frames captured so far by the demo's live recorder (0 if none). */
export function recordedFrameCount(demo: Demo): number {
  return demo.recorder?.frameCount ?? 0;
}

/** Snapshot the demo's live recorder into an immutable `Recording` (or null). */
export function captureRecording(demo: Demo): Recording | null {
  return demo.recorder ? demo.recorder.toRecording() : null;
}

/** Serialize a recording to deterministic bytes for file download. */
export function recordingToBytes(rec: Recording): Uint8Array {
  return serializeRecording(rec, FIXED_CREATED_AT);
}

/** Parse a recording previously written by {@link recordingToBytes}. */
export function recordingFromBytes(bytes: Uint8Array): Recording {
  return loadRecording(bytes);
}

/**
 * Build a headless `Playback` over a fresh world and rebuild it to `tick`.
 * Returns the observable state at that tick. Deterministic: replaying the same
 * recording always yields identical state (frames are full snapshots applied
 * from frame 0).
 */
export function playRecordingTo(rec: Recording, tick: number): ReplayFrameState {
  const world = new CoreWorld();
  const playback = new Playback(rec, world, [...REPLAY_STORES]);
  playback.playTo(tick);
  return readWorldState(world, playback.currentTick);
}

/** All ticks present in a recording, ascending. */
export function recordingTicks(rec: Recording): number[] {
  return rec.frames.map((f) => f.tick);
}

/**
 * Seek the replay to an arbitrary tick and return the observable world state
 * there. Behaves like {@link playRecordingTo} but accepts ANY tick (clamped to
 * the recorded range), enabling a scrubable timeline UI. Deterministic: the
 * same (rec, tick) always yields identical state (frames are full snapshots
 * applied from frame 0).
 */
export function seekTo(rec: Recording, tick: number): ReplayFrameState {
  const ticks = recordingTicks(rec);
  if (ticks.length === 0) return { tick: 0, physics: [], agents: [] };
  const last = ticks[ticks.length - 1]!;
  const target = Math.max(ticks[0]!, Math.min(tick, last));
  return playRecordingTo(rec, target);
}

/** Read observable physics + agent state out of a reconstructed world. */
function readWorldState(world: CoreWorld, tick: number): ReplayFrameState {
  const round = (n: number) => Math.round(n * 1e6) / 1e6;
  const physics: ReplayFrameState['physics'] = [];
  for (const id of world.store(PhysicsBody.name).keys()) {
    const b = world.getComponent<RigidBody>(PhysicsBody.name, id);
    if (b) physics.push({ id, x: round(b.position.x), y: round(b.position.y), z: round(b.position.z) });
  }
  const agents: ReplayFrameState['agents'] = [];
  for (const id of world.store<AgentComponent>(AGENT_STORE).keys()) {
    const a = world.getComponent<AgentComponent>(AGENT_STORE, id);
    if (a) agents.push({ id, tx: a.tx, tz: a.tz, delivered: a.delivered });
  }
  // Sort by id so the observable state is order-deterministic (the store's key
  // iteration order is not guaranteed stable across reconstructions).
  physics.sort((p, q) => p.id - q.id);
  agents.sort((p, q) => p.id - q.id);
  return { tick, physics, agents };
}

export type { Recording } from '@omega/replay';
