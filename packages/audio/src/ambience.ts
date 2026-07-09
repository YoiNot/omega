/**
 * @omega/audio — procedural ambience bed.
 *
 * AmbienceGenerator emits a deterministic stream of AudioEvents (wind gusts,
 * bird chirps, generic tones) driven entirely by an @omega/engine-core Rng.
 * No Math.random / Date.now: the same seed always yields the same event
 * sequence, so the ambience bed is reproducible across runs and machines.
 *
 * Usage: call nextEvent(t) once per frame with the simulation clock `t`. When
 * `t` has reached the next scheduled time it returns one AudioEvent and
 * advances the deterministic schedule; otherwise it returns null. Because the
 * Rng is consumed in a fixed order per emitted event, the event sequence is a
 * pure function of the seed regardless of how the caller steps `t`.
 */

import { Rng } from '@omega/engine-core';
import { clamp01 } from '@omega/engine-math';
import type { AudioEvent } from './types.js';

export interface AmbienceOptions {
  /** Seed for the underlying Rng. */
  seed?: bigint | number | string;
  /** Global gain scale applied to every event, [0, 1]. */
  masterGain?: number;
  /** Probability that any given event is a bird chirp rather than wind. */
  birdChance?: number;
  /** Minimum seconds between emitted events. */
  minInterval?: number;
  /** Maximum seconds between emitted events. */
  maxInterval?: number;
}

export class AmbienceGenerator {
  private readonly rng: Rng;
  private readonly masterGain: number;
  private readonly birdChance: number;
  private readonly minInterval: number;
  private readonly maxInterval: number;

  /** Absolute simulation time at which the next event becomes due. */
  private nextTime: number;

  constructor(opts: AmbienceOptions = {}) {
    this.rng = new Rng(opts.seed ?? 0);
    this.masterGain = opts.masterGain ?? 1;
    this.birdChance = opts.birdChance ?? 0.5;
    this.minInterval = opts.minInterval ?? 0.3;
    this.maxInterval = opts.maxInterval ?? 1.5;
    this.nextTime = 0; // first event is due at t >= 0
  }

  /** Time of the next scheduled event. */
  get scheduledTime(): number {
    return this.nextTime;
  }

  /**
   * Advance the deterministic clock. Returns the next AudioEvent if `t` has
   * reached the schedule, otherwise null. Calling with the same `t` twice will
   * not double-emit: the schedule advances past `t` on the first fire.
   */
  nextEvent(t: number): AudioEvent | null {
    if (t < this.nextTime) return null;

    let freq: number;
    let gain: number;
    let duration: number;
    let kind: AudioEvent['kind'];

    const isBird = this.rng.bool(this.birdChance);
    if (isBird) {
      freq = this.rng.nextRange(1800, 4200); // bright chirp
      gain = clamp01(this.rng.nextRange(0.05, 0.4) * this.masterGain);
      duration = this.rng.nextRange(0.08, 0.35);
      kind = 'bird';
    } else {
      freq = this.rng.nextRange(60, 240); // low wind rumble
      gain = clamp01(this.rng.nextRange(0.05, 0.25) * this.masterGain);
      duration = this.rng.nextRange(0.4, 1.6);
      kind = 'wind';
    }

    const interval = this.rng.nextRange(this.minInterval, this.maxInterval);
    this.nextTime += interval;

    return { freq, gain, duration, kind };
  }
}
