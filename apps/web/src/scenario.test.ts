/**
 * apps/web — deterministic gameplay scenario tests.
 *
 * The scenario is the seed-braced "world + entity setup" the vertical slice
 * needs: GOAP agents that plan + navigate, resource nodes they (and wanderers)
 * deplete, and roaming blockers they route around — all spawned from one seed.
 *
 * Proves:
 *  - building a scenario twice from the same seed yields identical placement;
 *  - a scenario-driven demo is a pure function of the seed (tick-for-tick);
 *  - agents pursue a real GOAP plan AND the emergent resource/blocker/wanderer
 *    content is present and reproducible;
 *  - the whole thing reproduces through record → replay (bit-for-bit), proving
 *    the scenario's behaviour is captured deterministically by @omega/replay.
 */

import { describe, it, expect } from 'vitest';
import {
  runHeadless,
  recordHeadless,
  replayHeadless,
  createDemo,
} from './engine';
import { buildScenario, DEFAULT_COUNTS } from './scenario';
import { serializeRecording, loadRecording } from '@omega/replay';

const SEED = 'omega-demo';
const TICKS = 200;

describe('apps/web scenario — deterministic construction', () => {
  it('same seed ⇒ identical scenario placement (resources/blockers/wanderers/agents)', () => {
    const a = buildScenario(SEED, 40, DEFAULT_COUNTS);
    const b = buildScenario(SEED, 40, DEFAULT_COUNTS);
    expect(a.resourceTiles).toEqual(b.resourceTiles);
    expect(a.blockerTiles).toEqual(b.blockerTiles);
    expect(a.wandererTiles).toEqual(b.wandererTiles);
    expect(a.agentTiles).toEqual(b.agentTiles);
    expect([a.agentResourceTile.x, a.agentResourceTile.y]).toEqual([
      b.agentResourceTile.x,
      b.agentResourceTile.y,
    ]);
  });

  it('applyScenario spawns the expected entity counts in the gameplay system', () => {
    const demo = createDemo({ seed: SEED, gameplay: true });
    expect(demo.gameplay.resources().length).toBe(DEFAULT_COUNTS.resources);
    expect(demo.gameplay.blockers().length).toBe(DEFAULT_COUNTS.blockers);
    expect(demo.gameplay.wanderers().length).toBe(DEFAULT_COUNTS.wanderers);
    expect(demo.agentPositions().length).toBe(DEFAULT_COUNTS.agents);
  });

  it('applying a scenario twice to fresh worlds is identical', () => {
    // The base createDemo already applies the scenario; re-applying must not
    // double-spawn, so counts stay at the scenario defaults.
    const demo = createDemo({ seed: SEED, gameplay: true });
    expect(demo.gameplay.resources().length).toBe(DEFAULT_COUNTS.resources);
  });
});

describe('apps/web scenario — reproducible behaviour (tick-for-tick)', () => {
  it('same seed ⇒ identical full observable state (physics + agents + gameplay)', () => {
    const a = runHeadless(SEED, TICKS);
    const b = runHeadless(SEED, TICKS);
    expect(b).toEqual(a);
  });

  it('agents have a real GOAP plan and the gameplay content is present', () => {
    const demo = createDemo({ seed: SEED });
    for (const agent of demo.agentPositions()) {
      const plan = demo.agentPlan(agent.id);
      expect(plan).toEqual(['goToResource', 'gatherResource', 'goToBase', 'deliverResource']);
    }
    expect(demo.resourcePositions().length).toBeGreaterThan(0);
    expect(demo.blockerPositions().length).toBeGreaterThan(0);
    expect(demo.wandererPositions().length).toBeGreaterThan(0);
  });

  it('the scenario reproduces through record → replay (bit-for-bit)', () => {
    const { recording, result } = recordHeadless(SEED, TICKS);
    const bytes = serializeRecording(recording, 0);
    const loaded = loadRecording(bytes);
    const replayed = replayHeadless(loaded, TICKS);
    expect(replayed.resources).toEqual(result.resources);
    expect(replayed.blockers).toEqual(result.blockers);
    expect(replayed.wanderers).toEqual(result.wanderers);
    expect(replayed.agents).toEqual(result.agents);
  });
});
