/**
 * @omega/replay — Playback.
 *
 * Reconstructs the ECS world tick-for-tick from a `Recording`. `playTo` seeks
 * to a target tick by replaying every frame up to and including it; seeking
 * backwards re-applies from the start (frames are full world snapshots, not
 * deltas, so there is no partial state to reconcile).
 */

import type { World } from '@omega/engine-core';
import { restoreWorld } from '@omega/save';
import { decodeSnapshot } from '@omega/net';
import { netSnapshotToEcs, type Recording, type RecordingFrame } from './recording.js';

export class Playback {
  private readonly frames: readonly RecordingFrame[];
  private readonly byTick = new Map<number, RecordingFrame>();
  private readonly world: World;
  private appliedTick = -1;

  /**
   * @param rec The recording to play.
   * @param world A live world to populate. It is cleared on construction and on
   *   every seek so replay output depends only on `rec` + `componentNames`.
   * @param componentNames Component names used when the recording was made.
   *   MUST match the recorder's `componentNames` (the recording also stores its
   *   own; if omitted we fall back to the recording's list).
   */
  constructor(rec: Recording, world: World, componentNames?: string[]) {
    this.frames = rec.frames;
    this.world = world;
    for (const f of this.frames) this.byTick.set(f.tick, f);
    // Validate component names unless the caller explicitly overrides.
    const names = componentNames ?? rec.componentNames;
    if (
      names.length !== rec.componentNames.length ||
      names.some((n, i) => n !== rec.componentNames[i])
    ) {
      throw new Error(
        'replay: component names do not match the recording (got ' +
          JSON.stringify(names) +
          ', expected ' +
          JSON.stringify(rec.componentNames) +
          ')',
      );
    }
    // Start from a known-empty world.
    world.clear();
    this.appliedTick = -1;
  }

  /** Ticks for which a frame exists, ascending. */
  get ticks(): number[] {
    return this.frames.map((f) => f.tick);
  }

  /** Highest recorded tick, or -1 when empty. */
  get lastTick(): number {
    return this.frames.length === 0 ? -1 : this.frames[this.frames.length - 1].tick;
  }

  /** Currently applied tick (-1 before any `playTo`). */
  get currentTick(): number {
    return this.appliedTick;
  }

  /** The live world (populated to `currentTick`). */
  getWorld(): World {
    return this.world;
  }

  /** RNG state checkpoint captured at `tick`, if any. */
  rngStateAt(tick: number): string[] | undefined {
    return this.byTick.get(tick)?.rngState;
  }

  /**
   * Apply every frame in [0, tick] in order, leaving `world` exactly as it was
   * at `tick`. Seeking backward re-applies from frame 0. Returns the world.
   */
  playTo(tick: number): World {
    const target = this.frames.filter((f) => f.tick <= tick);
    if (target.length === 0) {
      this.world.clear();
      this.appliedTick = -1;
      return this.world;
    }
    // Re-apply from start so order is always deterministic.
    this.world.clear();
    let last = -1;
    for (const f of target) {
      const wire = Uint8Array.from(f.worldSnapshot);
      const netSnap = decodeSnapshot(wire);
      const snap = netSnapshotToEcs(netSnap);
      restoreWorld(this.world, snap);
      last = f.tick;
    }
    this.appliedTick = last;
    return this.world;
  }
}
