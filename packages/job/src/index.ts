/**
 * @omega/job — deterministic parallel job system (data-parallel ECS via
 * Web Workers + SharedArrayBuffer).
 */

export { JobScheduler, buffersEqual } from './scheduler.js';
export { runInline } from './inline.js';
export { partition, makeContext, mergeResult } from './shard.js';

export type {
  JobReducer,
  JobContext,
  JobSpec,
  JobDescriptor,
  JobResult,
  BackendKind,
  RunOptions,
} from './types.js';
