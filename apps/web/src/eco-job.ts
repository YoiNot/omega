/**
 * apps/web — Step 2 (Phase B, Roadmap §20): drive the sim-eco population model
 * through the deterministic @omega/job shard primitives.
 *
 * The §13 ecosystem model (see @omega/sim-eco `stepEcoField`) is a per-cell
 * Lotka–Volterra Euler integration with NO cross-cell dependence: cell `i` only
 * reads its own current (v, h, c) and its own environment (temp, hum). That
 * makes it perfectly data-parallel — exactly what @omega/job's `partition` is
 * for.
 *
 * We own the result buffer (packed with v/h/c/temp/hum/dt so the reducer is
 * fully self-contained and transport-safe), then drive it with @omega/job's
 * shard primitives:
 *   - `partition(count, lanes)`   -> identical shard boundaries on every backend
 *   - `makeContext` / `mergeResult` -> the same ctx + deterministic aggregate
 *   - `JobScheduler.runWorker`    -> Node worker_threads gate (inline == worker
 *                                    byte-identical, proving the sharding is
 *                                    race-free / order-independent)
 *
 * The browser demo runs the shards serially (the package's browser path is the
 * inline reference; real Web-Worker browser lanes are a later @omega/job item),
 * so the *observable* optimization here is the LOD tiering (see main.tsx). The
 * job layer's value is making the eco integration explicit sharded work + a
 * built-in determinism gate, which is what §20 asks for at the engine level.
 */

import { JobScheduler, partition, makeContext, mergeResult, type JobSpec, type JobContext } from '@omega/job';
import { Rng } from '@omega/engine-core';
import type { EcoField, EcoFieldOptions } from '@omega/sim-eco';
import type { EnvField } from '@omega/sim-env';

/** Float64 slots per cell: veg, herb, carn, temp, hum, dt. dt/env shared (same every cell). */
const BLOCK_FLOATS = 6;
const BLOCK_BYTES = BLOCK_FLOATS * 8;

/** Pack current eco + env + dt into a job buffer (deterministic snapshot). */
function packBuffer(field: EcoField, env: EnvField, dt: number): ArrayBuffer {
  const n = field.n;
  const buf = new ArrayBuffer(n * n * BLOCK_BYTES);
  const v = new Float64Array(buf);
  for (let i = 0; i < n * n; i++) {
    const o = i * BLOCK_FLOATS;
    v[o] = field.vegetation[i]!;
    v[o + 1] = field.herbivores[i]!;
    v[o + 2] = field.carnivores[i]!;
    v[o + 3] = env ? env.temperature[i]! : 0.5;
    v[o + 4] = env ? env.humidity[i]! : 0.5;
    v[o + 5] = dt;
  }
  return buf;
}

/** Copy a job buffer's first 3 slots (v/h/c) back into the eco field. */
function unpackInto(field: EcoField, buf: ArrayBufferLike): void {
  const v = new Float64Array(buf as ArrayBuffer);
  for (let i = 0; i < field.vegetation.length; i++) {
    const o = i * BLOCK_FLOATS;
    field.vegetation[i] = v[o]!;
    field.herbivores[i] = v[o + 1]!;
    field.carnivores[i] = v[o + 2]!;
  }
  field.tick++;
}

/** Pure per-cell reducer, mirrored from @omega/sim-eco `stepEcoField` (§13). */
function ecoReducer(item: number, ctx: JobContext): void {
  const f = ctx.view(item);
  const v0 = f[0], h0 = f[1], c0 = f[2];
  const t = f[3], hum = f[4], dt = f[5];
  const growthMod = Math.min(1, Math.max(0, 0.3 + hum));
  const heatStress = t > 0.7 ? (t - 0.7) * 1.5 : 0;
  const dv = 0.08 * growthMod * v0 * (1 - v0) - 0.6 * h0 * v0;
  const dh = 0.5 * 0.6 * h0 * v0 - 0.4 * c0 * h0 - 0.05 * h0 - heatStress * h0;
  const dc = 0.3 * 0.4 * c0 * h0 - 0.04 * c0;
  const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
  f[0] = clamp01(v0 + dv * dt);
  f[1] = clamp01(h0 + dh * dt);
  f[2] = clamp01(c0 + dc * dt);
}

export interface EcoJobResult {
  /** Which backend actually ran the job. */
  backend: 'inline' | 'worker';
  /** Lanes the work was partitioned across. */
  lanes: number;
  /** Deterministic aggregate over the result buffer. */
  aggregate: number;
}

/**
 * Advance the eco field one tick via @omega/job sharding. We own the result
 * buffer (packed with v/h/c/temp/hum/dt) and drive it with @omega/job's
 * `partition` + `makeContext` so the shard boundaries + ctx match the package's
 * executors. The reducer is self-contained (reads only its own buffer slot), so
 * it is order-independent and deterministic — the core §20 guarantee.
 *
 * Note: the package's `worker` backend builds its OWN buffer (it has no hook to
 * inject external state like dt/env), so the eco step runs on the inline
 * reference path everywhere. The job system's own inline==worker determinism is
 * covered separately by `jobSystemDeterministic()`.
 */
export async function stepEcoFieldParallel(
  field: EcoField,
  dt: number,
  env: EnvField,
  _opts: EcoFieldOptions,
  lanes?: number,
): Promise<EcoJobResult> {
  const n = field.n;
  const buffer = packBuffer(field, env, dt);
  const type = { id: 0xec0, name: 'EcoField' };
  const floatsPerItem = BLOCK_BYTES / 8;
  const view = (item: number): Float64Array =>
    new Float64Array(buffer, item * BLOCK_BYTES, floatsPerItem);
  const ctx = makeContext(
    { typeId: type.id, typeName: type.name, count: n * n, seed: 0xec0, blockSize: BLOCK_BYTES, buffer },
    // rngFor is unused by the eco reducer (no per-item RNG); provide a stable stub.
    { view, rngFor: () => new Rng(0) },
  );
  const laneCount = lanes ?? Math.min(n * n, 4);
  // Run every shard serially over OUR buffer (deterministic reference).
  for (const [start, end] of partition(n * n, laneCount)) {
    for (let item = start; item < end; item++) ecoReducer(item, ctx);
  }
  unpackInto(field, buffer);
  return { backend: 'inline', lanes: laneCount, aggregate: mergeResult(buffer, n * n, BLOCK_BYTES) };
}

/**
 * Sanity gate: @omega/job itself is order-independent. Runs a self-contained,
 * rng-driven reducer on both backends and asserts byte-identical buffers —
 * proving the shard/merge layer is race-free (the §20 determinism contract).
 */
export async function jobSystemDeterministic(): Promise<boolean> {
  const scheduler = new JobScheduler();
  const spec: JobSpec = {
    name: 'gate',
    type: { id: 0x601d, name: 'Gate' },
    count: 1024,
    blockSize: 8,
    seed: 0xabcdef,
    reducer: ((item: number, ctx: JobContext) => {
      const f = ctx.view(item);
      f[0] = ctx.rngFor(item).nextF64();
    }) as JobSpec['reducer'],
  };
  return scheduler.assertReplayEqual(spec, 4);
}

/** Number of shards @omega/job would partition the grid into (for the HUD). */
export function ecoShardCount(count: number, lanes = 4): number {
  return partition(count, lanes).length;
}

void makeContext;
void mergeResult;
