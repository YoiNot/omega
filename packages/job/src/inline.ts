/**
 * @omega/job — inline (single-thread, serial) executor.
 *
 * This is the *reference* execution path: it runs the whole job on the calling
 * thread, in ascending item order, sharded into a single lane. Its output is
 * the determinism gold-standard that the parallel worker backend must match
 * byte-for-byte. No worker_threads, no Atomics — just a deterministic loop.
 */

import type { JobSpec, JobResult, JobContext } from './types.js';
import { partition, makeContext, mergeResult } from './shard.js';
import { Rng } from '@omega/engine-core';

/** Run a job inline (serial). Always produces the canonical deterministic result. */
export function runInline(spec: JobSpec, lanes = 1): JobResult {
  if (!spec.reducer) {
    throw new Error(`job ${spec.name}: inline backend requires a live reducer`);
  }
  if (spec.blockSize % 8 !== 0) {
    throw new Error(`job ${spec.name}: blockSize must be a multiple of 8`);
  }
  // The inline reference path writes into a normal ArrayBuffer. Determinism is
  // defined on the *bytes*, not on whether the buffer is shared; the parallel
  // worker path uses a SharedArrayBuffer (it must, to share across lanes). The
  // byte contents are identical, which `buffersEqual` verifies. We avoid a
  // SharedArrayBuffer here because dropping the typed-array view can zero the
  // buffer on a cross-thread (vitest worker) return.
  const buffer = new ArrayBuffer(spec.count * spec.blockSize);

  // Per-item view: a fresh Float64Array backed directly by `buffer` (not via an
  // intermediate `whole` view, whose collection under a worker-pool runtime can
  // detach the data). Because `buffer` itself is retained in the returned
  // result, these fresh views persist correctly.
  const floatsPerItem = spec.blockSize / 8;
  const view = (item: number): Float64Array =>
    new Float64Array(buffer, item * spec.blockSize, floatsPerItem);
  // Per-item RNG seeded by (seed, item): identical across every backend.
  const rngFor = (item: number): Rng =>
    new Rng((BigInt(spec.seed) ^ (BigInt(item) * 0x9e3779b97f4a7c15n)) & 0xffffffffffffffffn);

  const ctx: JobContext = makeContext(
    {
      typeId: spec.type.id,
      typeName: spec.type.name,
      count: spec.count,
      seed: spec.seed,
      blockSize: spec.blockSize,
      buffer,
    },
    { view, rngFor },
  );

  // Single reference lane: run ALL items in ascending order. We still use the
  // same `partition` so the item->slot mapping is identical to the parallel
  // path; we just execute every shard sequentially (gold-standard order).
  for (const [start, end] of partition(spec.count, Math.max(1, lanes))) {
    for (let item = start; item < end; item++) spec.reducer(item, ctx);
  }

  return {
    name: spec.name,
    typeId: spec.type.id,
    count: spec.count,
    blockSize: spec.blockSize,
    buffer,
    aggregate: mergeResult(buffer, spec.count, spec.blockSize),
    backend: 'inline',
    lanes: 1,
  };
}
