import { describe, it, expect } from 'vitest';
import { World } from '@omega/engine-core';
import { Vec3 } from '@omega/engine-math';
import { SpatialAudioModel, type SpatialSourceParam } from './model.js';
import {
  collectSources,
  spatialAudioSystem,
  AUDIO_SOURCE,
  AUDIO_SPATIAL_PARAM,
  type AudioSourceComponent,
} from './ecs.js';

function makeWorld(): World {
  const w = new World();
  // Entity 0: near source straight ahead.
  w.spawn('position', () => Vec3.of(0, 0, -2));
  w.addComponent<AudioSourceComponent>(AUDIO_SOURCE, 0, { id: '0', gain: 1 });
  // Entity 1: far source on the right.
  w.spawn('position', () => Vec3.of(10, 0, 0));
  w.addComponent<AudioSourceComponent>(AUDIO_SOURCE, 1, { id: '1', gain: 0.5 });
  return w;
}

describe('ECS integration', () => {
  it('collects only entities with both position and audioSource', () => {
    const w = makeWorld();
    const sources = collectSources(w);
    expect(sources.length).toBe(2);
    expect(sources.map((s) => s.id).sort()).toEqual(['0', '1']);
  });

  it('writes deterministic params back into the param store', () => {
    const w = makeWorld();
    const m = new SpatialAudioModel({ refDistance: 1, maxDistance: 100 });
    const listener = { pos: Vec3.of(0, 0, 0), forward: Vec3.of(0, 0, -1) };

    const a = spatialAudioSystem(w, m, listener);
    const b = spatialAudioSystem(w, m, listener);
    expect(a).toEqual(b);

    const p0 = w.getComponent<SpatialSourceParam>(AUDIO_SPATIAL_PARAM, 0);
    const p1 = w.getComponent<SpatialSourceParam>(AUDIO_SPATIAL_PARAM, 1);
    expect(p0).toBeDefined();
    expect(p1).toBeDefined();
    // Near source louder than far source.
    expect(p0!.gain).toBeGreaterThan(p1!.gain);
    // Right source panned right.
    expect(p1!.panX).toBeGreaterThan(0);
  });
});
