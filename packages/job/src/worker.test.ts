import { describe, it, expect } from 'vitest';
import { Worker } from 'worker_threads';
import { Rng } from '@omega/engine-core';

/**
 * The Node worker lane (worker.mjs) embeds its own copy of the engine's
 * xoshiro256** RNG. This file proves, directly and self-contained, that the
 * embedded copy is bit-for-bit identical to `@omega/engine-core`'s `Rng` for
 * the same seed — which is the linchpin of the job system's determinism (the
 * parallel worker path must reproduce the serial inline path exactly).
 *
 * We spawn worker.mjs directly with a tiny descriptor whose reducer writes
 * `ctx.rngFor(item).nextF64()` into each item's slot, then compare the read-back
 * buffer against an inline computation using the engine Rng with the same
 * per-item seed-mix the scheduler/worker both apply.
 */

function spawnWorker(desc: unknown): Promise<Float64Array> {
  return new Promise((resolve, reject) => {
    const w = new Worker(new URL('./worker.mjs', import.meta.url), { workerData: desc });
    w.on('error', reject);
    w.on('message', () => {
      // Read the shared buffer back (copy out, then terminate).
      const buf = (desc as any).buffer as SharedArrayBuffer;
      const out = new Float64Array(buf.slice(0));
      w.terminate();
      resolve(out);
    });
  });
}

describe('worker.mjs RNG equivalence (determinism linchpin)', () => {
  it('embedded worker RNG matches engine Rng for the same seed/item mix', async () => {
    const count = 64;
    const blockSize = 16; // 2 floats per item
    const seed = 0x1234abcd;
    const buffer = new SharedArrayBuffer(count * blockSize);
    const barrier = new SharedArrayBuffer(4);

    const desc = {
      name: 'rng-eq',
      typeId: 0,
      typeName: 't',
      count,
      blockSize,
      seed,
      // Reducer: write rngFor(item) into the item's 2-float slot.
      reducerSrc: '(item, ctx) => { const v = ctx.view(item); const r = ctx.rngFor(item); v[0] = r.nextF64(); v[1] = r.nextF64(); }',
      buffer,
      barrier,
      start: 0,
      end: count,
    };

    const got = await spawnWorker(desc);

    // Recompute inline with the engine Rng using the SAME per-item seed-mix.
    // IMPORTANT: the mix must be passed as an exact 64-bit BigInt (as the
    // scheduler/inline/worker all do) — NOT via Number(), which truncates
    // large mixes to 53 bits and would diverge from the worker.
    const floatsPerItem = blockSize / 8;
    const expected = new Float64Array(count * floatsPerItem);
    const MASK64 = (1n << 64n) - 1n;
    for (let item = 0; item < count; item++) {
      const mixed = (BigInt(seed) ^ (BigInt(item) * 0x9e3779b97f4a7c15n)) & MASK64;
      const r = new Rng(mixed);
      for (let k = 0; k < floatsPerItem; k++) expected[item * floatsPerItem + k] = r.nextF64();
    }

    expect(Array.from(got)).toEqual(Array.from(expected));
  }, 15000);

  it('worker RNG is reproducible across two runs (stable)', async () => {
    const count = 32;
    const blockSize = 16;
    const seed = 7;
    const makeDesc = () => ({
      name: 'rng-stable',
      typeId: 0,
      typeName: 't',
      count,
      blockSize,
      seed,
      reducerSrc: '(item, ctx) => { const v = ctx.view(item); v[0] = ctx.rngFor(item).nextF64(); }',
      buffer: new SharedArrayBuffer(count * blockSize),
      barrier: new SharedArrayBuffer(4),
      start: 0,
      end: count,
    });
    const a = await spawnWorker(makeDesc());
    const b = await spawnWorker(makeDesc());
    expect(Array.from(a)).toEqual(Array.from(b));
  }, 15000);
});
