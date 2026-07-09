# Benchmarks

The brief mandates benchmarks and profiling. This harness provides repeatable micro-
benchmarks for the hot paths. Run with `npm run bench` (vitest bench).

## Current benchmarks
- `engine-core/rng.bench.ts` — Rng.nextF64 throughput (baseline for all generation/sim).
- `engine-core/ecs.bench.ts` — component store add/query throughput.
- `engine-math/mat4.bench.ts` — Mat4 multiply throughput.

## Profiling workflow
1. Run `npm run bench` to capture throughput baselines; commit results to
   `docs/benchmarks/*.md` as a regression reference.
2. For alloc profiling, run Node with `--inspect` and capture heap snapshots around long
   simulation runs (future: a `--profile` flag on the web app).
3. Performance regressions are tracked as `perf(scope)` commits and noted in PRs.

> Note: benchmarks are not a substitute for correctness. A regression that breaks
> determinism (ADR 0001) is never acceptable even if it is faster.
