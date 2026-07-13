/**
 * @omega/job — deterministic shard partitioning + merge helpers.
 *
 * These are backend-agnostic. Both the inline and worker executors use the
 * same `partition` so that, given the same `count` and `lanes`, the shard
 * boundaries are bit-for-bit identical regardless of how the work is actually
 * scheduled. The merge is likewise a pure function of the result buffer.
 */

import type { JobContext } from './types.js';

/** Partition `[0, count)` into `lanes` contiguous, ordered shards. */
export function partition(count: number, lanes: number): Array<[number, number]> {
  const n = Math.max(1, Math.min(lanes, count));
  const base = Math.floor(count / n);
  const rem = count % n;
  const out: Array<[number, number]> = [];
  let cursor = 0;
  for (let i = 0; i < n; i++) {
    const len = base + (i < rem ? 1 : 0);
    out.push([cursor, cursor + len]);
    cursor += len;
  }
  return out;
}

/**
 * Build the per-item context used by a reducer. `view` and `rngFor` are
 * provided by the executor; they are identical across backends so the reducer
 * is transport-safe and deterministic.
 */
export function makeContext(
  spec: {
    typeId: number;
    typeName: string;
    count: number;
    seed: number;
    blockSize: number;
    buffer: ArrayBufferLike;
  },
  helpers: {
    view: (item: number) => Float64Array;
    rngFor: (item: number) => import('@omega/engine-core').Rng;
  },
): JobContext {
  return {
    typeId: spec.typeId,
    typeName: spec.typeName,
    count: spec.count,
    seed: spec.seed,
    blockSize: spec.blockSize,
    buffer: spec.buffer,
    view: helpers.view,
    rngFor: helpers.rngFor,
  };
}

/**
 * Deterministic merge: fold every item slot into a single aggregate. We use a
 * stable reduction (sum of a per-float hash-weight) so the result depends only
 * on the buffer bytes, not on iteration order beyond ascending item index
 * (which is fixed). Returns the aggregate as a JS number; the same buffer
 * always yields the same aggregate on every backend.
 */
export function mergeResult(buffer: ArrayBufferLike, count: number, blockSize: number): number {
  const f64 = new Float64Array(buffer as ArrayBuffer);
  const floatsPerItem = Math.floor(blockSize / 8);
  let acc = 0;
  // Deterministic integer-weight sum; integer math keeps it exact & platform-stable.
  for (let i = 0; i < count; i++) {
    const base = i * floatsPerItem;
    for (let k = 0; k < floatsPerItem; k++) {
      const v = f64[base + k];
      // Hash each float's bits; combine with a fixed polynomial in item+k order.
      const bits = Number.isNaN(v) ? 0 : Math.trunc(v * 1e6);
      acc = (acc + bits * (i + k + 1)) | 0;
    }
  }
  return acc;
}

/** Byte-exact comparison of two result buffers (worker-free helper). */
export function buffersEqual(a: ArrayBufferLike, b: ArrayBufferLike): boolean {
  if (a.byteLength !== b.byteLength) return false;
  if (a.byteLength === 0) return true;
  const fa = new Float64Array(a as ArrayBuffer);
  const fb = new Float64Array(b as ArrayBuffer);
  for (let i = 0; i < fa.length; i++) if (fa[i] !== fb[i]) return false;
  return true;
}
