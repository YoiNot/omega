/**
 * @omega/profiler — deterministic, counter-only profiler for PROJECT OMEGA.
 *
 * Public surface: the `Profiler` class, `ProfilerScope` for manual
 * enter/exit, the shared `profiler` singleton, and the `profile`/`scope`
 * convenience helpers. All metrics are pure counters (calls, cost units, max
 * depth) — never wall-clock time — so reports are fully reproducible.
 */

export {
  Profiler,
  ProfilerScope,
  profiler,
  profile,
  scope,
} from './profiler.js';
export type {
  ProfileOptions,
  ProfilerReport,
} from './profiler.js';
