/**
 * @omega/job — browser Web Worker entry point (type + shape reference).
 *
 * In the Node build we use `worker_threads`; in a browser we would spin a
 * `new Worker(new URL('./browser-worker.js', import.meta.url), { type: 'module' })`
 * and post the `JobDescriptor` in. This file mirrors `worker.ts` but targets
 * the Web Worker global scope (`self`, `postMessage` instead of `parentPort`).
 * It is intentionally dependency-light and ships as a separate entry so a
 * bundler can pick the right one per platform.
 *
 * Determinism is identical to the Node lane: disjoint shards, same per-item
 * RNG factory, same merge semantics. The browser build is *present as a type*
 * and is kept in lock-step with `worker.ts` by construction.
 */

/// <reference lib="webworker" />
import { Rng } from '@omega/engine-core';
import type { JobDescriptor } from './types.js';

function buildReducer(src: string): (item: number, ctx: any) => void {
  // eslint-disable-next-line no-new-func
  return new Function(`return (${src})`)() as (item: number, ctx: any) => void;
}

function runLane(desc: JobDescriptor): void {
  const reducer = buildReducer(desc.reducerSrc);
  const floatsPerItem = desc.blockSize / 8;

  const view = (item: number): Float64Array =>
    new Float64Array(desc.buffer, item * desc.blockSize, floatsPerItem);
  const rngFor = (item: number): Rng =>
    new Rng((BigInt(desc.seed) ^ (BigInt(item) * 0x9e3779b97f4a7c15n)) & 0xffffffffffffffffn);

  const ctx = {
    typeId: desc.typeId,
    typeName: desc.typeName,
    count: desc.count,
    seed: desc.seed,
    blockSize: desc.blockSize,
    buffer: desc.buffer as ArrayBufferLike,
    view,
    rngFor,
  };

  for (let item = desc.start; item < desc.end; item++) reducer(item, ctx);

  if (desc.barrier) {
    const b = new Int32Array(desc.barrier);
    Atomics.add(b, 0, 1);
    Atomics.notify(b, 0);
  }
  (self as unknown as Worker).postMessage({ done: true });
}

// In a real browser Worker this would be wired via onmessage. Kept as a type
// reference for parity; the Node scheduler uses worker.ts.
declare const self: unknown;
export type BrowserLane = typeof runLane;
export const browserRunLane = runLane;
