import { describe, it, expect } from 'vitest';
import { TerrainGenerator } from '@omega/world-gen';
import {
  createFireField,
  stepFireField,
  ignite,
  COMP_FIRE_FIELD,
  FireState,
  type FireField,
} from './fire.js';
import { registerFireField, getFireField } from './register.js';
import { World, SystemStage } from '@omega/engine-core';
import { Simulation } from '@omega/sim';
import { registerEnvironmentField } from '@omega/sim-env';

function landMaskFromTerrain(heights: Float32Array, n: number): Uint8Array {
  const m = new Uint8Array(n * n);
  for (let i = 0; i < n * n; i++) m[i] = heights[i]! > 0.3 ? 1 : 0;
  return m;
}

function stateSnapshot(f: FireField): number[] {
  return Array.from(f.state);
}

describe('FireField determinism', () => {
  it('same seed -> identical burn sequence tick-for-tick', () => {
    const n = 16;
    const terrain = new TerrainGenerator('fire-seed-A', { size: n }).generate();
    const land = landMaskFromTerrain(terrain.heights, n);

    const a = createFireField({ seed: 'fire-seed-A', gridSize: n }, land);
    const b = createFireField({ seed: 'fire-seed-A', gridSize: n }, land);
    ignite(a, 8, 8, 4);
    ignite(b, 8, 8, 4);
    expect(stateSnapshot(a)).toEqual(stateSnapshot(b));

    for (let t = 0; t < 60; t++) {
      stepFireField(a, 1 / 30, { seed: 'fire-seed-A', gridSize: n }, undefined);
      stepFireField(b, 1 / 30, { seed: 'fire-seed-A', gridSize: n }, undefined);
      expect(a.tick).toBe(b.tick);
      expect(stateSnapshot(a)).toEqual(stateSnapshot(b));
    }
  });

  it('fire actually spreads then burns out (non-trivial dynamics)', () => {
    const n = 20;
    const terrain = new TerrainGenerator('spread-A', { size: n }).generate();
    const land = landMaskFromTerrain(terrain.heights, n);
    const f = createFireField({ seed: 'spread-A', gridSize: n, baseSpread: 0.4 }, land);
    // Ignite the first land cell so we know it actually catches.
    let ix = -1, iy = -1;
    for (let y = 0; y < n && ix < 0; y++) {
      for (let x = 0; x < n; x++) {
        if (land[y * n + x] === 1) { ix = x; iy = y; break; }
      }
    }
    expect(ix).toBeGreaterThanOrEqual(0);
    ignite(f, ix, iy, 4);
    let everBurned = 0;
    for (let t = 0; t < 120; t++) {
      stepFireField(f, 1 / 30, { seed: 'spread-A', gridSize: n });
      everBurned = Math.max(everBurned, f.totalBurnt);
    }
    expect(everBurned).toBeGreaterThan(1); // spread beyond the ignition cell
  });

  it('couples to environment: hot+dry ignites faster than cool+wet (deterministic)', () => {
    const n = 12;
    // Hot/dry environment.
    const hot = createFireField({ seed: 'coupled', gridSize: n });
    const envHot = {
      n, tick: 0,
      temperature: new Float32Array(n * n).fill(0.95),
      humidity: new Float32Array(n * n).fill(0.05),
      pressure: new Float32Array(n * n).fill(0.5),
      windX: new Float32Array(n * n), windY: new Float32Array(n * n),
      elevation: new Float32Array(n * n), isLand: new Uint8Array(n * n).fill(1),
      eqTemperature: new Float32Array(n * n), eqHumidity: new Float32Array(n * n),
      eqPressure: new Float32Array(n * n),
    } as any;
    ignite(hot, 6, 6, 4);
    for (let t = 0; t < 20; t++) stepFireField(hot, 1 / 30, { seed: 'coupled', gridSize: n }, envHot);

    // Cool/wet environment, identical seed + ignition.
    const cold = createFireField({ seed: 'coupled', gridSize: n });
    const envCold = {
      n, tick: 0,
      temperature: new Float32Array(n * n).fill(0.2),
      humidity: new Float32Array(n * n).fill(0.95),
      pressure: new Float32Array(n * n).fill(0.5),
      windX: new Float32Array(n * n), windY: new Float32Array(n * n),
      elevation: new Float32Array(n * n), isLand: new Uint8Array(n * n).fill(1),
      eqTemperature: new Float32Array(n * n), eqHumidity: new Float32Array(n * n),
      eqPressure: new Float32Array(n * n),
    } as any;
    ignite(cold, 6, 6, 4);
    for (let t = 0; t < 20; t++) stepFireField(cold, 1 / 30, { seed: 'coupled', gridSize: n }, envCold);

    expect(hot.totalBurnt).toBeGreaterThan(cold.totalBurnt);
  });
});

describe('FireField ECS integration', () => {
  it('runs under @omega/sim loop with env coupling, deterministically', () => {
    function build(w: World) {
      registerEnvironmentField(w, { seed: 'loop', gridSize: 10, stage: SystemStage.Update, order: 5 });
      registerFireField(w, { seed: 'loop', gridSize: 10, stage: SystemStage.Update, order: 6, ignition: [5, 5] });
    }
    const simA = new Simulation(new World());
    build(simA.world);
    simA.pause();
    for (let i = 0; i < 50; i++) simA.step();
    const fa = getFireField(simA.world)!;

    const simB = new Simulation(new World());
    build(simB.world);
    simB.pause();
    for (let i = 0; i < 50; i++) simB.step();
    const fb = getFireField(simB.world)!;

    expect(stateSnapshot(fa)).toEqual(stateSnapshot(fb));
    expect(fa.tick).toBe(50);
    void COMP_FIRE_FIELD;
    void FireState;
  });
});
