/**
 * @omega/job — deterministic parallel job scheduler.
 *
 * Schedules data-parallel ECS jobs and guarantees bit-identical results across
 * the serial (inline) and parallel (worker) backends. Design:
 *
 *  1. Each job is split into N contiguous, ordered shards via `partition()`
 *     (identical boundaries on every backend).
 *  2. Each shard runs the same pure reducer over its items, writing only into
 *     its own disjoint SAB slots (items never alias).
 *  3. The reducer is a pure function of `(item, ctx)`; `ctx.rngFor(item)` is a
 *     deterministic RNG seeded by `(seed, item)` — identical in every backend.
 *  4. The final buffer is therefore a pure function of the spec; the order in
 *     which shards finish (serial vs interleaved across threads) cannot change
 *     a single byte. `mergeResult` confirms this with a deterministic aggregate.
 *
 * Two backends:
 *  - 'inline' : serial reference (gold standard). No threads.
 *  - 'worker' : node `worker_threads`, one lane per worker, real SharedArrayBuffer.
 *
 * Usage:
 *   const sched = new JobScheduler();
 *   const res = await sched.run({
 *     name: 'integrate', type: Position, count: N, blockSize: 16, seed: 1,
 *     reducer: (i, ctx) => { const v = ctx.view(i); v[0] = ctx.rngFor(i).nextF64(); },
 *   }, { backend: 'worker', lanes: 4 });
 */

import { Worker } from 'worker_threads';
import type { JobSpec, JobResult, JobDescriptor, RunOptions } from './types.js';
import { partition, mergeResult } from './shard.js';
import { runInline } from './inline.js';

/**
 * Resolve the worker module URL. The Node lane is a committed, self-contained
 * `worker.mjs` (plain JS) so it loads under both the TS source tree (vitest)
 * and the built `dist` tree without any bundler. This is the Node-side
 * realization of the browser Web Worker design in `browser-worker.ts`.
 */
function resolveWorkerUrl(): URL {
  return new URL('./worker.mjs', import.meta.url);
}
function resolveReducerSrc(spec: JobSpec): string {
  if (spec.reducerSrc) return spec.reducerSrc;
  if (spec.reducer) return spec.reducer.toString();
  throw new Error(`job ${spec.name}: needs reducer or reducerSrc`);
}

/**
 * Execute a job with real worker lanes (Node worker_threads). Returns a result
 * bit-identical to `runInline` for the same spec.
 */
function runWorker(spec: JobSpec, lanes: number): Promise<JobResult> {
  const reducerSrc = resolveReducerSrc(spec);
  if (spec.blockSize % 8 !== 0) {
    throw new Error(`job ${spec.name}: blockSize must be a multiple of 8`);
  }
  const shards = partition(spec.count, lanes);
  const actualLanes = shards.length;
  const buffer = new SharedArrayBuffer(spec.count * spec.blockSize);
  const barrier = new SharedArrayBuffer(4); // Int32Array[0] = completed lanes

  return new Promise<JobResult>((resolve, reject) => {
    const workers: Worker[] = [];
    let finished = 0;
    let errored = false;

    shards.forEach(([start, end]) => {
      const desc: JobDescriptor = {
        name: spec.name,
        typeId: spec.type.id,
        typeName: spec.type.name,
        count: spec.count,
        blockSize: spec.blockSize,
        seed: spec.seed,
        reducerSrc,
        buffer,
        barrier,
        start,
        end,
      };
      // Resolve the worker module relative to this file (compiled dist or src via ts).
      const worker = new Worker(resolveWorkerUrl(), {
        workerData: desc,
      });
      workers.push(worker);
      worker.on('message', () => {
        finished++;
        if (finished === actualLanes) closeAll();
      });
      worker.on('error', (err) => {
        if (errored) return;
        errored = true;
        closeAll();
        reject(err);
      });
    });

    function closeAll(): void {
      for (const w of workers) w.terminate();
      if (errored) return;
      resolve({
        name: spec.name,
        typeId: spec.type.id,
        count: spec.count,
        blockSize: spec.blockSize,
        buffer,
        aggregate: mergeResult(buffer, spec.count, spec.blockSize),
        backend: 'worker',
        lanes: actualLanes,
      });
    }
  });
}

export class JobScheduler {
  /**
   * Run a job. Picks the backend from `opts` (default 'inline'); parallel work
   * uses real worker lanes. Returns a result byte-identical across backends.
   */
  async run(
    spec: JobSpec,
    opts: RunOptions = {},
  ): Promise<JobResult> {
    const backend = opts.backend ?? 'inline';
    const lanes = opts.lanes ?? Math.min(spec.count, 4);
    if (backend === 'worker') {
      if (spec.count <= 0) {
        // Degenerate job: produce an empty buffer deterministically.
        const buffer = new SharedArrayBuffer(0);
        return {
          name: spec.name,
          typeId: spec.type.id,
          count: 0,
          blockSize: spec.blockSize,
          buffer,
          aggregate: 0,
          backend: 'worker',
          lanes: 0,
        };
      }
      return runWorker(spec, lanes);
    }
    return runInline(spec, lanes);
  }

  /**
   * Determinism gate helper: run the same spec on both backends and assert the
   * result buffers are byte-identical. Returns true iff they match. Throws if
   * `reducer` is missing (worker needs `reducerSrc` derivable from it).
   */
  async assertReplayEqual(spec: JobSpec, lanes = 4): Promise<boolean> {
    const serial = await this.run(spec, { backend: 'inline' });
    const parallel = await this.run(spec, { backend: 'worker', lanes });
    return buffersEqual(serial.buffer, parallel.buffer);
  }
}

/** Byte-exact comparison of two result buffers. */
export function buffersEqual(a: ArrayBufferLike, b: ArrayBufferLike): boolean {
  if (a.byteLength !== b.byteLength) return false;
  if (a.byteLength === 0) return true;
  const fa = new Float64Array(a as ArrayBuffer);
  const fb = new Float64Array(b as ArrayBuffer);
  if (fa.length !== fb.length) return false;
  for (let i = 0; i < fa.length; i++) {
    if (fa[i] !== fb[i]) return false;
  }
  return true;
}
