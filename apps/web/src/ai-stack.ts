/**
 * apps/web — full AI stack wiring for the vertical-slice demo.
 *
 * The previous demo used `@omega/ai-goap` in isolation. This module brings the
 * FULL §14 agent-capability stack to bear on the demo's agents, layered ON TOP
 * of the existing {@link GoapSystem} so the gameplay/test surface stays intact:
 *
 *   - ai-goap        : the planner (unchanged core).
 *   - ai-goals       : a persistent GOAL CHAIN (seek → gather → deliver → loop)
 *                       selects which sub-goal the agent pursues and plans it.
 *   - ai-personality : each agent gets a deterministic TRAIT VECTOR that shifts
 *                       GOAP action costs, so two agents with different
 *                       personalities may weight the same actions differently.
 *   - ai-learning    : a per-agent PRACTICE LEDGER that lowers the cost of
 *                       actions the agent performs, so experience makes it
 *                       "better" at what it repeats — deterministically.
 *   - ai-memory      : each agent keeps an EPISODIC RING BUFFER + a merged
 *                       SEMANTIC BELIEF of the world it observes each tick.
 *   - ai-relationships: a shared DIRECTED SOCIAL NETWORK between agents; when
 *                       two agents share a resource tile they form a 'bond'.
 *
 * Everything is a pure function of (seed, agent ids, tick). No clock, no RNG at
 * plan time beyond the seeded per-agent trait draw, which is stable across runs.
 * The class extends {@link GoapSystem}, so `positions()`, `planNames()`,
 * `spawnAgent()`, and the existing `ai.test.ts` (which uses the base planner
 * directly) all keep working unchanged.
 */

import { Rng } from '@omega/engine-core';
import { Vec2 } from '@omega/engine-math';
import {
  plan,
  type Action,
  type Goal,
  type WorldState,
  type Plan,
} from '@omega/ai-goap';
import { GoalSystem, type GoalDef } from '@omega/ai-goals';
import { Personality, type PersonaAction, type TraitVector } from '@omega/ai-personality';
import { PracticeLog } from '@omega/ai-learning';
import { MemoryStore } from '@omega/ai-memory';
import { RelationshipNetwork, type Interaction } from '@omega/ai-relationships';
import type { World } from '@omega/engine-core';
import type { Grid } from '@omega/nav-core';
import {
  GoapSystem,
  makeAgentComponent,
  AGENT_ACTIONS,
  agentWorldState,
  type AgentComponent,
} from './ai';

/** Trait names every agent carries (all in [-1, 1]). */
const TRAITS = ['caution', 'industriousness', 'sociability'] as const;

/**
 * The persistent goal chain an agent cycles through. Each goal is a partial
 * WorldState; reaching one spawns the next (deterministic chaining), so a
 * delivered agent immediately re-seeks a resource — emergent repetition
 * without a wall clock.
 */
function agentGoalDefs(): GoalDef[] {
  return [
    {
      id: 'seek_resource',
      desired: { atResource: 1 } as WorldState,
      baseUtility: 1,
      priority: 1,
      spawnOnComplete: ['gather'],
    },
    {
      id: 'gather',
      desired: { hasResource: 1 } as WorldState,
      baseUtility: 1.2,
      priority: 2,
      spawnOnComplete: ['deliver'],
    },
    {
      id: 'deliver',
      desired: { delivered: 1 } as WorldState,
      baseUtility: 1.5,
      priority: 3,
      spawnOnComplete: ['seek_resource'],
    },
  ];
}

/**
 * Map the base GOAP actions onto persona-aware actions: each action acquires a
 * cost modifier tied to a trait, so a personality shifts its effective cost. The
 * dependency structure is unchanged, so the plan ORDER stays identical — only
 * the costs (and thus tie-breaks under genuinely ambiguous options) shift.
 */
function personaActions(): PersonaAction[] {
  const go = (name: string): Action => AGENT_ACTIONS.find((a) => a.name === name)!;
  const out: PersonaAction[] = [
    { base: go('goToResource'), costModifiers: { industriousness: -0.3 } },
    { base: go('gatherResource'), costModifiers: { industriousness: -0.5 } },
    { base: go('goToBase'), costModifiers: { caution: 0.4 } },
    { base: go('deliverResource'), costModifiers: { caution: -0.2 } },
  ];
  return out;
}

/** A deterministic trait vector for agent `id` under `seed`. Stable per run. */
function personaFor(seed: string, id: number): Personality {
  const rng = new Rng(`ai-stack:persona:${seed}:${id}`);
  const traits: TraitVector = {};
  for (const t of TRAITS) traits[t] = rng.nextRange(-1, 1);
  return new Personality(`agent-${id}`, traits);
}

/** Per-agent observable AI-stack state (for HUD / tests). */
export interface AgentStackView {
  entity: number;
  traits: TraitVector;
  goal: string | null;
  /** Items the practice ledger has seen (action -> practice count). */
  practice: Record<string, number>;
  /** Count of episodic memories retained. */
  memoryCount: number;
  /** Semantic belief snapshot (merged observed state). */
  belief: WorldState;
}

/**
 * The full AI-stack agent system. Extends the deterministic {@link GoapSystem}
 * so all existing demo gameplay + tests keep working, while additionally
 * maintaining the §14 stack per agent and driving it every tick.
 */
export class AiStackSystem extends GoapSystem {
  private readonly stackSeed: string;
  private readonly personalities = new Map<number, Personality>();
  private readonly practice = new Map<number, PracticeLog>();
  private readonly memory = new Map<number, MemoryStore>();
  private readonly goalSystems = new Map<number, GoalSystem>();
  private readonly relationships = new RelationshipNetwork();

  constructor(world: World, grid: Grid, seed: string) {
    super(world, grid);
    this.stackSeed = seed;
  }

  /** Spawn an agent, attaching a deterministic AI-stack per agent. */
  override spawnAgent(startTile: Vec2, resource: Vec2, base: Vec2): number {
    // Build via the base class so entity + controller come up normally.
    const id = super.spawnAgent(startTile, resource, base);
    const persona = personaFor(this.stackSeed, id);
    const log = new PracticeLog(0.5, 0.5);
    const mem = new MemoryStore(64, 'last');
    const goals = new GoalSystem(agentGoalDefs());
    this.personalities.set(id, persona);
    this.practice.set(id, log);
    this.memory.set(id, mem);
    this.goalSystems.set(id, goals);
    return id;
  }

  /**
   * Build the full-stack plan for an agent's current state: shift the persona
   * actions by the agent's personality + practice, then let the GoalSystem
   * select the current sub-goal and plan toward it. Falls back to the base GOAP
   * plan if the stacked planner yields nothing.
   */
  private planStacked(state: AgentComponent, id: number): Plan {
    const persona = this.personalities.get(id);
    const log = this.practice.get(id);
    const goals = this.goalSystems.get(id);
    const pa = personaActions();
    let actions: Action[] = pa.map((p) => p.base);
    if (persona && log) {
      // Apply personality cost shift, then learning refinement.
      const shifted = persona.shiftActions(pa);
      actions = log.adjustActions(shifted);
    }
    const ws = agentWorldState(state);
    if (goals) {
      const stacked = goals.plan(ws, actions);
      if (stacked && stacked.length > 0) return stacked;
    }
    // Fallback: base GOAP plan (keeps behaviour identical for the test oracle).
    const base = plan(ws, AGENT_ACTIONS, { delivered: 1 } as Goal);
    return base ?? [];
  }

  /** Advance every agent one tick, then drive the AI stack for each. */
  override step(): void {
    // The base controller must already exist; re-plan with the stacked planner
    // by mending each controller's plan when it is exhausted / on first run.
    for (const controller of this.controllers()) {
      const comp = this.engineWorld().getComponent<AgentComponent>(
        this.agentStore(),
        controller.entity,
      );
      if (!comp) continue;
      // (Re)compute the stacked plan when the agent has no plan left.
      if (comp.planStep >= controller.actions.length) {
        const planActions = this.planStacked(comp, controller.entity);
        (controller as unknown as { planActions: Plan }).planActions = planActions;
        comp.planStep = 0;
      }
      // Drive the controller forward one tile.
      controller.step(comp);
      this.engineWorld().addComponent<AgentComponent>(this.agentStore(), controller.entity, comp);

      // --- AI stack bookkeeping (deterministic, pure of the controller) ---
      this.driveStack(controller.entity, comp);
    }
  }

  /** Update memory / relationships / practice for one agent after a tick. */
  private driveStack(id: number, comp: AgentComponent): void {
    const mem = this.memory.get(id);
    if (mem) mem.record('observe', agentWorldState(comp));

    const log = this.practice.get(id);
    if (log && comp.delivered === 1) {
      // Completing a delivery "practises" the whole plan → cheaper next cycle.
      log.practicePlan(this.controllers().find((c) => c.entity === id)?.actions ?? []);
    }

    // Social: when two agents sit on the same tile, bond them (directed, stable).
    const here = `${comp.tx},${comp.tz}`;
    for (const other of this.controllers()) {
      if (other.entity === id) continue;
      const oc = this.engineWorld().getComponent<AgentComponent>(this.agentStore(), other.entity);
      if (oc && `${oc.tx},${oc.tz}` === here) {
        const it: Interaction = {
          actor: String(id),
          target: String(other.entity),
          type: 'bond',
          magnitude: 0.25,
          weight: 1,
        };
        this.relationships.applyInteraction(it);
      }
    }
  }

  /** Observable AI-stack state per agent, ascending by id. */
  stackViews(): AgentStackView[] {
    const out: AgentStackView[] = [];
    for (const id of this.agentIds()) {
      const persona = this.personalities.get(id);
      const log = this.practice.get(id);
      const mem = this.memory.get(id);
      const goals = this.goalSystems.get(id);
      out.push({
        entity: id,
        traits: persona ? persona.traitsSnapshot() : {},
        goal: goals ? (goals.select(agentWorldState(
          this.engineWorld().getComponent<AgentComponent>(this.agentStore(), id) ??
            makeAgentComponent(0, 0),
        ))?.id ?? null) : null,
        practice: log ? { ...log.serialize().counts } : {},
        memoryCount: mem ? mem.count : 0,
        belief: mem ? mem.getBelief() : {},
      });
    }
    return out;
  }

  /** The shared social network (serializable). */
  relationshipSnapshot() {
    return this.relationships.serialize();
  }

  /** Best ally of an agent in the social network (or null). */
  bestAlly(id: number): string | null {
    return this.relationships.bestAlly(String(id));
  }
}
