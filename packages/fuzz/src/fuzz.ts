/**
 * @omega/fuzz — deterministic fuzzer.
 *
 * `fuzz(fn, { seed, iterations })` generates `iterations` inputs from an
 * engine-core `Rng` seeded with `seed`, runs `fn(input)` on each, and catches
 * any thrown exception. Because the input sequence is a pure function of the
 * seed, the SAME seed always produces the SAME inputs in the SAME order — so a
 * crash is perfectly reproducible: re-run with `seed` and you get the exact
 * failing input back.
 *
 * No Math.random / Date.now anywhere. Determinism is the whole point.
 */

import { Rng } from '@omega/engine-core';

/** Options controlling a fuzz run. */
export interface FuzzOptions {
  /** PRNG seed; identical seed => identical input sequence. */
  seed?: number | string | bigint;
  /** How many inputs to generate (default 1000). */
  iterations?: number;
}

/** A single generated input plus its index. */
export interface FuzzInput<T = unknown> {
  /** Zero-based index of this input in the sequence. */
  readonly index: number;
  /** The generated value. */
  readonly value: T;
}

/** What the generator produces per input. */
export type FuzzGen<T> = (rng: Rng, index: number) => T;

/** The function under test. Throw to signal a defect. */
export type FuzzFn<T> = (input: T, index: number) => void;

/** A successfully found crash. */
export interface FuzzFailure<T = unknown> {
  seed: string;
  index: number;
  input: T;
  error: string;
  stack?: string;
}

/** Aggregated result of a fuzz run. */
export interface FuzzResult<T = unknown> {
  seed: string;
  iterations: number;
  /** Number of iterations that completed without throwing. */
  completed: number;
  /** True iff at least one iteration threw. */
  crashed: boolean;
  failures: FuzzFailure<T>[];
}

function seedToString(seed: number | string | bigint): string {
  if (typeof seed === 'bigint') return seed.toString();
  if (typeof seed === 'number') return seed.toString();
  return seed;
}

/**
 * Deterministically fuzz `fn` with inputs from `generate`, seeded by `seed`.
 *
 * @param generate Produces one input per iteration from the seeded RNG.
 * @param fn The system under test; may throw.
 * @param options `{ seed, iterations }` — same seed => same inputs => reproducible.
 *
 * @example
 * fuzz((rng) => rng.nextInt(0, 1000), (n) => {
 *   if (n === 0) throw new Error('div-by-zero');
 * }, { seed: 42, iterations: 500 });
 */
export function fuzz<T>(
  generate: FuzzGen<T>,
  fn: FuzzFn<T>,
  options: FuzzOptions = {},
): FuzzResult<T> {
  const seed = options.seed ?? 0;
  const iterations = options.iterations ?? 1000;
  const rng = new Rng(seed);
  const failures: FuzzFailure<T>[] = [];

  for (let i = 0; i < iterations; i++) {
    const input = generate(rng, i);
    try {
      fn(input, i);
    } catch (err) {
      const e = err as Error;
      failures.push({
        seed: seedToString(seed),
        index: i,
        input,
        error: e?.message ?? String(err),
        stack: e?.stack,
      });
    }
  }

  return {
    seed: seedToString(seed),
    iterations,
    completed: iterations - failures.length,
    crashed: failures.length > 0,
    failures,
  };
}

/**
 * Serialize a fuzz result to the canonical JSON shape. The `seed` + `index` of
 * any failure is enough to deterministically regenerate the exact input.
 */
export function toFuzzJson<T>(result: FuzzResult<T>): unknown {
  return {
    schema: 'omega-fuzz/1',
    seed: result.seed,
    iterations: result.iterations,
    completed: result.completed,
    crashed: result.crashed,
    failures: result.failures.map((f) => ({
      seed: f.seed,
      index: f.index,
      input: f.input,
      error: f.error,
    })),
  };
}
