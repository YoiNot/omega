/**
 * @omega/sim — example simulation content.
 *
 * A tiny but REAL agent simulation used to validate the engine spine end-to-end:
 * agents wander, lose energy over time, eat food to recover, and can die. All state is
 * ECS components; all behavior is systems registered to stages. This is the seed of what
 * will grow into the brief's AI/economy/simulation subsystems.
 */

import { World, SystemStage, Rng } from '@omega/engine-core';

export interface AgentComp { id: number; energy: number; age: number; alive: boolean; }
export interface PosComp { x: number; y: number; }
export interface FoodComp { amount: number; }

export const COMP_AGENT = 'Agent';
export const COMP_POS = 'Pos';
export const COMP_FOOD = 'Food';

export interface ColonyConfig {
  agentCount: number;
  foodCount: number;
  worldWidth: number;
  worldHeight: number;
  energyDecayPerSec: number;
  seed: number | string;
}

/** Build a colony world with agents + food and register its simulation systems. */
export function buildColony(world: World, cfg: ColonyConfig): Rng {
  const rng = new Rng(cfg.seed);
  for (let i = 0; i < cfg.agentCount; i++) {
    const id = world.createEntity();
    world.addComponent<PosComp>(COMP_POS, id, {
      x: rng.nextRange(0, cfg.worldWidth),
      y: rng.nextRange(0, cfg.worldHeight),
    });
    world.addComponent<AgentComp>(COMP_AGENT, id, {
      id, energy: rng.nextRange(60, 100), age: 0, alive: true,
    });
  }
  for (let i = 0; i < cfg.foodCount; i++) {
    const id = world.createEntity();
    world.addComponent<PosComp>(COMP_POS, id, {
      x: rng.nextRange(0, cfg.worldWidth),
      y: rng.nextRange(0, cfg.worldHeight),
    });
    world.addComponent<FoodComp>(COMP_FOOD, id, { amount: rng.nextRange(10, 40) });
  }

  // Movement: each alive agent drifts toward the nearest food.
  world.registerSystem(SystemStage.Update, 10, 'agent-move', (w, dt) => {
    const foods = w.query(COMP_FOOD);
    const agents = w.query(COMP_AGENT, COMP_POS);
    for (const aid of agents.ids) {
      const agent = w.getComponent<AgentComp>(COMP_AGENT, aid)!;
      if (!agent.alive) continue;
      const ap = w.getComponent<PosComp>(COMP_POS, aid)!;
      let best: PosComp | null = null;
      let bestD = Infinity;
      for (const fid of foods.ids) {
        const fp = w.getComponent<PosComp>(COMP_POS, fid)!;
        const d = (fp.x - ap.x) ** 2 + (fp.y - ap.y) ** 2;
        if (d < bestD) { bestD = d; best = fp; }
      }
      if (best) {
        const dx = best.x - ap.x, dy = best.y - ap.y;
        const len = Math.hypot(dx, dy) || 1;
        const speed = 20 * dt;
        ap.x += (dx / len) * speed;
        ap.y += (dy / len) * speed;
      }
      agent.age += dt;
    }
  });

  // Metabolism + eating + death.
  world.registerSystem(SystemStage.Update, 20, 'agent-metabolism', (w, dt, tick) => {
    const foods = w.query(COMP_FOOD);
    const agents = w.query(COMP_AGENT, COMP_POS);
    for (const aid of agents.ids) {
      const agent = w.getComponent<AgentComp>(COMP_AGENT, aid)!;
      if (!agent.alive) continue;
      agent.energy -= cfg.energyDecayPerSec * dt;
      const ap = w.getComponent<PosComp>(COMP_POS, aid)!;
      // Eat nearby food.
      for (const fid of foods.ids) {
        const fp = w.getComponent<PosComp>(COMP_POS, fid)!;
        const fd = w.getComponent<FoodComp>(COMP_FOOD, fid)!;
        if (fd.amount <= 0) continue;
        const d = Math.hypot(fp.x - ap.x, fp.y - ap.y);
        if (d < 2) {
          const eaten = Math.min(fd.amount, 15 * dt * 10);
          fd.amount -= eaten;
          agent.energy = Math.min(100, agent.energy + eaten);
        }
      }
      if (agent.energy <= 0) {
        agent.alive = false;
        agent.energy = 0;
        w.destroyEntity(aid);
      }
      void tick;
    }
  });

  return rng;
}

/** Convenience: count living agents. */
export function livingAgentCount(world: World): number {
  const q = world.query(COMP_AGENT);
  let n = 0;
  for (const id of q.ids) if (world.getComponent<AgentComp>(COMP_AGENT, id)!.alive) n++;
  return n;
}
