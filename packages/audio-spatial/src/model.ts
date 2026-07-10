/**
 * @omega/audio-spatial — deterministic 3D audio parameter model.
 *
 * This package computes the *parameters* a positional audio system needs
 * (per-source gain, horizontal pan, and distance) from entity positions
 * relative to a listener. It is pure math and a pure function of its inputs:
 * no clock, no `Math.random`, no Web Audio / DOM. The actual playback (the
 * thin, non-deterministic layer that turns these numbers into sound) is
 * deliberately out of scope here — see `@omega/audio` for the mixer that
 * consumes `SpatialSourceParam` values.
 *
 * Determinism contract:
 *   identical (listener, sources, config) -> identical SpatialSourceParam[]
 *   for every entry, in the same order. Two `update()` calls with the same
 *   arguments yield `toEqual` results.
 *
 * Model:
 *   - Distance attenuation: inverse-distance rolloff (Web Audio PannerNode-style)
 *     clamped to 1.0 inside `refDistance` and to 0.0 past `maxDistance`. Strictly
 *     monotonically decreasing between `refDistance` and `maxDistance`.
 *   - Horizontal pan: the source direction is projected onto the listener's
 *     right vector (forward x up) and reported as `panX` in [-1, 1],
 *     where -1 = hard left, +1 = hard right, 0 = centered (ahead/behind).
 */

import { Vec3, clamp, clamp01 } from '@omega/engine-math';

/** Listener pose: world position + unit forward direction. */
export interface ListenerState {
  pos: Vec3;
  forward: Vec3;
}

/** A single audio emitter, as consumed by the model. */
export interface AudioSourceInput {
  id: string;
  pos: Vec3;
  gain: number;
}

/** Computed spatial parameters for one source. */
export interface SpatialSourceParam {
  id: string;
  /** Combined linear gain in [0, 1] (distance attenuation * source gain). */
  gain: number;
  /** Horizontal pan in [-1, 1]: -1 = left, +1 = right, 0 = center. */
  panX: number;
  /** Euclidean distance from listener to source (>= 0). */
  distance: number;
}

export interface SpatialAudioModelOptions {
  /** Distance (world units) at which gain is 1.0. Inside this, gain stays 1. */
  refDistance?: number;
  /** Distance past which the source is inaudible (gain forced to 0). */
  maxDistance?: number;
  /** How aggressively gain falls off with distance. */
  rolloffFactor?: number;
  /**
   * The listener's up vector, used to derive the right axis for panning.
   * Defaults to +Y. The model only needs `pos` + `forward` from the listener,
   * so the up axis is supplied once at construction time.
   */
  up?: Vec3;
}

const EPS = 1e-9;

export class SpatialAudioModel {
  readonly refDistance: number;
  readonly maxDistance: number;
  readonly rolloffFactor: number;
  private readonly _up: Vec3;

  constructor(opts: SpatialAudioModelOptions = {}) {
    this.refDistance = opts.refDistance ?? 1;
    this.maxDistance = opts.maxDistance ?? 100;
    this.rolloffFactor = opts.rolloffFactor ?? 1;
    this._up = (opts.up ?? Vec3.of(0, 1, 0)).clone();
    if (this.refDistance < 0) throw new RangeError('refDistance must be >= 0');
    if (this.maxDistance <= this.refDistance) {
      throw new RangeError('maxDistance must be > refDistance');
    }
    if (this.rolloffFactor < 0) throw new RangeError('rolloffFactor must be >= 0');
  }

  /**
   * Compute spatial parameters for every source. Pure and deterministic:
   * identical (listener, sources) -> identical, order-preserving output.
   */
  update(listener: ListenerState, sources: AudioSourceInput[]): SpatialSourceParam[] {
    // Cache the normalized right axis: forward x up, normalized.
    const right = Vec3.cross(listener.forward, this._up).normalize();
    return sources.map((s) => this._computeOne(listener.pos, right, s));
  }

  private _computeOne(
    listenerPos: Vec3,
    right: Vec3,
    s: AudioSourceInput,
  ): SpatialSourceParam {
    const d = Vec3.distance(listenerPos, s.pos);

    // --- Distance attenuation (inverse model, clamped) -------------------
    let distGain: number;
    if (d <= this.refDistance) {
      distGain = 1;
    } else if (d >= this.maxDistance) {
      distGain = 0;
    } else {
      distGain =
        this.refDistance /
        (this.refDistance + this.rolloffFactor * (d - this.refDistance));
    }

    // --- Horizontal pan (projection onto the right axis) -----------------
    // Unit direction from listener to source; zero vector (coincident) -> 0.
    const toSource = Vec3.sub(s.pos, listenerPos);
    const len = toSource.length();
    let panX = 0;
    if (len > EPS) {
      const dot = (toSource.x * right.x + toSource.y * right.y + toSource.z * right.z) / len;
      panX = clamp(dot, -1, 1);
    }

    // --- Combine gain ----------------------------------------------------
    const gain = clamp01(distGain * s.gain);

    return { id: s.id, gain, panX, distance: d };
  }
}
