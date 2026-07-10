import { describe, it, expect } from 'vitest';
import { World } from '@omega/ecs';
import { Codec } from '@omega/net-replication';
import {
  computeDelta,
  encodeDelta,
  decodeDelta,
  applyDeltaTo,
  fullDelta,
  DeltaCompressor,
} from './delta.js';
import { makeCodec, seed, step, Position } from './fixtures.js';

/** Project a snapshot's bytes back into a fresh world and return its logical form. */
function logicalOf(data: Uint8Array, codec: Codec) {
  const w = new World();
  codec.deserialize(data, w);
  return codec.toLogical(w);
}

/** Serialize a world as a WorldSnapshot. */
function snap(world: World, codec: Codec, tick: number) {
  return { tick, data: codec.serialize(world) };
}

describe('delta determinism', () => {
  it('identical snapshot pairs produce byte-identical deltas', () => {
    const codec = makeCodec();
    const a = new World();
    seed(a);
    const b = new World();
    seed(b);

    const before = codec.toLogical(a);
    const after = codec.toLogical(b);
    const d1 = encodeDelta(computeDelta(before, after, 5));
    const d2 = encodeDelta(computeDelta(before, after, 5));
    expect(d1).toEqual(d2);
  });

  it('apply(delta) reconstructs the target snapshot byte-for-byte', () => {
    const codec = makeCodec();
    const world = new World();
    seed(world);
    const beforeSnap = snap(world, codec, 0);

    step(world);
    const afterSnap = snap(world, codec, 1);

    const delta = computeDelta(logicalOf(beforeSnap.data, codec), logicalOf(afterSnap.data, codec), 1);
    const reconstruct = new World();
    const rebuilt = applyDeltaTo(reconstruct, beforeSnap, delta, codec);
    expect(rebuilt.data).toEqual(afterSnap.data);
    expect(rebuilt.tick).toBe(1);
  });

  it('a no-change frame yields an empty (mode 0) delta', () => {
    const codec = makeCodec();
    const a = new World();
    seed(a);
    const logical = codec.toLogical(a);
    const d = computeDelta(logical, logical, 3);
    const frame = encodeDelta(d);
    expect(frame[4]).toBe(0); // mode byte immediately after the u32 tick
    expect(decodeDelta(frame).created).toHaveLength(0);
  });
});

describe('delta round-trip via DeltaCompressor', () => {
  it('sender + receiver converge over a sequence of frames', () => {
    const codec = makeCodec();

    // Seed both endpoints identically so frame 0 is a full delta of the same base.
    const serverWorld = new World();
    seed(serverWorld);
    const recvWorld = new World();
    seed(recvWorld);

    const sender = new DeltaCompressor();
    const receiver = new DeltaCompressor();

    // Frame 0: full delta from the shared initial snapshot.
    const f0 = sender.encodeNext(snap(serverWorld, codec, 0), codec);
    receiver.applyNext(recvWorld, codec, f0);
    expect(codec.serialize(recvWorld)).toEqual(codec.serialize(serverWorld));

    // Advance server, send partial deltas for ticks 1..10.
    for (let t = 1; t <= 10; t++) {
      step(serverWorld);
      const frame = sender.encodeNext(snap(serverWorld, codec, t), codec);
      const rebuilt = receiver.applyNext(recvWorld, codec, frame);
      expect(rebuilt.data).toEqual(codec.serialize(serverWorld));
    }
    expect(receiver.base!.tick).toBe(10);
  });

  it('partial deltas only carry changed components', () => {
    const codec = makeCodec();
    const serverWorld = new World();
    seed(serverWorld);
    const sender = new DeltaCompressor();
    const f0 = sender.encodeNext(snap(serverWorld, codec, 0), codec);
    expect(decodeDelta(f0).full).toBe(true);

    // Move entity 0 only; entity 1 unchanged -> delta should NOT mention entity 1.
    serverWorld.setComponent(0, Position, { x: 99, y: 99 });
    const f1 = sender.encodeNext(snap(serverWorld, codec, 1), codec);
    const d1 = decodeDelta(f1);
    expect(d1.full).toBe(false);
    expect(d1.updated.map((u) => u.id)).toEqual([0]);
    expect(d1.created).toHaveLength(0);
    expect(d1.removed).toHaveLength(0);
  });
});

describe('full vs partial delta', () => {
  it('fullDelta carries every entity', () => {
    const codec = makeCodec();
    const w = new World();
    seed(w);
    const d = fullDelta(codec.toLogical(w), 0);
    expect(d.full).toBe(true);
    expect(d.created.length).toBe(2);
  });

  it('removed entities appear in the delta and are destroyed on apply', () => {
    const codec = makeCodec();
    const before = new World();
    seed(before);
    const beforeSnap = snap(before, codec, 0);

    const after = new World();
    seed(after);
    after.destroyEntity(1); // remove entity 1
    const afterSnap = snap(after, codec, 1);

    const d = computeDelta(logicalOf(beforeSnap.data, codec), logicalOf(afterSnap.data, codec), 1);
    expect(d.removed).toEqual([1]);
    const recv = new World();
    applyDeltaTo(recv, beforeSnap, d, codec);
    expect(recv.entities().slice().sort((a, b) => a - b)).toEqual([0]);
  });
});
