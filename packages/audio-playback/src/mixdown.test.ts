import { describe, it, expect } from 'vitest';
import { Vec3 } from '@omega/engine-math';
import { SpatialAudioModel, type ListenerState } from '@omega/audio-spatial';
import { computeMixMatrix, type MixdownSourceSet } from './mixdown.js';

function listener(id: string, pos: Vec3, forward = Vec3.of(0, 0, -1)): { id: string; state: ListenerState } {
  return { id, state: { pos, forward } };
}

describe('computeMixMatrix — determinism', () => {
  const model = new SpatialAudioModel({ refDistance: 1, maxDistance: 100 });
  const sources: MixdownSourceSet[] = [
    { id: 'a', input: { id: 'a', pos: Vec3.of(3, 0, -4), gain: 0.8 } },
    { id: 'b', input: { id: 'b', pos: Vec3.of(-2, 0, 5), gain: 1 } },
  ];
  const listeners = [listener('L0', Vec3.of(0, 0, 0)), listener('L1', Vec3.of(10, 0, 0))];

  it('produces an identical matrix for identical model/sources/listeners', () => {
    const m1 = computeMixMatrix(model, sources, listeners);
    const m2 = computeMixMatrix(model, sources, listeners);
    expect(m1).toEqual(m2);
    expect(m1.rows.length).toBe(sources.length * listeners.length);
  });

  it('preserves a stable listener-major row order', () => {
    const m = computeMixMatrix(model, sources, listeners);
    const ids = m.rows.map((r) => `${r.listenerId}:${r.id}`);
    expect(ids).toEqual([
      'L0:a',
      'L0:b',
      'L1:a',
      'L1:b',
    ]);
  });

  it('reports per-source min gain and max distance across listeners', () => {
    const m = computeMixMatrix(model, sources, listeners);
    // Source b is far from L1 (distance 15) vs L0 (distance ~5.4).
    expect(m.maxDistanceBySource['b']).toBeGreaterThan(m.maxDistanceBySource['a']);
    // min gain across listeners should be <= each individual gain.
    for (const row of m.rows) {
      expect(row.gain).toBeGreaterThanOrEqual(m.minGainBySource[row.id] - 1e-9);
    }
  });

  it('handles a single listener and no sources', () => {
    const one = computeMixMatrix(model, sources, [listener('L', Vec3.of(0, 0, 0))]);
    expect(one.listenerCount).toBe(1);
    expect(one.sourceCount).toBe(2);

    const none = computeMixMatrix(model, [], [listener('L', Vec3.of(0, 0, 0))]);
    expect(none.rows).toEqual([]);
    expect(none.minGainBySource).toEqual({});
  });
});
