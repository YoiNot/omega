/**
 * @omega/audio-playback — Web Audio adapter.
 *
 * Maps the *deterministic* {@link SpatialSourceParam} values computed by
 * `@omega/audio-spatial` onto a real Web Audio graph: one `GainNode` (+ a
 * `StereoPannerNode` for horizontal pan) per source, all routed into a master
 * gain that connects to the destination.
 *
 * Why `StereoPannerNode` and not `PannerNode`?
 *   `@omega/audio-spatial` already folds distance attenuation into
 *   `SpatialSourceParam.gain`. A `PannerNode` would *additionally* apply its own
 *   distance model on top, double-attenuating the signal. `StereoPannerNode`
 *   only applies `panX` (which maps 1:1 to `SpatialSourceParam.panX` in
 *   [-1, 1]) and leaves the supplied `gain` untouched — exactly what the spatial
 *   layer already computed.
 *
 * Determinism contract (this layer):
 *   Building the graph from the same `SpatialSourceParam[]` produces the *same*
 *   node configuration (ids, kinds, gain, panX, wiring) every time. The only
 *   non-deterministic step is the platform's eventual sample output, which is
 *   intentionally outside this module's scope.
 *
 * Node-side use: pass a real `AudioContext`/`OfflineAudioContext`. Browser-side
 * use: same. Testing: inject a `OfflineAudioContext`-style mock that records the
 * calls, so we can assert the graph config deterministically without producing
 * sound.
 */

import type { SpatialSourceParam } from '@omega/audio-spatial';
import { makeSourceNode, type AudioBufferLike, type SourceGraphNode, type SpatialNodeKind } from './graph.js';

/** Minimal slice of the Web Audio node API this adapter builds against. */
export interface AudioContextLike {
  readonly currentTime: number;
  readonly destination: AudioNodeLike;
  createGain(): GainNodeLike;
  createStereoPanner(): StereoPannerNodeLike;
  createOscillator(): OscillatorNodeLike;
  createBufferSource(): AudioBufferSourceNodeLike;
  createBuffer(channels: number, length: number, sampleRate: number): AudioBufferLike;
  readonly sampleRate: number;
}

export interface AudioNodeLike {
  connect(node: AudioNodeLike): void;
  disconnect(): void;
}

export interface GainNodeLike extends AudioNodeLike {
  gain: AudioParamLike;
}

export interface StereoPannerNodeLike extends AudioNodeLike {
  pan: AudioParamLike;
}

export interface OscillatorNodeLike extends AudioNodeLike {
  type: OscillatorType;
  frequency: AudioParamLike;
  start(when?: number): void;
  stop(when?: number): void;
  setPeriodicWave?(wave: unknown): void;
}

export interface AudioBufferSourceNodeLike extends AudioNodeLike {
  buffer: AudioBufferLike | null;
  start(when?: number): void;
  stop(when?: number): void;
  loop: boolean;
}

export interface AudioParamLike {
  value: number;
}

/** A fully wired playback source: its node config plus live node handles. */
export interface WiredSource {
  node: SourceGraphNode;
  gainNode: GainNodeLike;
  pannerNode: StereoPannerNodeLike;
  sourceNode: OscillatorNodeLike | AudioBufferSourceNodeLike;
}

export interface PlaybackGraphOptions {
  /**
   * Master gain applied to the bus that all sources route through, [0, 1].
   * Defaults to 1.
   */
  masterGain?: number;
  /** Default node kind when a source doesn't declare one. Defaults to 'oscillator'. */
  defaultKind?: SpatialNodeKind;
  /**
   * Per-source override of node kind. Keyed by source id. Lets callers pick
   * buffer playback for some sources and oscillator tones for others.
   */
  kinds?: Record<string, SpatialNodeKind>;
  /** Per-source oscillator frequency (Hz). Keyed by source id. */
  frequencies?: Record<string, number>;
  /** Per-source decoded buffer (for `kind === 'buffer'`). Keyed by source id. */
  buffers?: Record<string, AudioBufferLike>;
}

/**
 * Build and wire a deterministic playback graph for the given spatial params.
 *
 * Routing per source:
 *   sourceNode -> gainNode -> pannerNode -> masterGain -> destination
 *
 * Returns the live node handles (browser) plus the deterministic node configs
 * (tests). Identical params + options always yield identical `nodes` configs.
 */
export function buildPlaybackGraph(
  ctx: AudioContextLike,
  params: SpatialSourceParam[],
  opts: PlaybackGraphOptions = {},
): { masterGain: GainNodeLike; sources: WiredSource[] } {
  const master = ctx.createGain();
  master.gain.value = opts.masterGain ?? 1;
  master.connect(ctx.destination);

  const defaultKind = opts.defaultKind ?? 'oscillator';
  const sources: WiredSource[] = [];

  for (const param of params) {
    const kind = opts.kinds?.[param.id] ?? defaultKind;
    const node = makeSourceNode(param, kind, {
      frequency: opts.frequencies?.[param.id],
      buffer: opts.buffers?.[param.id],
    });

    // Gain stage carries the spatial layer's already-attenuated gain.
    const gainNode = ctx.createGain();
    // Clamp defensively: spatial model promises [0,1] but never trust inputs.
    gainNode.gain.value = node.gain < 0 ? 0 : node.gain > 1 ? 1 : node.gain;

    // Stereo pan stage: panX maps 1:1 onto [-1, 1].
    const pannerNode = ctx.createStereoPanner();
    pannerNode.pan.value = node.panX < -1 ? -1 : node.panX > 1 ? 1 : node.panX;

    // Source content node.
    let sourceNode: OscillatorNodeLike | AudioBufferSourceNodeLike;
    if (kind === 'buffer') {
      const bufSrc = ctx.createBufferSource();
      bufSrc.buffer = node.buffer ?? null;
      sourceNode = bufSrc;
    } else {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = node.frequency;
      sourceNode = osc;
    }

    // Wire: source -> gain -> panner -> master.
    sourceNode.connect(gainNode);
    gainNode.connect(pannerNode);
    pannerNode.connect(master);

    sources.push({ node, gainNode, pannerNode, sourceNode });
  }

  return { masterGain: master, sources };
}
