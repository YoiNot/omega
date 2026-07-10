import { describe, it, expect } from 'vitest';
import {
  createEcoField,
  stepEcoField,
  type EcoField,
} from './eco.js';
import { registerEcosystemField, getEcoField } from './register.js';
import { World, SystemStage } from '@omega/engine-core';
import { Simulation } from '@omega/sim';
import { registerEnvironmentField } from '@omega/sim-env';
import { COMP_ECO_FIELD } from './eco.js';

function ecoSnapshot(f: EcoField): number[] {
  const out: number[] = [];
  for (let i = 0; i < f.vegetation.length; i++) {
    out.push(Math.round(f.vegetation[i]! * 1e6));
    out.push(Math.round(f.herbivores[i]! * 1e6));
    out.push(Math.round(f.carnivores[i]! * 1e6));
  }
  return out;
}

describe('EcoField determinism', () => {
  it('same seed + env -> identical population grids tick-for-tick', () => {
    const n = 12;
    const envA = {
      n, tick: 0,
      temperature: new Float32Array(n * n).fill(0.5),
      humidity: new Float32Array(n * n).fill(0.6),
      pressure: new Float32Array(n * n).fill(0.5),
      windX: new Float32Array(n * n), windY: new Float32Array(n * n),
      elevation: new Float32Array(n * n), isLand: new Uint8Array(n * n).fill(1),
      eqTemperature: new Float32Array(n * n), eqHumidity: new Float32Array(n * n),
      eqPressure: new Float32Array(n * n),
    } as any;
    const envB = {
      n, tick: 0,
      temperature: new Float32Array(n * n).fill(0.5),
      humidity: new Float32Array(n * n).fill(0.6),
      pressure: new Float32Array(n * n).fill(0.5),
      windX: new Float32Array(n * n), windY: new Float32Array(n * n),
      elevation: new Float32Array(n * n), isLand: new Uint8Array(n * n).fill(1),
      eqTemperature: new Float32Array(n * n), eqHumidity: new Float32Array(n * n),
      eqPressure: new Float32Array(n * n),
    } as any;

    const a = createEcoField({ seed: 'eco-A', gridSize: n }, envA);
    const b = createEcoField({ seed: 'eco-A', gridSize: n }, envB);
    expect(ecoSnapshot(a)).toEqual(ecoSnapshot(b));

    const opts = { seed: 'eco-A', gridSize: n } as any;
    for (let t = 0; t < 40; t++) {
      stepEcoField(a, 1 / 30, opts, envA);
      stepEcoField(b, 1 / 30, opts, envB);
      expect(a.tick).toBe(b.tick);
      expect(ecoSnapshot(a)).toEqual(ecoSnapshot(b));
    }
  });

  it('populations stay within [0,1] across ticks', () => {
    const n = 10;
    const env = {
      n, tick: 0,
      temperature: new Float32Array(n * n).fill(0.8),
      humidity: new Float32Array(n * n).fill(0.3),
      pressure: new Float32Array(n * n).fill(0.5),
      windX: new Float32Array(n * n), windY: new Float32Array(n * n),
      elevation: new Float32Array(n * n), isLand: new Uint8Array(n * n).fill(1),
      eqTemperature: new Float32Array(n * n), eqHumidity: new Float32Array(n * n),
      eqPressure: new Float32Array(n * n),
    } as any;
    const f = createEcoField({ seed: 'bounds', gridSize: n }, env);
    const opts = { seed: 'bounds', gridSize: n } as any;
    for (let t = 0; t < 60; t++) {
      stepEcoField(f, 1 / 30, opts, env);
      for (let i = 0; i < f.vegetation.length; i++) {
        expect(f.vegetation[i]!).toBeGreaterThanOrEqual(0);
        expect(f.vegetation[i]!).toBeLessThanOrEqual(1);
        expect(f.herbivores[i]!).toBeGreaterThanOrEqual(0);
        expect(f.herbivores[i]!).toBeLessThanOrEqual(1);
        expect(f.carnivores[i]!).toBeGreaterThanOrEqual(0);
        expect(f.carnivores[i]!).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('EcoField ECS integration', () => {
  it('runs under @omega/sim loop with env coupling, deterministically', () => {
    function build(w: World) {
      registerEnvironmentField(w, { seed: 'eco-loop', gridSize: 8, stage: SystemStage.Update, order: 5 });
      registerEcosystemField(w, { seed: 'eco-loop', gridSize: 8, stage: SystemStage.Update, order: 7 });
    }
    const simA = new Simulation(new World());
    build(simA.world);
    simA.pause();
    for (let i = 0; i < 40; i++) simA.step();
    const fa = getEcoField(simA.world)!;

    const simB = new Simulation(new World());
    build(simB.world);
    simB.pause();
    for (let i = 0; i < 40; i++) simB.step();
    const fb = getEcoField(simB.world)!;

    expect(ecoSnapshot(fa)).toEqual(ecoSnapshot(fb));
    expect(fa.tick).toBe(40);
    void COMP_ECO_FIELD;
  });
});
