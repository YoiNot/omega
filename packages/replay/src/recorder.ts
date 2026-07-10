/**
 * @omega/replay — Recorder.
 *
 * Accumulates one `RecordingFrame` per captured tick. The recorder is
 * deliberately dumb: it does not own the simulation, it only snapshots whatever
 * world is handed to `recordFrame`. This keeps the record path free of any
 * nondeterministic state.
 */

import type { World } from '@omega/engine-core';
import { snapshotWorld } from '@omega/save';
import { encodeSnapshot as encodeNetSnapshot } from '@omega/net';
import {
  REPLAY_MAGIC,
  REPLAY_FORMAT_VERSION,
  ecsSnapshotToNet,
  type Recording,
  type RecordingFrame,
} from './recording.js';

export interface RecorderOptions {
  /** Seed for the recording header (e.g. the sim's RNG seed). */
  seedLow?: bigint;
  seedHigh?: bigint;
}

/** Records simulation frames deterministically. */
export class Recorder {
  private readonly frames: RecordingFrame[] = [];
  private readonly componentNames: string[];
  private readonly seedLow: string;
  private readonly seedHigh: string;

  /**
   * @param componentNames Every component type that should be persisted. These
   *   MUST be the same names the simulation uses, and the same names passed to
   *   `Playback` on restore.
   * @param opts Optional seed for the recording header.
   */
  constructor(componentNames: string[], opts: RecorderOptions = {}) {
    if (componentNames.length === 0) throw new Error('replay: no component names');
    this.componentNames = [...componentNames];
    this.seedLow = String(opts.seedLow ?? 0n);
    this.seedHigh = String(opts.seedHigh ?? 0n);
  }

  /** Number of frames recorded so far. */
  get frameCount(): number {
    return this.frames.length;
  }

  /** Record the current `world` state at `tick`. `dt` is the frame timestep. */
  recordFrame(world: World, tick: number, dt: number): void {
    const ecsSnap = snapshotWorld(world, this.componentNames);
    const netSnap = ecsSnapshotToNet(ecsSnap, tick);
    const bytes = [...encodeNetSnapshot(netSnap)];
    this.frames.push({ tick, worldSnapshot: bytes, dt });
  }

  /** Record a frame plus an engine RNG state checkpoint (4 decimal strings). */
  recordFrameWithRng(
    world: World,
    tick: number,
    dt: number,
    rngState: string[],
  ): void {
    const ecsSnap = snapshotWorld(world, this.componentNames);
    const netSnap = ecsSnapshotToNet(ecsSnap, tick);
    const bytes = [...encodeNetSnapshot(netSnap)];
    this.frames.push({ tick, worldSnapshot: bytes, dt, rngState });
  }

  /** Build the immutable `Recording`. */
  toRecording(): Recording {
    return {
      magic: REPLAY_MAGIC,
      version: REPLAY_FORMAT_VERSION,
      seedLow: this.seedLow,
      seedHigh: this.seedHigh,
      componentNames: [...this.componentNames],
      frames: this.frames.map((f) => ({ ...f })),
    };
  }

  /** Reset, discarding all recorded frames. */
  clear(): void {
    this.frames.length = 0;
  }
}
