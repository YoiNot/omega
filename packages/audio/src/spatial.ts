/**
 * @omega/audio — positional mixing.
 *
 * SpatialMixer turns a listener + an AudioSource into per-channel gains and a
 * low-pass factor. The model is deliberately simple but *real* and fully
 * deterministic: it is a pure function of the listener and source positions
 * plus the (constant) mixer configuration, so the same inputs always yield the
 * same outputs.
 *
 *   - Distance attenuation: inverse-distance rolloff, clamped to zero past
 *     `maxDistance` (and to full volume inside `refDistance`).
 *   - Direction panning: the source direction is projected onto the listener's
 *     right vector, then mapped to equal-power left/right gains. A source dead
 *     ahead or behind is centered (left === right); a source to the right is
 *     panned right, etc.
 *   - Low-pass: climbs with distance and with an explicit occlusion factor so
 *     far/blocked sources sound dull.
 */

import { Vec3, clamp01 } from '@omega/engine-math';
import type { AudioListener, AudioSource, SpatialGains } from './types.js';

export interface SpatialMixerOptions {
  /** Distance (world units) at which gain is 1.0. Inside this, gain stays 1. */
  refDistance?: number;
  /** Distance past which the source is inaudible (gain forced to 0). */
  maxDistance?: number;
  /** How aggressively gain falls off with distance. */
  rolloffFactor?: number;
}

export interface ComputeGainsOptions {
  /**
   * Occlusion factor in [0, 1]: 0 = clear line of sight, 1 = fully blocked.
   * Adds directly to the low-pass factor.
   */
  occlusion?: number;
}

export class SpatialMixer {
  readonly refDistance: number;
  readonly maxDistance: number;
  readonly rolloffFactor: number;

  constructor(opts: SpatialMixerOptions = {}) {
    this.refDistance = opts.refDistance ?? 1;
    this.maxDistance = opts.maxDistance ?? 100;
    this.rolloffFactor = opts.rolloffFactor ?? 1;
  }

  /**
   * Compute left/right gains plus a low-pass factor for a single source.
   * Pure and deterministic: identical (listener, source, opts) -> identical result.
   */
  computeGains(
    listener: AudioListener,
    source: AudioSource,
    opts: ComputeGainsOptions = {},
  ): SpatialGains {
    const d = Vec3.distance(listener.position, source.position);

    // --- Distance attenuation (inverse model, clamped) -------------------
    let distGain: number;
    if (d >= this.maxDistance) {
      distGain = 0;
    } else if (d <= this.refDistance) {
      distGain = 1;
    } else {
      distGain =
        this.refDistance /
        (this.refDistance + this.rolloffFactor * (d - this.refDistance));
    }

    // --- Direction panning (equal-power) --------------------------------
    // Right vector = forward x up, normalized.
    const right = Vec3.cross(listener.forward, listener.up).normalize();
    const toSource = Vec3.sub(source.position, listener.position).normalize();
    const panDot = Vec3.dot(toSource, right); // [-1, 1]-ish
    const p = clamp01(panDot * 0.5 + 0.5); // [0, 1]
    const angle = p * (Math.PI / 2);
    const panL = Math.cos(angle);
    const panR = Math.sin(angle);

    // --- Low-pass factor -------------------------------------------------
    const occlusion = opts.occlusion ?? 0;
    const lowpass = clamp01(d / this.maxDistance + occlusion);

    // --- Combine ---------------------------------------------------------
    const g = distGain * source.gain;
    return {
      left: clamp01(g * panL),
      right: clamp01(g * panR),
      lowpass,
    };
  }
}
