/**
 * @omega/job/browser — explicit browser entry (alias of the worker-free default).
 *
 * Same exports as `@omega/job` (no `worker_threads`). Provided so consumers can
 * be explicit about the browser-safe surface. The default `@omega/job` import
 * already resolves to this worker-free module.
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
