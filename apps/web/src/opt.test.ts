/**
 * apps/web — Step 2 (Phase B, Roadmap §20) optimization tests.
 *
 * Proves the §20 work lands correctly + deterministically:
 *   - @omega/job itself is order-independent (inline == worker byte-identical);
 *   - the eco integration driven through @omega/job's sharding matches the
 *     canonical serial Lotka–Volterra Euler formula tick-for-tick (no races,
 *     no cross-lane contamination);
 *   - buildCoarseMesh is a pure function of the seed (LOD tiers stable).
 *
 * Every assertion is a pure function of the seed — no clock, no RNG at runtime.
 */

import { describe, it, expect } from 'vitest';
import {
  stepEcoFieldParallel,
  jobSystemDeterministic,
  ecoShardCount,
  type EcoJobResult,
} from './eco-job';
import { buildCoarseMesh } from './engine';
import type { EcoField } from '@omega/sim-eco';
import { createEnvField } from '@omega/sim-env';

const SEED = 'opt-seed';
const N = 16;

/** Build a deterministic EcoField (same defaults as @omega/sim-eco). */
function makeEco(): EcoField {
  const vegetation = new Float32Array(N * N);
  const herbivores = new Float32Array(N * N);
  const carnivores = new Float32Array(N * N);
  for (let i = 0; i < N * N; i++) {
    vegetation[i] = 0.6;
    herbivores[i] = 0.3;
    carnivores[i] = 0.1;
  }
  return { n: N, tick: 0, vegetation, herbivores, carnivores };
}

/** Canonical serial Lotka–Volterra Euler step (mirrors @omega/sim-eco §13). */
function serialStep(field: EcoField, dt: number, env: { temperature: Float32Array; humidity: Float32Array }): void {
  for (let i = 0; i < N * N; i++) {
    const v = field.vegetation[i]!;
    const h = field.herbivores[i]!;
    const c = field.carnivores[i]!;
    const t = env.temperature[i]!;
    const hum = env.humidity[i]!;
    const growthMod = Math.min(1, Math.max(0, 0.3 + hum));
    const heatStress = t > 0.7 ? (t - 0.7) * 1.5 : 0;
    const dv = 0.08 * growthMod * v * (1 - v) - 0.6 * h * v;
    const dh = 0.5 * 0.6 * h * v - 0.4 * c * h - 0.05 * h - heatStress * h;
    const dc = 0.3 * 0.4 * c * h - 0.04 * c;
    const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
    field.vegetation[i] = clamp01(v + dv * dt);
    field.herbivores[i] = clamp01(h + dh * dt);
    field.carnivores[i] = clamp01(c + dc * dt);
  }
  field.tick++;
}

describe('Step 2 — @omega/job sharding is order-independent (§20 determinism)', () => {
  it('ascending vs reversed shard order yield byte-identical buffers', async () => {
    const ok = await jobSystemDeterministic();
    expect(ok).toBe(true);
  });
});

describe('Step 2 — eco integration via @omega/job matches the serial formula', () => {
  it('sharded eco step == canonical serial Lotka–Volterra Euler', async () => {
    const env = createEnvField({ width: N, height: N, heights: new Float32Array(N * N).fill(0.2) }, { seed: SEED });
    const dt = 0.1;

    const shard = makeEco();
    await stepEcoFieldParallel(shard, dt, env, { seed: SEED, gridSize: N }, ecoShardCount(N * N));

    const serial = makeEco();
    serialStep(serial, dt, env);

    for (let i = 0; i < N * N; i++) {
      expect(shard.vegetation[i]!).toBeCloseTo(serial.vegetation[i]!, 12);
      expect(shard.herbivores[i]!).toBeCloseTo(serial.herbivores[i]!, 12);
      expect(shard.carnivores[i]!).toBeCloseTo(serial.carnivores[i]!, 12);
    }
    expect(shard.tick).toBe(serial.tick);
  });

  it('repeated sharded steps stay stable + deterministic', async () => {
    const env = createEnvField({ width: N, height: N, heights: new Float32Array(N * N).fill(0.2) }, { seed: SEED });
    const run = async (): Promise<number[]> => {
      const f = makeEco();
      for (let t = 0; t < 10; t++) await stepEcoFieldParallel(f, 0.1, env, { seed: SEED, gridSize: N }, ecoShardCount(N * N));
      return Array.from(f.vegetation).map((x) => Math.round(x * 1e6));
    };
    expect(await run()).toEqual(await run());
  });
});

describe('Step 2 — LOD coarse mesh is deterministic (§20 weak-HW tiering)', () => {
  it('same heights ⇒ identical coarse/coarsest meshes', () => {
    const heights = new Float32Array(N * N);
    for (let i = 0; i < N * N; i++) heights[i] = Math.sin(i * 0.3) * 0.5;
    const a = buildCoarseMesh(heights, N, N, 2);
    const b = buildCoarseMesh(heights, N, N, 2);
    expect(Array.from(a.positions)).toEqual(Array.from(b.positions));
    expect(Array.from(a.indices)).toEqual(Array.from(b.indices));
    // Coarser factor => strictly fewer vertices.
    const c = buildCoarseMesh(heights, N, N, 4);
    expect(c.positions.length).toBeLessThan(a.positions.length);
  });
});

void (null as unknown as EcoJobResult);
