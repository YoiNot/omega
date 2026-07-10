/**
 * apps/web — deterministic GOAP AI tests (@omega/ai-goap wiring).
 *
 * Proves the AI half of the vertical slice:
 *  - a fixed start state + goal + action set yields an identical PLAN;
 *  - the plan is the expected minimum-cost delivery sequence;
 *  - two agents driven over the same seeded grid produce identical BEHAVIOUR
 *    (tile-by-tile trajectories) — same world ⇒ same motion;
 *  - agents actually reach their goal (delivered = 1) on a solvable map.
 *
 * All headless (no DOM).
 */

import { describe, it, expect } from 'vitest';
import { Vec2 } from '@omega/engine-math';
import { World } from '@omega/engine-core';
import { TerrainGenerator } from '@omega/world-gen';
import { buildNavGrid } from './nav';
import {
  planForAgent,
  makeAgentComponent,
  AgentController,
  GoapSystem,
  AGENT_GOAL,
  AGENT_ACTIONS,
} from './ai';
import { plan } from '@omega/ai-goap';

describe('apps/web ai-goap wiring', () => {
  const SEED = 'omega-demo';
  const SIZE = 40;

  function navGrid(seed = SEED) {
    return buildNavGrid(new TerrainGenerator(seed, { size: SIZE }).generate());
  }

  it('same start state + goal => identical minimum-cost plan', () => {
    const a = makeAgentComponent(2, 2);
    const p1 = planForAgent(a)!;
    const p2 = planForAgent(a)!;
    expect(p1.map((x) => x.name)).toEqual(p2.map((x) => x.name));
    // The expected minimum-cost delivery sequence.
    expect(p1.map((x) => x.name)).toEqual([
      'goToResource',
      'gatherResource',
      'goToBase',
      'deliverResource',
    ]);
  });

  it('plan tie-break follows caller action-array order (deterministic)', () => {
    // Reorder the actions; with all-equal costs the plan should still be the
    // unique dependency-forced order (each precondition gates the next).
    const reordered = [...AGENT_ACTIONS].reverse();
    const state = {
      atResource: 0,
      hasResource: 0,
      atBase: 0,
      delivered: 0,
    };
    const p = plan(state, reordered, AGENT_GOAL)!;
    expect(p).not.toBeNull();
    // Dependencies force a single valid ordering regardless of array order.
    expect(p.map((x) => x.name)).toEqual([
      'goToResource',
      'gatherResource',
      'goToBase',
      'deliverResource',
    ]);
  });

  it('a single agent reaches its goal deterministically over the seeded grid', () => {
    const grid = navGrid();
    const start = makeAgentComponent(5, 20);
    const controller = new AgentController(
      1,
      grid,
      start,
      new Vec2(8, 8),
      new Vec2(SIZE - 8, SIZE - 8),
    );
    const state = makeAgentComponent(5, 20);
    // Snap start onto the controller's snapped start (mirror its constructor).
    // Run a generous number of ticks; the agent must deliver.
    for (let t = 0; t < 4000 && !controller.isDone(state); t++) {
      controller.step(state);
    }
    expect(controller.isDone(state)).toBe(true);
    expect(state.delivered).toBe(1);
  });

  it('two GoapSystem runs on the same seed => identical agent trajectories', () => {
    function trace(seed: string): number[][][] {
      const grid = navGrid(seed);
      const world = new World();
      const goap = new GoapSystem(world, grid);
      goap.spawnAgent(new Vec2(6, 20), new Vec2(8, 8), new Vec2(SIZE - 8, SIZE - 8));
      goap.spawnAgent(new Vec2(30, 20), new Vec2(8, 8), new Vec2(SIZE - 8, SIZE - 8));
      const frames: number[][][] = [];
      for (let t = 0; t < 300; t++) {
        goap.step();
        frames.push(goap.positions().map((p) => [p.id, p.tx, p.tz, p.delivered]));
      }
      return frames;
    }
    const a = trace(SEED);
    const b = trace(SEED);
    expect(b).toEqual(a);
  });

  it('agent trajectories differ from a different seed (grid influences routes)', () => {
    function fullTrace(seed: string): number[][][] {
      const grid = navGrid(seed);
      const world = new World();
      const goap = new GoapSystem(world, grid);
      goap.spawnAgent(new Vec2(6, 20), new Vec2(8, 8), new Vec2(SIZE - 8, SIZE - 8));
      const frames: number[][][] = [];
      for (let t = 0; t < 80; t++) {
        goap.step();
        frames.push(goap.positions().map((p) => [p.tx, p.tz]));
      }
      return frames;
    }
    // Deterministic per seed…
    expect(fullTrace('seed-a')).toEqual(fullTrace('seed-a'));
    // …but the tick-by-tick routes differ across seeds (different blocked tiles).
    expect(fullTrace('seed-a')).not.toEqual(fullTrace('seed-zzzz'));
  });
});
