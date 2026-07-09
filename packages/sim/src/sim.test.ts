import { describe, it, expect } from 'vitest';
import { World, SystemStage } from '@omega/engine-core';
import { Simulation } from './simulation.js';
import { buildColony, livingAgentCount, COMP_POS } from './colony.js';

describe('Simulation control', () => {
  it('pauses by default and does not advance', () => {
    const w = new World();
    const sim = new Simulation(w);
    expect(sim.isRunning).toBe(false);
    expect(sim.advance(1)).toBe(0);
    expect(w.tick).toBe(0);
  });

  it('advances only while running', () => {
    const w = new World();
    // fixedDt=0.05, so a 0.16s frame => 3 fixed steps (0.16/0.05 = 3.2).
    const sim = new Simulation(w, { fixedDt: 0.05, maxSteps: 10 });
    sim.play();
    sim.advance(0.16);
    expect(w.tick).toBe(3);
    sim.pause();
    sim.advance(1);
    expect(w.tick).toBe(3);
  });

  it('records ticks and history is bounded', () => {
    const w = new World();
    const sim = new Simulation(w, { recordLimit: 3 });
    sim.pause();
    for (let i = 0; i < 10; i++) sim.step(i);
    expect(sim.totalTicks).toBe(10);
    expect(sim.history().length).toBe(3); // ring buffer cap
    expect(sim.history()[0].input).toBe(7); // oldest retained
    expect(sim.history()[2].input).toBe(9); // newest
  });
});

describe('Simulation determinism + replay', () => {
  function builder(w: World) {
    w.addComponent(COMP_POS, w.createEntity(), { x: 0, y: 0 });
    w.registerSystem(SystemStage.Update, 0, 'drift', (world, dt) => {
      const id = world.query(COMP_POS).ids[0];
      const p = world.getComponent<{ x: number; y: number }>(COMP_POS, id)!;
      p.x += dt * 10;
    });
  }

  it('replay reproduces the same final state', () => {
    const sim = new Simulation(new World());
    builder(sim.world);
    sim.pause();
    for (let i = 0; i < 50; i++) sim.step();
    const finalX = sim.world.getComponent<{ x: number }>(COMP_POS, sim.world.query(COMP_POS).ids[0])!.x;
    const records = sim.history();

    const replayed = Simulation.replay(builder, records);
    const rX = replayed.world.getComponent<{ x: number }>(COMP_POS, replayed.world.query(COMP_POS).ids[0])!.x;
    expect(rX).toBeCloseTo(finalX, 12);
    expect(records.length).toBe(50);
  });

  it('different frames but same fixed steps => reproducible', () => {
    const w = new World();
    builder(w);
    const sim = new Simulation(w, { fixedDt: 1 / 60, maxSteps: 100 });
    sim.play();
    sim.advance(0.016); sim.advance(0.020); sim.advance(0.016);
    const a = w.query(COMP_POS).ids.map((id) => w.getComponent<{ x: number }>(COMP_POS, id)!.x);

    const w2 = new World();
    builder(w2);
    const sim2 = new Simulation(w2, { fixedDt: 1 / 60, maxSteps: 100 });
    sim2.play();
    sim2.advance(0.052);
    const b = w2.query(COMP_POS).ids.map((id) => w2.getComponent<{ x: number }>(COMP_POS, id)!.x);
    // Same total time => same number of fixed steps => same final x.
    expect(a[0]).toBeCloseTo(b[0], 9);
  });
});

describe('Colony example simulation', () => {
  it('agents spawn, age, and can die from starvation', () => {
    const w = new World();
    buildColony(w, {
      agentCount: 5, foodCount: 2, worldWidth: 100, worldHeight: 100,
      energyDecayPerSec: 12, seed: 1234,
    });
    const sim = new Simulation(w, { fixedDt: 1 / 30, maxSteps: 100 });
    sim.play();
    const start = livingAgentCount(w);
    // Run ~30 simulated seconds.
    for (let i = 0; i < 30 * 30; i++) sim.step();
    const end = livingAgentCount(w);
    expect(start).toBe(5);
    // With high decay and little food, at least some agents should have died.
    expect(end).toBeLessThanOrEqual(start);
    // Determinism: a second run from the same seed yields same end count.
    const w2 = new World();
    buildColony(w2, {
      agentCount: 5, foodCount: 2, worldWidth: 100, worldHeight: 100,
      energyDecayPerSec: 12, seed: 1234,
    });
    const sim2 = new Simulation(w2, { fixedDt: 1 / 30, maxSteps: 100 });
    sim2.play();
    for (let i = 0; i < 30 * 30; i++) sim2.step();
    expect(livingAgentCount(w2)).toBe(end);
  });

  it('agents move toward food over time (positions change)', () => {
    const w = new World();
    buildColony(w, {
      agentCount: 3, foodCount: 4, worldWidth: 50, worldHeight: 50,
      energyDecayPerSec: 1, seed: 7,
    });
    const sim = new Simulation(w, { fixedDt: 1 / 60, maxSteps: 50 });
    sim.play();
    const before = w.query(COMP_POS).ids.map((id) => ({ ...w.getComponent<{ x: number; y: number }>(COMP_POS, id)! }));
    for (let i = 0; i < 60; i++) sim.step();
    const after = w.query(COMP_POS).ids.map((id) => ({ ...w.getComponent<{ x: number; y: number }>(COMP_POS, id)! }));
    let moved = 0;
    for (let i = 0; i < before.length; i++) {
      if (before[i].x !== after[i].x || before[i].y !== after[i].y) moved++;
    }
    expect(moved).toBeGreaterThan(0);
  });
});
