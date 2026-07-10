/**
 * @omega/bench — deterministic benchmark framework for PROJECT OMEGA.
 *
 * Public surface: the `benchmark(name, fn, opts)` runner, the summary-statistic
 * helpers, and `toBenchJson` for emitting dashboard-compatible reports.
 */

export { benchmark, toBenchJson } from './benchmark.js';
export type {
  BenchmarkOptions,
  BenchmarkContext,
  BenchmarkFn,
  BenchmarkResult,
} from './benchmark.js';
export { min, max, mean, median } from './stats.js';
