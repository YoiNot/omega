/**
 * @omega/audio-spatial — ECS integration (optional).
 *
 * Provides a reusable `AudioSource` component value and a deterministic system
 * that reads `Transform`-like position components plus the listener state and
 * writes the resulting {@link SpatialSourceParam} back into an
 * `audioSpatialParam` component store.
 *
 * The system is framework-free and deterministic: given the same world state it
 * always produces the same params. It depends on `@omega/engine-core`'s `World`
 * (string-keyed component stores) and on `@omega/engine-math`'s `Vec3`.
 */

import type { World } from '@omega/engine-core';
import { Vec3 } from '@omega/engine-math';
import { SpatialAudioModel, type AudioSourceInput, type ListenerState, type SpatialSourceParam } from './model.js';

/** Component value: an entity that emits audio with a base linear gain. */
export interface AudioSourceComponent {
  /** Stable identifier for the source (defaults to the entity id when registered). */
  id: string;
  /** Base linear gain in [0, 1] before distance attenuation. */
  gain: number;
}

/** Component name for {@link AudioSourceComponent}. */
export const AUDIO_SOURCE = 'audioSource';

/** Component name for the computed per-entity {@link SpatialSourceParam}. */
export const AUDIO_SPATIAL_PARAM = 'audioSpatialParam';

/**
 * Build the list of {@link AudioSourceInput} for every entity that has both a
 * `position` (Vec3) and an `audioSource` component. Iterates ascending-id order
 * so the resulting array order is deterministic.
 */
export function collectSources(world: World): AudioSourceInput[] {
  const out: AudioSourceInput[] = [];
  const ids = world.query('position', AUDIO_SOURCE).ids;
  for (const id of ids) {
    const pos = world.getComponent<Vec3>('position', id);
    const src = world.getComponent<AudioSourceComponent>(AUDIO_SOURCE, id);
    if (!pos || !src) continue;
    out.push({ id: src.id || String(id), pos, gain: src.gain });
  }
  return out;
}

/**
 * Deterministic system: update spatial params for all audio sources relative to
 * `listener`. Writes a {@link SpatialSourceParam} into the `audioSpatialParam`
 * store for each source. Returns the params for convenience/testing.
 */
export function spatialAudioSystem(
  world: World,
  model: SpatialAudioModel,
  listener: ListenerState,
): SpatialSourceParam[] {
  const sources = collectSources(world);
  const params = model.update(listener, sources);
  for (const p of params) {
    world.addComponent(AUDIO_SPATIAL_PARAM, Number(p.id) || 0, p);
  }
  return params;
}

export type { ListenerState, SpatialSourceParam };
