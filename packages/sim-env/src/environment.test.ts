import { describe, it, expect } from 'vitest';
import { TerrainGenerator } from '@omega/world-gen';
import {
  createEnvField,
  stepEnvField,
  createEnvFieldFromSeed,
  COMP_ENV_FIELD,
  type EnvField,
} from './environment.js';
import { registerEnvironmentField, getEnvField } from './register.js';
import { World, SystemStage } from '@omega/engine-core';
import { Simulation } from '@omega/sim';

function fieldSnapshot(f: EnvField): number[] {
  // Concatenate temperature grid (round to 1e-6) for an exact compare.
  const out: number[] = [];
  for (let i = 0; i < f.temperature.length; i++) out.push(Math.round(f.temperature[i]! * 1e6));
  return out;
}

function cloneField(f: EnvField): EnvField {
  return {
    n: f.n, tick: f.tick,
    temperature: f.temperature.slice(),
    humidity: f.humidity.slice(),
    pressure: f.pressure.slice(),
    windX: f.windX.slice(),
    windY: f.windY.slice(),
    elevation: f.elevation.slice(),
    isLand: f.isLand.slice(),
    eqTemperature: f.eqTemperature.slice(),
    eqHumidity: f.eqHumidity.slice(),
    eqPressure: f.eqPressure.slice(),
  };
}

describe('EnvField determinism', () => {
  it('same seed -> identical field after N ticks (tick-for-tick)', () => {
    const size = 16;
    const terrain = new TerrainGenerator('env-seed-A', { size }).generate();

    const a = createEnvField(terrain, { seed: 'env-seed-A', diffusion: 0.1 });
    const b = createEnvField(terrain, { seed: 'env-seed-A', diffusion: 0.1 });
    expect(fieldSnapshot(a)).toEqual(fieldSnapshot(b));

    for (let t = 0; t < 30; t++) {
      stepEnvField(a, 1 / 60, { seed: 'env-seed-A', diffusion: 0.1 });
      stepEnvField(b, 1 / 60, { seed: 'env-seed-A', diffusion: 0.1 });
      expect(a.tick).toBe(b.tick);
      expect(fieldSnapshot(a)).toEqual(fieldSnapshot(b));
    }
  });

  it('different seed -> different initial perturbation', () => {
    const size = 16;
    const a = createEnvFieldFromSeed('env-seed-A', size, { seed: 'env-seed-A' });
    const c = createEnvFieldFromSeed('env-seed-B', size, { seed: 'env-seed-B' });
    // Not strictly required to differ, but with distinct seeds the perturbation differs.
    const same = fieldSnapshot(a).every((v, i) => v === fieldSnapshot(c)[i]);
    expect(same).toBe(false);
  });

  it('field stays within [0,1] for every cell across ticks', () => {
    const size = 12;
    const a = createEnvFieldFromSeed('bounds', size, { seed: 'bounds' });
    for (let t = 0; t < 50; t++) {
      stepEnvField(a, 1 / 30, { seed: 'bounds' });
      for (let i = 0; i < a.temperature.length; i++) {
        expect(a.temperature[i]!).toBeGreaterThanOrEqual(0);
        expect(a.temperature[i]!).toBeLessThanOrEqual(1);
        expect(a.humidity[i]!).toBeGreaterThanOrEqual(0);
        expect(a.humidity[i]!).toBeLessThanOrEqual(1);
        expect(a.pressure[i]!).toBeGreaterThanOrEqual(0);
        expect(a.pressure[i]!).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('EnvField ECS integration', () => {
  it('runs under the @omega/sim fixed-timestep loop deterministically', () => {
    function build(w: World) {
      registerEnvironmentField(w, {
        seed: 'ecs-env', gridSize: 12, diffusion: 0.1,
        stage: SystemStage.Update, order: 5,
      });
    }
    const simA = new Simulation(new World());
    build(simA.world);
    simA.pause();
    for (let i = 0; i < 40; i++) simA.step();
    const fa = getEnvField(simA.world)!;

    const simB = new Simulation(new World());
    build(simB.world);
    simB.pause();
    for (let i = 0; i < 40; i++) simB.step();
    const fb = getEnvField(simB.world)!;

    expect(fieldSnapshot(fa)).toEqual(fieldSnapshot(fb));
    expect(fa.tick).toBe(40);
    expect(fb.tick).toBe(40);
    void cloneField(fa);
    void COMP_ENV_FIELD;
  });
});
