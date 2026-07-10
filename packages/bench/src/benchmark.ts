/**
 * @omega/bench — deterministic benchmark framework.
 *
 * A benchmark runs a function `iterations` times. Each iteration receives a
 * PRNG-seeded `Rng` (from @omega/engine-core) so the *input* of every run is
 * reproducible from a seed — no Math.random, no Date.now, no wall-clock. The
 * function returns a numeric measurement (e.g. number of operations performed,
 * payload size, derived checksum) and those measurements are aggregated into
 * deterministic Median/Min/Max/Mean.
 *
 * Because the inputs are seeded and the measurement is a pure function of the
 * input, the same `name` + `iterations` + `seed` always yields identical
 * metrics. This is what makes OMEGA benchmarks safe to commit and diff.
 */

import { Rng } from '@omega/engine-core';
import { max, mean, median, min } from './stats.js';

/** Options controlling a benchmark run. */
export interface BenchmarkOptions {
  /** Number of iterations to run (default 1000). */
  iterations?: number;
  /** PRNG seed; same seed + iterations => identical inputs/metrics. */
  seed?: number | string | bigint;
}

/** Context handed to every iteration of a benchmark. */
export interface BenchmarkContext {
  /** Zero-based iteration index. */
  readonly iteration: number;
  /** PRNG-seeded generator; deterministic for the benchmark's seed. */
  readonly rng: Rng;
}

/** The function under test. Returns a deterministic numeric measurement. */
export type BenchmarkFn = (ctx: BenchmarkContext) => number;

/** Aggregated, reproducible result of a benchmark. */
export interface BenchmarkResult {
  name: string;
  iterations: number;
  /** Seed rendered to a stable string (so reports diff cleanly). */
  seed: string;
  /** Raw per-iteration measurements, in iteration order. */
  samples: number[];
  min: number;
  max: number;
  median: number;
  mean: number;
}

function seedToString(seed: number | string | bigint): string {
  if (typeof seed === 'bigint') return seed.toString();
  if (typeof seed === 'number') return seed.toString();
  return seed;
}

/**
 * Run `fn` `iterations` times with PRNG-seeded deterministic inputs, returning
 * reproducible Median/Min/Max/Mean metrics over the returned measurements.
 *
 * @example
 * const r = benchmark('hash-x100', ({ rng }) => {
 *   let h = 0;
 *   for (let i = 0; i < 100; i++) h = (h + rng.nextInt(0, 255)) | 0;
 *   return h;
 * }, { iterations: 500, seed: 7 });
 */
export function benchmark(
  name: string,
  fn: BenchmarkFn,
  options: BenchmarkOptions = {},
): BenchmarkResult {
  const iterations = options.iterations ?? 1000;
  const seed = options.seed ?? 0;
  const rng = new Rng(seed);
  const samples: number[] = new Array(iterations);
  for (let i = 0; i < iterations; i++) {
    samples[i] = fn({ iteration: i, rng });
  }
  return {
    name,
    iterations,
    seed: seedToString(seed),
    samples,
    min: min(samples),
    max: max(samples),
    median: median(samples),
    mean: mean(samples),
  };
}

/**
 * Serialize a benchmark result into the canonical JSON shape consumed by the
 * dashboard (`packages/bench/dashboard/index.html`). Pure / deterministic.
 */
export function toBenchJson(result: BenchmarkResult): unknown {
  return {
    schema: 'omega-bench/1',
    name: result.name,
    iterations: result.iterations,
    seed: result.seed,
    min: result.min,
    max: result.max,
    median: result.median,
    mean: result.mean,
  };
}
