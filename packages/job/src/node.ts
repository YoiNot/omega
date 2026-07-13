/**
 * @omega/job/node — Node-only backend (uses `worker_threads`).
 *
 * This sub-path is the ONLY place that touches `worker_threads`. It is NOT part
 * of the default `@omega/job` export, so browser bundles never pull it in.
 * Node tools (bench, fuzz, determinism gates) import from `@omega/job/node`.
 */

export { JobScheduler } from './scheduler.js';
export { buffersEqual } from './shard.js';
export type { JobResult, RunOptions, BackendKind } from './types.js';
