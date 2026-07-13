/**
 * @omega/audio-playback — deterministic graph configuration types.
 *
 * The Web Audio wiring (the actual `PannerNode`/`GainNode`/`StereoPannerNode`
 * instances) is the single non-deterministic stage of the pipeline: once we
 * hand `gain`/`panX` to the browser, the resulting samples depend on the
 * platform's audio backend. Everything *above* that stage — the per-source
 * graph configuration derived from {@link SpatialSourceParam} — is a pure
 * function of its inputs and is therefore deterministic and Node-testable.
 *
 * These types capture that configuration: for a given set of spatial params we
 * can describe exactly which node would be created and with which numeric
 * values, without ever touching a real `AudioContext`.
 */

import type { SpatialSourceParam } from '@omega/audio-spatial';

/** Which kind of spatial node the playback layer will instantiate per source. */
export type SpatialNodeKind = 'oscillator' | 'buffer';

/** Stable graph-configuration representation for one spatial source. */
export interface SourceGraphNode {
  /** Echoes the source id from {@link SpatialSourceParam}. */
  id: string;
  /** The node type the playback layer wires up for this source. */
  kind: SpatialNodeKind;
  /** Linear gain in [0, 1] fed to the `GainNode` (== `SpatialSourceParam.gain`). */
  gain: number;
  /** Stereo pan in [-1, 1] fed to the `StereoPannerNode` (== `SpatialSourceParam.panX`). */
  panX: number;
  /** Euclidean distance from listener, [0, Infinity) (== `SpatialSourceParam.distance`). */
  distance: number;
  /** Oscillator frequency in Hz (only meaningful when `kind === 'oscillator'`). */
  frequency: number;
  /** Buffer sample payload (only meaningful when `kind === 'buffer'`). */
  buffer?: AudioBufferLike;
}

/** Minimal buffer shape we accept (avoids a hard Web Audio DOM dependency in tests). */
export interface AudioBufferLike {
  /** Number of channels (1 = mono, 2 = stereo, ...). */
  readonly numberOfChannels: number;
  /** Sample frames per channel. */
  readonly length: number;
  /** Sample rate in Hz. */
  readonly sampleRate: number;
}

/**
 * Pure helper: turn a {@link SpatialSourceParam} (+ osc/buffer intent) into a
 * deterministic {@link SourceGraphNode}. No `AudioContext`, no DOM — fully
 * testable in Node. The same param always yields the same node config.
 */
export function makeSourceNode(
  param: SpatialSourceParam,
  kind: SpatialNodeKind,
  opts: { frequency?: number; buffer?: AudioBufferLike } = {},
): SourceGraphNode {
  return {
    id: param.id,
    kind,
    gain: param.gain,
    panX: param.panX,
    distance: param.distance,
    frequency: opts.frequency ?? 440,
    buffer: opts.buffer,
  };
}
