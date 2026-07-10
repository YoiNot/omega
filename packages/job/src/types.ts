/**
 * @omega/job — types shared by the deterministic job system.
 *
 * The job system runs a *data-parallel* ECS job: the same pure reducer is
 * applied to every entity (item) index in `[0, count)`, each writing to a
 * disjoint slot in a shared result buffer. Because items never write each
 * other's slots and the reducer is a pure function of `(item, seed)`, the
 * order in which shards run — serial on one lane, or spread across N worker
 * lanes — does not change the final buffer. That is the determinism guarantee.
 *
 * Transport note: a `JobReducer` is a plain function defined on some other
 * module/thread; it cannot be structured-cloned across a worker boundary.
 * So a `JobSpec` carries the reducer as `reducerSrc` (its `.toString()`), and
 * the worker reconstructs it with `new Function`. All other job metadata is
 * plain, clone-safe data (the component `type` is an `@omega/reflect` token).
 */

import type { ComponentType } from '@omega/reflect';

/** A per-item reducer. Pure: writes only into its own `item` slot, reads only `ctx`. */
export type JobReducer = (item: number, ctx: JobContext) => void;

/**
 * Context handed to each reducer invocation. Every field is deterministic
 * (depends only on the job spec + the item index). `view` and `rngFor` are
 * provided by the executor (inline or worker) so the reducer itself is
 * transport-safe (it never needs to import the engine).
 */
export interface JobContext {
  /** Stable component type id (from `@omega/reflect`). */
  readonly typeId: number;
  /** Stable component type name. */
  readonly typeName: string;
  /** Number of items in the job. */
  readonly count: number;
  /** Deterministic 53-bit-safe seed (the reducer expands it into a real RNG). */
  readonly seed: number;
  /** Bytes per item in the result buffer. */
  readonly blockSize: number;
  /** The shared result buffer (SharedArrayBuffer on the runner). */
  readonly buffer: ArrayBufferLike;
  /** Float64 view over this item's slot (length = blockSize / 8). */
  view(item: number): Float64Array;
  /** A fresh, deterministic RNG seeded by `(seed, item)` — identical on every backend. */
  rngFor(item: number): import('@omega/engine-core').Rng;
}

/**
 * The job to run. `reducer` is the live function (used by the inline backend);
 * `reducerSrc` is its source string (used by the worker backend). The
 * scheduler fills `reducerSrc` automatically if you pass `reducer`.
 */
export interface JobSpec {
  /** Human-readable job name (also a determinism-relevant label). */
  name: string;
  /** Component type token (clone-safe id + name). */
  type: ComponentType;
  /** Number of items (entities) to process. */
  count: number;
  /** Bytes per item in the result buffer. Must be a multiple of 8. */
  blockSize: number;
  /** Deterministic seed. */
  seed: number;
  /** Live reducer (used by the inline/serial backend). */
  reducer?: JobReducer;
  /** Reducer source string (used by the worker backend). Auto-derived if omitted. */
  reducerSrc?: string;
}

/** Which execution backend to use. */
export type BackendKind = 'inline' | 'worker';

export interface RunOptions {
  backend?: BackendKind;
  /** How many parallel lanes (workers). Default: min(count, 4). */
  lanes?: number;
}

/** Result of a job run. */
export interface JobResult {
  name: string;
  typeId: number;
  count: number;
  blockSize: number;
  /** The shared result buffer (byte-identical across backends for the same spec). */
  buffer: ArrayBufferLike;
  /** Deterministic aggregate computed from the buffer (merge result). */
  aggregate: number;
  /** Which backend actually executed the job. */
  backend: BackendKind;
  /** Number of lanes the work was partitioned across. */
  lanes: number;
}

/**
 * Transport descriptor shipped to a worker (no functions, no class instances).
 * Carries the reducer as source text; the worker rebuilds it.
 */
export interface JobDescriptor {
  name: string;
  typeId: number;
  typeName: string;
  count: number;
  blockSize: number;
  seed: number;
  reducerSrc: string;
  /** The shared result buffer (sent by reference, not copied). */
  buffer: SharedArrayBuffer;
  /** Shared barrier (Int32Array[0] = completed-lane count). */
  barrier: SharedArrayBuffer;
  /** This lane's shard: [start, end). */
  start: number;
  end: number;
}
