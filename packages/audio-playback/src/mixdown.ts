/**
 * @omega/audio-playback — spatial mixdown.
 *
 * Folds several {@link SpatialAudioModel} outputs (each a list of
 * `SpatialSourceParam`) into a single, deterministic *mix matrix*. The matrix
 * is pure data: a per-(source, listener) gain + pan + distance table plus a
 * master summary. It is the planning layer that precedes sample playback — the
 * same model outputs always yield the byte/value-identical matrix, independent
 * of any later (non-deterministic) audio rendering.
 *
 * Use case: when multiple listeners (e.g. a split-screen co-op camera or a
 * network-replicated mix) each have their own spatial model, merge their
 * per-source params into one structure so the renderer knows the authoritative
 * gain/pan for every source once.
 */

import type { ListenerState, SpatialSourceParam, SpatialAudioModel } from '@omega/audio-spatial';
import type { AudioSourceInput } from '@omega/audio-spatial';

/** One row of the mix matrix: a source as seen from one listener. */
export interface MixRow {
  /** Source id. */
  id: string;
  /** Listener id this row was computed for. */
  listenerId: string;
  /** Combined linear gain in [0, 1]. */
  gain: number;
  /** Horizontal pan in [-1, 1]. */
  panX: number;
  /** Euclidean distance from that listener to the source. */
  distance: number;
}

/** A complete, deterministic mixdown. */
export interface MixMatrix {
  /** Number of sources in the matrix. */
  sourceCount: number;
  /** Number of listeners folded in. */
  listenerCount: number;
  /** Flattened rows: `listenerCount * sourceCount` entries, row-major. */
  rows: MixRow[];
  /** Per-source worst-case (minimum) gain across all listeners, [0, 1]. */
  minGainBySource: Record<string, number>;
  /** Per-source worst-case (maximum) distance across all listeners. */
  maxDistanceBySource: Record<string, number>;
}

export interface MixdownSourceSet {
  /** Stable id used to label this source in the matrix. */
  id: string;
  /** The input the model consumes (position + base gain). */
  input: AudioSourceInput;
}

/**
 * Compute a deterministic mix matrix from one or more listeners.
 *
 * @param model   A single {@link SpatialAudioModel} (shared config) used to
 *                evaluate each listener against the same source set.
 * @param sources The source set (shared across listeners).
 * @param listeners Labeled listener states. Order is preserved.
 *
 * Determinism: identical (model, sources, listeners) -> identical `MixMatrix`
 * (deep-equal, and `rows` in a stable `listener-major` order).
 */
export function computeMixMatrix(
  model: SpatialAudioModel,
  sources: MixdownSourceSet[],
  listeners: { id: string; state: ListenerState }[],
): MixMatrix {
  const rows: MixRow[] = [];
  const minGainBySource: Record<string, number> = {};
  const maxDistanceBySource: Record<string, number> = {};

  for (const src of sources) {
    minGainBySource[src.id] = Infinity;
    maxDistanceBySource[src.id] = -Infinity;
  }

  for (const l of listeners) {
    const params: SpatialSourceParam[] = model.update(l.state, sources.map((s) => s.input));
    for (const p of params) {
      rows.push({
        id: p.id,
        listenerId: l.id,
        gain: p.gain,
        panX: p.panX,
        distance: p.distance,
      });
      if (p.gain < minGainBySource[p.id]) minGainBySource[p.id] = p.gain;
      if (p.distance > maxDistanceBySource[p.id]) maxDistanceBySource[p.id] = p.distance;
    }
  }

  return {
    sourceCount: sources.length,
    listenerCount: listeners.length,
    rows,
    minGainBySource,
    maxDistanceBySource,
  };
}
