import { describe, it, expect } from 'vitest';
import { Vec3 } from '@omega/engine-math';
import { SpatialAudioModel, type AudioSourceInput, type ListenerState } from './model.js';

function centeredListener(): ListenerState {
  return { pos: Vec3.of(0, 0, 0), forward: Vec3.of(0, 0, -1) };
}

function src(id: string, pos: Vec3, gain = 1): AudioSourceInput {
  return { id, pos, gain };
}

describe('SpatialAudioModel.update — determinism', () => {
  it('produces identical params for identical listener/sources', () => {
    const m = new SpatialAudioModel();
    const l = centeredListener();
    const sources = [
      src('a', Vec3.of(3, 1, -4), 0.8),
      src('b', Vec3.of(-2, 0, 5), 1),
      src('c', Vec3.of(0, 0, -10), 0.5),
    ];
    const a = m.update(l, sources);
    const b = m.update(l, sources);
    expect(a).toEqual(b);
  });

  it('returns one entry per source, preserving input order', () => {
    const m = new SpatialAudioModel();
    const l = centeredListener();
    const sources = [src('x', Vec3.of(1, 0, -1)), src('y', Vec3.of(0, 2, -3))];
    const out = m.update(l, sources);
    expect(out.map((p) => p.id)).toEqual(['x', 'y']);
    expect(out.length).toBe(2);
  });

  it('returns empty array for no sources', () => {
    const m = new SpatialAudioModel();
    expect(m.update(centeredListener(), [])).toEqual([]);
  });
});

describe('SpatialAudioModel.update — distance attenuation', () => {
  it('is monotonically decreasing between refDistance and maxDistance', () => {
    const m = new SpatialAudioModel({ refDistance: 2, maxDistance: 50 });
    const l = centeredListener();
    const gains: number[] = [];
    for (let d = 0; d <= 50; d += 1) {
      const p = m.update(l, [src('s', Vec3.of(0, 0, -d))])[0];
      gains.push(p.gain);
    }
    // Strictly non-increasing as distance grows.
    for (let i = 1; i < gains.length; i++) {
      expect(gains[i]).toBeLessThanOrEqual(gains[i - 1]);
    }
    // Strictly decreasing in the rolloff region (2 < d < 50).
    for (let i = 3; i < 50; i++) {
      expect(gains[i]).toBeLessThan(gains[i - 1]);
    }
  });

  it('keeps gain at 1.0 inside refDistance', () => {
    const m = new SpatialAudioModel({ refDistance: 3 });
    const l = centeredListener();
    for (const d of [0, 1, 2, 3]) {
      const p = m.update(l, [src('s', Vec3.of(0, 0, -d))])[0];
      expect(p.gain).toBeCloseTo(1, 6);
    }
  });

  it('clamps gain to 0.0 at/after maxDistance', () => {
    const m = new SpatialAudioModel({ refDistance: 1, maxDistance: 20 });
    const l = centeredListener();
    for (const d of [20, 50, 1000]) {
      const p = m.update(l, [src('s', Vec3.of(0, 0, -d))])[0];
      expect(p.gain).toBe(0);
    }
  });

  it('reports distance equal to Euclidean separation', () => {
    const m = new SpatialAudioModel();
    const l: ListenerState = { pos: Vec3.of(1, 2, 3), forward: Vec3.of(0, 0, -1) };
    const p = m.update(l, [src('s', Vec3.of(4, 6, 3))])[0];
    expect(p.distance).toBeCloseTo(5, 6); // (3,4,0) -> 5
  });

  it('scales gain by the source base gain', () => {
    const m = new SpatialAudioModel({ refDistance: 100, maxDistance: 1000 });
    const l = centeredListener();
    const half = m.update(l, [src('s', Vec3.of(0, 0, -1), 0.5)])[0];
    const full = m.update(l, [src('s', Vec3.of(0, 0, -1), 1)])[0];
    expect(half.gain).toBeCloseTo(0.5 * full.gain, 6);
  });
});

describe('SpatialAudioModel.update — panning', () => {
  it('centers a source straight ahead or behind', () => {
    const m = new SpatialAudioModel();
    const l = centeredListener();
    const ahead = m.update(l, [src('s', Vec3.of(0, 0, -5))])[0];
    const behind = m.update(l, [src('s', Vec3.of(0, 0, 5))])[0];
    expect(ahead.panX).toBeCloseTo(0, 6);
    expect(behind.panX).toBeCloseTo(0, 6);
  });

  it('pans a source on the right to panX > 0 and left to panX < 0', () => {
    const m = new SpatialAudioModel();
    const l = centeredListener();
    // Right vector for forward=-Z, up=+Y is +X.
    const right = m.update(l, [src('r', Vec3.of(5, 0, 0))])[0];
    const left = m.update(l, [src('l', Vec3.of(-5, 0, 0))])[0];
    expect(right.panX).toBeGreaterThan(0);
    expect(left.panX).toBeLessThan(0);
    // Symmetric magnitudes for symmetric geometry.
    expect(right.panX).toBeCloseTo(-left.panX, 6);
  });

  it('keeps panX within [-1, 1]', () => {
    const m = new SpatialAudioModel();
    const l = centeredListener();
    for (const p of [
      Vec3.of(100, 0, 0),
      Vec3.of(-100, 0, 0),
      Vec3.of(0, 50, -1),
      Vec3.of(3, 4, 5),
    ]) {
      const param = m.update(l, [src('s', p)])[0];
      expect(param.panX).toBeGreaterThanOrEqual(-1);
      expect(param.panX).toBeLessThanOrEqual(1);
    }
  });

  it('coincident source (zero distance) is centered and full gain', () => {
    const m = new SpatialAudioModel();
    const l: ListenerState = { pos: Vec3.of(1, 1, 1), forward: Vec3.of(0, 0, -1) };
    const p = m.update(l, [src('s', Vec3.of(1, 1, 1))])[0];
    expect(p.distance).toBeCloseTo(0, 6);
    expect(p.panX).toBeCloseTo(0, 6);
    expect(p.gain).toBeCloseTo(1, 6);
  });
});

describe('SpatialAudioModel — construction bounds', () => {
  it('rejects maxDistance <= refDistance', () => {
    expect(() => new SpatialAudioModel({ refDistance: 10, maxDistance: 10 })).toThrow();
    expect(() => new SpatialAudioModel({ refDistance: 10, maxDistance: 5 })).toThrow();
  });

  it('rejects negative rolloff / refDistance', () => {
    expect(() => new SpatialAudioModel({ rolloffFactor: -1 })).toThrow();
    expect(() => new SpatialAudioModel({ refDistance: -2 })).toThrow();
  });
});
