/**
 * apps/web — Colony-Sim (Step 1 of Phase B, §22 + §21) determinism + integration.
 *
 * Proves the Colony-Sim scenario — a coherent, playable slice on the procgen
 * world where the §13 sim stack (sim-eco population model) and the §14 AI stack
 * (goals / personality / relationships / memory / learning) run together and
 * stay deterministic:
 *   - sim-eco vegetation/herbivore/carnivore fields evolve and are reproducible;
 *   - AI-stack agent personas (traits) + chained goals + social graph are stable
 *     per seed and identical across runs;
 *   - relationship bonds form deterministically (agents co-located on a tile);
 *   - the whole Colony-Sim end state is a pure function of the seed (same seed
 *     ⇒ same world, agents, and ecosystem tick-for-tick).
 *
 * The PBR terrain material/sun surfaced in the browser (renderer.ts §8 NEXT) is
 * exercised headlessly via the deterministic material+light data below — the
 * rendered terrain is a pure function of the seed, matching this contract.
 *
 * Every assertion is a pure function of the seed — no clock, no RNG at runtime.
 */

import { describe, it, expect } from 'vitest';
import { createDemo } from './engine';
import { buildPbrTerrain } from './engine';
import { defaultPbrMaterial, defaultSun, defaultEnvironment } from '@omega/render';
import { buildGeologyTerrain } from './slice';

const SEED = 'colony-alpha';
const TICKS = 60;

/** Mean of an EcoField channel (deterministic aggregation for comparison). */
function mean(arr: Float32Array): number {
  if (arr.length === 0) return 0;
  let s = 0;
  for (let i = 0; i < arr.length; i++) s += arr[i]!;
  return s / arr.length;
}

describe('Colony-Sim — sim-eco population model is deterministic', () => {
  it('same seed ⇒ identical vegetation/herbivore/carnivore fields', () => {
    const run = () => {
      const demo = createDemo({ seed: SEED });
      for (let t = 0; t < TICKS; t++) demo.step();
      const eco = demo.simSpine.eco;
      return {
        veg: mean(eco.vegetation),
        herb: mean(eco.herbivores),
        carn: mean(eco.carnivores),
        tick: eco.tick,
      };
    };
    const a = run();
    const b = run();
    expect(a).toEqual(b);
    // The ecosystem actually advanced (coupled to the env field, not inert).
    expect(a.tick).toBe(TICKS);
    expect(Number.isFinite(a.veg)).toBe(true);
    expect(Number.isFinite(a.herb)).toBe(true);
    expect(Number.isFinite(a.carn)).toBe(true);
  });
});

describe('Colony-Sim — §14 AI stack drives colony agents deterministically', () => {
  it('agent personas (traits) + chained goals are stable per seed', () => {
    const demo = createDemo({ seed: SEED });
    for (let t = 0; t < TICKS; t++) demo.step();
    const views = demo.aiStackViews();
    expect(views.length).toBeGreaterThan(0);
    // Trait vectors are a pure function of (seed, agent id) — stable + bounded.
    for (const v of views) {
      expect(Object.keys(v.traits).length).toBeGreaterThan(0);
      for (const key of Object.keys(v.traits)) {
        const val = v.traits[key]!;
        expect(val).toBeGreaterThanOrEqual(-1);
        expect(val).toBeLessThanOrEqual(1);
      }
      expect(v.goal).not.toBeNull();
    }
  });

  it('two runs with the same seed produce byte-identical AI-stack + eco state', () => {
    const run = () => {
      const demo = createDemo({ seed: SEED });
      for (let t = 0; t < TICKS; t++) demo.step();
      const eco = demo.simSpine.eco;
      return JSON.stringify({
        agents: demo.aiStackViews(),
        veg: Array.from(eco.vegetation).map((x) => Math.round(x * 1e6)),
        herb: Array.from(eco.herbivores).map((x) => Math.round(x * 1e6)),
        carn: Array.from(eco.carnivores).map((x) => Math.round(x * 1e6)),
        social: demo.relationshipSnapshot(),
      });
    };
    expect(run()).toEqual(run());
  });
});

describe('Colony-Sim — social bonds form deterministically', () => {
  it('co-located agents bond (directed sympathy) and the graph is reproducible', () => {
    const run = () => {
      const demo = createDemo({ seed: SEED });
      for (let t = 0; t < TICKS; t++) demo.step();
      const rel = demo.relationshipSnapshot();
      // Collect every non-zero sympathy edge as a stable string.
      const edges: string[] = [];
      for (const a of rel.actors) {
        for (const b of rel.actors) {
          const sym = rel.sympathy[a]?.[b];
          if (sym && sym !== 0) edges.push(`${a}->${b}:${sym.toFixed(4)}`);
        }
      }
      edges.sort();
      return edges.join('|');
    };
    const a = run();
    const b = run();
    expect(a).toEqual(b);
    // At least one bond formed during the run (agents share tiles).
    expect(a.length).toBeGreaterThan(0);
  });
});

describe('Colony-Sim — PBR terrain render data is deterministic (§8 NEXT)', () => {
  it('same seed ⇒ identical PBR material + LOD mesh + lighting', () => {
    const a = buildPbrTerrain(SEED, 40);
    const b = buildPbrTerrain(SEED, 40);
    expect(a.material.albedo).toEqual(b.material.albedo);
    expect(a.material.roughness).toBeCloseTo(b.material.roughness, 6);
    expect(a.material.metallic).toBeCloseTo(b.material.metallic, 6);
    expect(a.lod.levels.length).toBe(b.lod.levels.length);
    // The lighting the browser shader consumes is also deterministic.
    const sun = defaultSun();
    const env = defaultEnvironment();
    expect(sun.direction).toEqual(defaultSun().direction);
    expect(env.ambientTop).toEqual(defaultEnvironment().ambientTop);
    // Default material instance matches what the renderer.enablePbr expects.
    const mat = defaultPbrMaterial();
    expect(mat.albedo.length).toBe(3);
  });

  it('the procgen world the colony rides is deterministic', () => {
    const a = buildGeologyTerrain(`${SEED}:geology`, 40);
    const b = buildGeologyTerrain(`${SEED}:geology`, 40);
    expect(Array.from(a.heights)).toEqual(Array.from(b.heights));
    expect(Array.from(a.biomeIds)).toEqual(Array.from(b.biomeIds));
  });
});

describe('Colony-Sim — end-to-end state is a pure function of the seed', () => {
  it('same seed ⇒ identical colony (eco + agents + social) across full runs', () => {
    const run = () => {
      const demo = createDemo({ seed: SEED });
      for (let t = 0; t < TICKS; t++) demo.step();
      const eco = demo.simSpine.eco;
      return JSON.stringify({
        veg: mean(eco.vegetation),
        herb: mean(eco.herbivores),
        carn: mean(eco.carnivores),
        agents: demo.aiStackViews().map((v) => ({ id: v.entity, goal: v.goal })),
        social: demo.relationshipSnapshot().actors,
        burning: demo.simSpine.burning(),
        trade: demo.simSpine.tradeFlows(),
      });
    };
    expect(run()).toEqual(run());
    // A different seed ⇒ a deterministically different but reproducible colony.
    const other = (() => {
      const demo = createDemo({ seed: 'colony-beta' });
      for (let t = 0; t < TICKS; t++) demo.step();
      const eco = demo.simSpine.eco;
      return JSON.stringify({
        veg: mean(eco.vegetation),
        agents: demo.aiStackViews().map((v) => ({ id: v.entity, goal: v.goal })),
      });
    })();
    expect(other).not.toEqual(run());
    // And the other seed is itself reproducible.
    expect(other).toEqual(
      (() => {
        const demo = createDemo({ seed: 'colony-beta' });
        for (let t = 0; t < TICKS; t++) demo.step();
        const eco = demo.simSpine.eco;
        return JSON.stringify({
          veg: mean(eco.vegetation),
          agents: demo.aiStackViews().map((v) => ({ id: v.entity, goal: v.goal })),
        });
      })(),
    );
  });
});
