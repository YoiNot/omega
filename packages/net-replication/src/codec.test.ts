import { describe, it, expect } from 'vitest';
import { World } from '@omega/ecs';
import { BinaryWriter, BinaryReader } from './codec.js';
import { makeCodec, seedWorld, Position, Velocity, RenderHint } from './fixtures.js';

describe('BinaryWriter / BinaryReader', () => {
  it('round-trips mixed little-endian fields', () => {
    const w = new BinaryWriter();
    w.u8(255);
    w.u32(0xdeadbeef);
    w.i32(-12345);
    w.f32(3.5);
    w.str('hello');
    const bytes = w.toUint8Array();

    const r = new BinaryReader(bytes);
    expect(r.u8()).toBe(255);
    expect(r.u32()).toBe(0xdeadbeef >>> 0);
    expect(r.i32()).toBe(-12345);
    expect(r.f32()).toBeCloseTo(3.5, 6);
    expect(r.str()).toBe('hello');
    expect(r.remaining).toBe(0);
  });

  it('throws on truncated input', () => {
    const w = new BinaryWriter();
    w.u32(7);
    const r = new BinaryReader(w.toUint8Array().subarray(0, 2));
    expect(() => r.u32()).toThrow(RangeError);
  });
});

describe('Codec — (de)serialization', () => {
  it('round-trips a world losslessly for registered components', () => {
    const codec = makeCodec();
    const src = new World();
    seedWorld(src);

    const bytes = codec.serialize(src);
    const dst = new World();
    const ids = codec.deserialize(bytes, dst);

    // Two entities rematerialized.
    expect(ids).toEqual([0, 1]);
    expect(dst.entityCount).toBe(2);

    // Replicated components present and equal.
    expect(dst.getComponent(0, Position)).toEqual({ x: 0, y: 0 });
    expect(dst.getComponent(0, Velocity)).toEqual({ x: 0, y: 0 });
    expect(dst.getComponent(1, Position)).toEqual({ x: 10, y: -4 });
    expect(dst.getComponent(1, Velocity)).toEqual({ x: 1, y: 0 });
  });

  it('does NOT replicate components that were not registerComponent()\'d', () => {
    const codec = makeCodec(); // RenderHint intentionally omitted
    const src = new World();
    seedWorld(src);
    const dst = new World();
    codec.deserialize(codec.serialize(src), dst);

    // RenderHint is local-only, so it must be absent on the rebuilt world.
    expect(dst.hasComponent(0, RenderHint)).toBe(false);
    expect(dst.hasComponent(1, RenderHint)).toBe(false);
  });

  it('is deterministic: same world -> same bytes', () => {
    const a = makeCodec();
    const b = makeCodec();
    const w1 = new World();
    seedWorld(w1);
    const w2 = new World();
    seedWorld(w2);

    expect([...a.serialize(w1)]).toEqual([...b.serialize(w2)]);
  });

  it('handles multiple components per entity and an empty world', () => {
    const codec = makeCodec();
    const full = new World();
    seedWorld(full);
    const bytes = codec.serialize(full);
    expect([...codec.serialize(new World())]).not.toEqual([...bytes]);

    const empty = new World();
    codec.deserialize(codec.serialize(new World()), empty);
    expect(empty.entityCount).toBe(0);
  });
});
