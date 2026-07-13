import { describe, it, expect } from 'vitest';
import { JobScheduler } from './scheduler.js';
import { buffersEqual } from './shard.js';
import type { JobSpec, JobReducer } from './types.js';
import { defineType } from '@omega/reflect';

/** Build a spec whose reducer writes a deterministic per-item value. */
function specFor(name: string, count: number, seed: number): JobSpec {
  const Position = defineType(name);
  // Pure reducer: writes the item's slot with a value derived purely from
  // (seed, item). Each item writes only its own 2 floats -> disjoint slots.
  const reducer: JobReducer = (item, ctx) => {
    const rng = ctx.rngFor(item);
    const v = ctx.view(item);
    v[0] = rng.nextF64() * (item + 1);
    v[1] = rng.nextF64();
  };
  return { name, type: Position, count, blockSize: 16, seed, reducer };
}

describe('JobScheduler — determinism (parallel vs serial replay-equal)', () => {
  it('parallel worker output is byte-identical to serial inline output', async () => {
    const sched = new JobScheduler();
    const spec = specFor('job.test.position', 1000, 1337);
    expect(await sched.assertReplayEqual(spec, 4)).toBe(true);
  }, 20000);

  it('holds for many lane counts (1, 2, 3, 7, 8, 13)', async () => {
    const sched = new JobScheduler();
    const spec = specFor('job.test.vel', 2000, 99);
    for (const lanes of [1, 2, 3, 7, 8, 13]) {
      const serial = await sched.run(spec, { backend: 'inline' });
      const parallel = await sched.run(spec, { backend: 'worker', lanes });
      expect(buffersEqual(serial.buffer, parallel.buffer)).toBe(true);
    }
  }, 30000);

  it('holds for different seeds and counts (including non-divisible)', async () => {
    const sched = new JobScheduler();
    for (const [count, seed] of [[1, 1], [3, 2], [17, 5], [1023, 42], [5000, 7]] as const) {
      const spec = specFor(`job.p.${count}`, count, seed);
      const serial = await sched.run(spec, { backend: 'inline' });
      const parallel = await sched.run(spec, { backend: 'worker', lanes: 4 });
      expect(buffersEqual(serial.buffer, parallel.buffer)).toBe(true);
    }
  }, 30000);

  it('aggregate is identical across backends (independent check)', async () => {
    const sched = new JobScheduler();
    const spec = specFor('job.test.agg', 800, 2024);
    const serial = await sched.run(spec, { backend: 'inline' });
    const parallel = await sched.run(spec, { backend: 'worker', lanes: 5 });
    expect(serial.aggregate).toBe(parallel.aggregate);
    expect(serial.aggregate).not.toBe(0);
  }, 20000);

  it('same spec run twice (parallel) yields identical buffers (worker stable)', async () => {
    const sched = new JobScheduler();
    const spec = specFor('job.test.stable', 600, 11);
    const a = await sched.run(spec, { backend: 'worker', lanes: 4 });
    const b = await sched.run(spec, { backend: 'worker', lanes: 4 });
    expect(buffersEqual(a.buffer, b.buffer)).toBe(true);
    expect(a.aggregate).toBe(b.aggregate);
  }, 20000);

  it('reducer can read neighbor-immutable: result equals a fully-serial recompute', async () => {
    // Manually compute the expected buffer serially with the same formula.
    const sched = new JobScheduler();
    const spec = specFor('job.test.manual', 300, 555);
    const parallel = await sched.run(spec, { backend: 'worker', lanes: 3 });

    // Recompute inline (golden) using the same reducer logic.
    const { Rng } = await import('@omega/engine-core');
    const expectBuf = new Float64Array(spec.count * (spec.blockSize / 8));
    for (let item = 0; item < spec.count; item++) {
      const rng = new Rng((BigInt(spec.seed) ^ (BigInt(item) * 0x9e3779b97f4a7c15n)) & 0xffffffffffffffffn);
      expectBuf[item * 2] = rng.nextF64() * (item + 1);
      expectBuf[item * 2 + 1] = rng.nextF64();
    }
    const got = new Float64Array(parallel.buffer as ArrayBuffer);
    expect(Array.from(got)).toEqual(Array.from(expectBuf));
  }, 20000);

  it('invalid blockSize (not multiple of 8) is rejected by both backends', async () => {
    const sched = new JobScheduler();
    const bad = { ...specFor('job.test.bad', 10, 1), blockSize: 10 };
    await expect(sched.run(bad, { backend: 'inline' })).rejects.toThrow();
    await expect(sched.run(bad, { backend: 'worker', lanes: 2 })).rejects.toThrow();
  });
});
