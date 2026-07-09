import { describe, it, expect } from 'vitest';
import { Vec3 } from '@omega/engine-math';
import { SpatialMixer } from './spatial.js';
import type { AudioListener, AudioSource } from './types.js';

function centeredListener(): AudioListener {
  return {
    position: Vec3.of(0, 0, 0),
    forward: Vec3.of(0, 0, -1), // looking down -Z
    up: Vec3.of(0, 1, 0),
  };
}

function sourceAt(pos: Vec3, gain = 1): AudioSource {
  return { id: 's', position: pos, gain };
}

describe('SpatialMixer.computeGains', () => {
  it('keeps gains within [0, 1]', () => {
    const m = new SpatialMixer();
    const l = centeredListener();
    for (const p of [
      Vec3.of(0, 0, -1),
      Vec3.of(10, 0, -1),
      Vec3.of(-5, 2, 3),
      Vec3.of(100, 100, 100),
    ]) {
      const g = m.computeGains(l, sourceAt(p, 1));
      expect(g.left).toBeGreaterThanOrEqual(0);
      expect(g.left).toBeLessThanOrEqual(1);
      expect(g.right).toBeGreaterThanOrEqual(0);
      expect(g.right).toBeLessThanOrEqual(1);
      expect(g.lowpass).toBeGreaterThanOrEqual(0);
      expect(g.lowpass).toBeLessThanOrEqual(1);
    }
  });

  it('is symmetric for a centered (straight ahead) source', () => {
    const m = new SpatialMixer();
    const g = m.computeGains(centeredListener(), sourceAt(Vec3.of(0, 0, -5)));
    expect(g.left).toBeCloseTo(g.right, 6);
  });

  it('attenuates with distance', () => {
    const m = new SpatialMixer();
    const l = centeredListener();
    const near = m.computeGains(l, sourceAt(Vec3.of(0, 0, -2)));
    const far = m.computeGains(l, sourceAt(Vec3.of(0, 0, -40)));
    const sumNear = near.left + near.right;
    const sumFar = far.left + far.right;
    expect(sumNear).toBeGreaterThan(sumFar);
    expect(sumFar).toBeLessThan(sumNear);
  });

  it('is deterministic for identical listener/source', () => {
    const m = new SpatialMixer({ refDistance: 2, maxDistance: 50 });
    const l = centeredListener();
    const s = sourceAt(Vec3.of(3, 1, -4), 0.8);
    const a = m.computeGains(l, s);
    const b = m.computeGains(l, s);
    expect(a).toEqual(b);
  });

  it('applies occlusion to the low-pass factor', () => {
    const m = new SpatialMixer();
    const l = centeredListener();
    const s = sourceAt(Vec3.of(0, 0, -5));
    const clear = m.computeGains(l, s, { occlusion: 0 });
    const blocked = m.computeGains(l, s, { occlusion: 1 });
    expect(blocked.lowpass).toBeGreaterThan(clear.lowpass);
  });

  it('pans a source on the right towards the right channel', () => {
    const m = new SpatialMixer();
    const l = centeredListener();
    // Right vector for forward=-Z, up=+Y is +X.
    const right = m.computeGains(l, sourceAt(Vec3.of(5, 0, 0)));
    const left = m.computeGains(l, sourceAt(Vec3.of(-5, 0, 0)));
    expect(right.right).toBeGreaterThan(right.left);
    expect(left.left).toBeGreaterThan(left.right);
  });
});
