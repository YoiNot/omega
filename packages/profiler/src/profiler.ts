/**
 * @omega/profiler — deterministic, counter-only profiler.
 *
 * OMEGA forbids nondeterministic inputs in core, and real wall-clock timings
 * are nondeterministic (they depend on the host, load, GC, …). So this profiler
 * measures by COUNT, not by time:
 *
 *   - per-scope call count
 *   - per-scope cumulative "cost units" (caller-supplied integers, e.g. number
 *     of operations / entities processed), so aggregation is fully reproducible
 *   - current recursion depth per scope (pure counter, no timing)
 *
 * `profile(name, fn, costPerCall?)` runs `fn` and accumulates. `ProfilerScope`
 * gives enter/exit semantics for manual instrumentation. `report()` returns a
 * stable, JSON-serializable snapshot whose ordering never depends on Map
 * iteration order (we sort by name).
 */

import { Rng } from '@omega/engine-core';

interface ScopeStats {
  name: string;
  calls: number;
  /** Cumulative caller-supplied cost units (not time). */
  totalCost: number;
  /** Max concurrent depth observed for this scope. */
  maxDepth: number;
}

/** Options for `profile`. */
export interface ProfileOptions {
  /**
   * Cost units charged per call (default 1). Pass a function of the PRNG-seeded
   * `Rng` to make the cost deterministic from a seed while still counting work.
   */
  cost?: number | ((rng: Rng) => number);
  /** Optional seed so any cost-from-RNG is reproducible. */
  seed?: number | string | bigint;
}

/** Stable, serializable report. Keys are sorted for deterministic diffs. */
export interface ProfilerReport {
  schema: 'omega-profiler/1';
  scopes: Array<{
    name: string;
    calls: number;
    totalCost: number;
    maxDepth: number;
    averageCost: number;
  }>;
}

export class Profiler {
  private readonly _stats = new Map<string, ScopeStats>();
  // Stack of currently-open scope names (for depth tracking).
  private readonly _stack: string[] = [];

  /** Enter a scope manually; returns nothing. Pair with `exit`. */
  enter(name: string): void {
    let s = this._stats.get(name);
    if (!s) {
      s = { name, calls: 0, totalCost: 0, maxDepth: 0 };
      this._stats.set(name, s);
    }
    s.calls++;
    this._stack.push(name);
    const depth = this._stack.filter((n) => n === name).length;
    if (depth > s.maxDepth) s.maxDepth = depth;
  }

  /** Charge `cost` units to `name` without wrapping a function. */
  charge(name: string, cost: number): void {
    let s = this._stats.get(name);
    if (!s) {
      s = { name, calls: 0, totalCost: 0, maxDepth: 0 };
      this._stats.set(name, s);
    }
    s.totalCost += cost;
  }

  /** Exit the most recently entered scope. */
  exit(): void {
    this._stack.pop();
  }

  /**
   * Run `fn` as a single call to scope `name`, accumulating one call and
   * `cost` units. If `cost` is a function it receives a seeded `Rng` so the
   * cost is deterministic. Returns `fn`'s value.
   */
  profile<T>(name: string, fn: () => T, options: ProfileOptions = {}): T {
    const seed = options.seed ?? 0;
    const rng = new Rng(seed);
    let cost: number;
    if (typeof options.cost === 'function') cost = options.cost(rng);
    else cost = options.cost ?? 1;

    this.enter(name);
    try {
      return fn();
    } finally {
      this.charge(name, cost);
      this.exit();
    }
  }

  /**
   * Produce a stable report. Scopes are sorted by name so two identical runs
   * always emit byte-identical JSON.
   */
  report(): ProfilerReport {
    const scopes = [...this._stats.values()]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((s) => ({
        name: s.name,
        calls: s.calls,
        totalCost: s.totalCost,
        maxDepth: s.maxDepth,
        averageCost: s.calls === 0 ? 0 : s.totalCost / s.calls,
      }));
    return { schema: 'omega-profiler/1', scopes };
  }

  /** Reset all collected counters. */
  reset(): void {
    this._stats.clear();
    this._stack.length = 0;
  }
}

/** A lightweight RAII-style scope object. */
export class ProfilerScope {
  private _closed = false;
  constructor(
    private readonly _profiler: Profiler,
    private readonly _name: string,
  ) {
    this._profiler.enter(_name);
  }

  /** Charge extra cost units to this scope. */
  charge(cost: number): void {
    this._profiler.charge(this._name, cost);
  }

  /** Close the scope (idempotent). */
  close(): void {
    if (this._closed) return;
    this._closed = true;
    this._profiler.exit();
  }
}

// A shared process-wide profiler (mirrors the engine-core singleton style).
export const profiler = new Profiler();

/** Convenience: profile a single call on the shared profiler. */
export function profile<T>(
  name: string,
  fn: () => T,
  options: ProfileOptions = {},
): T {
  return profiler.profile(name, fn, options);
}

/** Convenience: open a scope on the shared profiler. */
export function scope(name: string): ProfilerScope {
  return new ProfilerScope(profiler, name);
}
