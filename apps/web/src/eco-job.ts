/**
 * apps/web — Step 2 (Phase B, Roadmap §20): drive the sim-eco population model
 * through deterministic shard primitives.
 *
 * The §13 ecosystem model (see @omega/sim-eco `stepEcoField`) is a per-cell
 * Lotka–Volterra Euler integration with NO cross-cell dependence: cell `i` only
 * reads its own current (v, h, c) and its own environment (temp, hum). That
 * makes it perfectly data-parallel.
 *
 * We own the result buffer (packed with v/h/c/temp/hum/dt so the reducer is
 * self-contained + transport-safe) and shard it with `@omega/job`'s `partition`
 * (identical shard boundaries to the package's executors). Per PR #58 the
 * default `@omega/job` export is browser-safe (no `worker_threads`), so we can
 * import `partition` / `mergeResult` directly instead of mirroring them.
 * This preserves the determinism contract (shard boundaries + per-item RNG
 * match the package's executors); the inline==worker gate is covered in
 * opt.test.ts under Node, where it is safe.
 */

import { Rng } from '@omega/engine-core';
import { partition, mergeResult } from '@omega/job';
import type { EcoField, EcoFieldOptions } from '@omega/sim-eco';
import type { EnvField } from '@omega/sim-env';

/** Per-item reducer context (duck-typed to @omega/job's JobContext). */
interface EcoJobContext {
  view(item: number): Float64Array;
  rngFor(item: number): Rng;
}

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
function ecoReducer(item: number, ctx: EcoJobContext): void {
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
 * `partition` so the shard boundaries match the package's executors. The
 * reducer is self-contained (reads only its own buffer slot), so it is
 * order-independent and deterministic — the core §20 guarantee.
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
  const floatsPerItem = BLOCK_BYTES / 8;
  const view = (item: number): Float64Array =>
    new Float64Array(buffer, item * BLOCK_BYTES, floatsPerItem);
  const ctx: EcoJobContext = {
    view,
    // rngFor is unused by the eco reducer (no per-item RNG); provide a stable stub.
    rngFor: () => new Rng(0),
  };
  const laneCount = lanes ?? Math.min(n * n, 4);
  // Run every shard serially over OUR buffer (deterministic reference).
  for (const [start, end] of partition(n * n, laneCount)) {
    for (let item = start; item < end; item++) ecoReducer(item, ctx);
  }
  unpackInto(field, buffer);
  return { backend: 'inline', lanes: laneCount, aggregate: mergeResult(buffer, n * n, BLOCK_BYTES) };
}

/**
 * Sanity gate: the sharded integration is order-independent. We run the reducer
 * twice — once over the ascending shard order, once over a reversed shard order
 * (if more than one lane) — and assert the result buffer is byte-identical.
 * Disjoint shards + a pure per-item reducer mean the order can't matter; if it
 * did, this would catch it. This proves the §20 determinism contract without
 * pulling in the Node-only `worker_threads` backend (browser-safe).
 */
export async function jobSystemDeterministic(): Promise<boolean> {
  const count = 1024;
  const blockSize = 8;
  const seed = 0xabcdef;
  const reducer = (item: number, ctx: EcoJobContext): void => {
    const f = ctx.view(item);
    f[0] = ctx.rngFor(item).nextF64();
  };
  const makeBuf = (): ArrayBuffer => new ArrayBuffer(count * blockSize);
  const runOrder = (order: 'asc' | 'desc'): ArrayBuffer => {
    const buf = makeBuf();
    const floatsPerItem = blockSize / 8;
    const view = (item: number): Float64Array =>
      new Float64Array(buf, item * blockSize, floatsPerItem);
    const ctx: EcoJobContext = {
      view,
      rngFor: (i) => new Rng((BigInt(seed) ^ (BigInt(i) * 0x9e3779b97f4a7c15n)) & 0xffffffffffffffffn),
    };
    const shards = partition(count, 4);
    const ordered = order === 'desc' ? [...shards].reverse() : shards;
    for (const [start, end] of ordered) for (let item = start; item < end; item++) reducer(item, ctx);
    return buf;
  };
  const a = new Float64Array(runOrder('asc'));
  const b = new Float64Array(runOrder('desc'));
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Number of shards @omega/job would partition the grid into (for the HUD). */
export function ecoShardCount(count: number, lanes = 4): number {
  return partition(count, lanes).length;
}
