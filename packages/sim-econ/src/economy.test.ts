import { describe, it, expect } from 'vitest';
import {
  createEconomyField,
  stepEconomyField,
  storageIndex,
  type EconomyField,
  type EconomyOptions,
} from './economy.js';
import { registerEconomyField, getEconomyField } from './register.js';
import { World, SystemStage } from '@omega/engine-core';
import { Simulation } from '@omega/sim';
import { registerEcosystemField } from '@omega/sim-eco';

function econSnapshot(f: EconomyField): number[] {
  const out: number[] = [];
  for (let i = 0; i < f.storage.length; i++) out.push(Math.round(f.storage[i]! * 1e6));
  return out;
}

function makeEco(n: number) {
  const eco = {
    n, tick: 0,
    vegetation: new Float32Array(n * n).fill(0.6),
    herbivores: new Float32Array(n * n).fill(0.3),
    carnivores: new Float32Array(n * n).fill(0.1),
  } as any;
  return eco;
}

describe('EconomyField determinism', () => {
  it('same seed + eco -> identical storage grids tick-for-tick', () => {
    const n = 12;
    const ecoA = makeEco(n);
    const ecoB = makeEco(n);
    const opts: EconomyOptions = { seed: 'econ-A', gridSize: n };

    const a = createEconomyField(opts, ecoA);
    const b = createEconomyField(opts, ecoB);
    expect(econSnapshot(a)).toEqual(econSnapshot(b));

    for (let t = 0; t < 40; t++) {
      stepEconomyField(a, 1 / 30, ecoA, opts);
      stepEconomyField(b, 1 / 30, ecoB, opts);
      expect(a.tick).toBe(b.tick);
      expect(econSnapshot(a)).toEqual(econSnapshot(b));
    }
  });

  it('different seed -> different initial storage (entropy is real, not no-op)', () => {
    const n = 8;
    const eco = makeEco(n);
    const a = createEconomyField({ seed: 'econ-X', gridSize: n }, eco);
    const b = createEconomyField({ seed: 'econ-Y', gridSize: n }, eco);
    expect(econSnapshot(a)).not.toEqual(econSnapshot(b));
  });

  it('storage stays within [0, capacity] across ticks', () => {
    const n = 10;
    const eco = makeEco(n);
    const cap = 5;
    const f = createEconomyField({ seed: 'bounds', gridSize: n, storageCapacity: cap }, eco);
    for (let t = 0; t < 60; t++) {
      stepEconomyField(f, 1 / 30, eco, { seed: 'bounds', gridSize: n, storageCapacity: cap });
      for (let i = 0; i < f.storage.length; i++) {
        expect(f.storage[i]!).toBeGreaterThanOrEqual(0);
        expect(f.storage[i]!).toBeLessThanOrEqual(cap);
      }
    }
  });

  it('food storage falls where vegetation=0 and demand is high (consumption dominates)', () => {
    const n = 4;
    // Barren world: no vegetation/herbivores -> zero production, demand still consumes.
    const eco = {
      n, tick: 0,
      vegetation: new Float32Array(n * n).fill(0),
      herbivores: new Float32Array(n * n).fill(0),
      carnivores: new Float32Array(n * n).fill(0),
    } as any;
    const opts: EconomyOptions = { seed: 'barren', gridSize: n, foodConsume: 0.1 };
    const f = createEconomyField(opts, eco);
    // Give some initial food so we can observe it drain.
    for (let i = 0; i < n * n; i++) f.storage[storageIndex(i, 0)] = 1;
    const before = f.storage[storageIndex(0, 0)]!;
    stepEconomyField(f, 1, eco, opts);
    const after = f.storage[storageIndex(0, 0)]!;
    expect(after).toBeLessThan(before);
  });
});

describe('EconomyField ECS integration', () => {
  it('runs under @omega/sim loop coupled to eco, deterministically', () => {
    function build(w: World) {
      registerEcosystemField(w, { seed: 'econ-loop', gridSize: 8, stage: SystemStage.Update, order: 7 });
      registerEconomyField(w, { seed: 'econ-loop', gridSize: 8, stage: SystemStage.Update, order: 8 });
    }
    const simA = new Simulation(new World());
    build(simA.world);
    simA.pause();
    for (let i = 0; i < 40; i++) simA.step();
    const fa = getEconomyField(simA.world)!;

    const simB = new Simulation(new World());
    build(simB.world);
    simB.pause();
    for (let i = 0; i < 40; i++) simB.step();
    const fb = getEconomyField(simB.world)!;

    expect(econSnapshot(fa)).toEqual(econSnapshot(fb));
    expect(fa.tick).toBe(40);
  });
});
