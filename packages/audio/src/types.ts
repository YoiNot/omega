/**
 * @omega/audio — shared structural types.
 *
 * Everything here is plain data so the audio graph is fully testable in Node
 * without a Web Audio context. Positions/orientations use @omega/engine-math
 * Vec3 so the rest of the engine can feed them in directly.
 */

import type { Vec3 } from '@omega/engine-math';

/** A point source of sound in world space. */
export interface AudioSource {
  id: string;
  /** World-space position of the emitter. */
  position: Vec3;
  /** Optional world-space velocity (used for Doppler-style effects later). */
  velocity?: Vec3;
  /** Linear gain of the source, typically in [0, 1]. */
  gain: number;
}

/** The listener (player/camera) orientation and position. */
export interface AudioListener {
  position: Vec3;
  /** Unit forward vector (the direction the listener faces). */
  forward: Vec3;
  /** Unit up vector. */
  up: Vec3;
}

/**
 * A mix bus with its own gain stage. We keep two logical buses:
 *  - `master`: everything routes through here.
 *  - `ambient`: the procedural ambience bed routes here (so it can be ducked
 *    independently of positional sources).
 */
export interface AudioBus {
  /** Bus identifier. */
  id: string;
  /** Linear master gain applied to the bus, [0, 1]. */
  gain: number;
  /** Human-readable label (optional, for tooling). */
  label?: string;
}

/** Per-source computed mix result. */
export interface SpatialGains {
  /** Linear gain for the left channel, [0, 1]. */
  left: number;
  /** Linear gain for the right channel, [0, 1]. */
  right: number;
  /**
   * Low-pass factor in [0, 1] where 0 = fully bright (no cutoff) and 1 = very
   * muffled. Driven by distance/occlusion so far or blocked sources sound dull.
   */
  lowpass: number;
}

/** A single emitted ambience event. */
export interface AudioEvent {
  /** Fundamental frequency in Hz. */
  freq: number;
  /** Linear gain, [0, 1]. */
  gain: number;
  /** Duration in seconds. */
  duration: number;
  /** Kind of event, for filtering/visualization. */
  kind: 'wind' | 'bird' | 'tone';
}
