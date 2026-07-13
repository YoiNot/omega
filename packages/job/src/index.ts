/**
 * @omega/job — deterministic parallel job system (data-parallel ECS).
 *
 * BROWSER-SAFE ENTRY. This module must not statically reference Node's
 * `worker_threads`: any consumer importing `@omega/job` (e.g. a Vite browser
 * bundle) would otherwise pull `worker_threads` in and crash on load. So the
 * default export exposes only the worker-free primitives:
 *   - `runInline`    serial reference executor (used by the browser demo)
 *   - `partition`    identical shard boundaries on every backend
 *   - `makeContext`  per-item reducer context
 *   - `mergeResult`  deterministic aggregate over the result buffer
 *   - `buffersEqual` byte-equality helper
 *
 * The Node-only `worker_threads` executor (`JobScheduler`, `runWorker`) lives
 * behind the `@omega/job/node` sub-path export, so it is never pulled into a
 * browser bundle unless explicitly requested.
 */

export { runInline } from './inline.js';
export { partition, makeContext, mergeResult, buffersEqual } from './shard.js';

export type {
  JobReducer,
  JobContext,
  JobSpec,
  JobDescriptor,
  JobResult,
  BackendKind,
  RunOptions,
} from './types.js';
