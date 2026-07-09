import { describe, it, expect } from 'vitest';
import { encodeState, decodeState, type WorldStateLike } from './format.js';
import { Vec3 } from '@omega/engine-math';

const sample: WorldStateLike = {
  entities: [
    { id: 0, pos: new Vec3(0, 0, 0), tag: 'player' },
    { id: 42, pos: new Vec3(1.5, -2.5, 3.25), tag: 'enemy' },
    { id: 9001, pos: new Vec3(-100.125, 0, 7.0), tag: 'npc/ω' },
  ],
};

describe('format encodeState/decodeState', () => {
  it('round-trips an exact world state', () => {
    const buf = encodeState(sample);
    const out = decodeState(buf);
    expect(out.entities.length).toBe(sample.entities.length);
    for (let i = 0; i < sample.entities.length; i++) {
      const a = sample.entities[i];
      const b = out.entities[i];
      expect(b.id).toBe(a.id);
      expect(b.pos.x).toBeCloseTo(a.pos.x, 6);
      expect(b.pos.y).toBeCloseTo(a.pos.y, 6);
      expect(b.pos.z).toBeCloseTo(a.pos.z, 6);
      expect(b.tag).toBe(a.tag);
    }
  });

  it('is deterministic across two runs', () => {
    const a = encodeState(sample);
    const b = encodeState(sample);
    expect([...a]).toEqual([...b]);
  });

  it('handles an empty world deterministically', () => {
    const empty: WorldStateLike = { entities: [] };
    const out = decodeState(encodeState(empty));
    expect(out.entities).toEqual([]);
  });

  it('throws on a malformed buffer (truncated)', () => {
    const buf = encodeState(sample);
    // drop the last byte so the trailing string is incomplete
    const truncated = buf.slice(0, buf.length - 1);
    expect(() => decodeState(truncated)).toThrow(RangeError);
  });

  it('throws on a buffer that is too short for the count prefix', () => {
    expect(() => decodeState(new Uint8Array([1, 2]))).toThrow(RangeError);
  });
});
