/**
 * apps/web — deterministic GOAP agents wired to navigation.
 *
 * This is the AI half of the vertical slice: an agent entity PLANS with
 * `@omega/ai-goap` (a WorldState bridged from its ECS component) and then
 * NAVIGATES with `@omega/nav-core` to execute that plan on the shared,
 * seeded terrain grid.
 *
 * Scenario (small but real GOAP): an agent must DELIVER a resource to base.
 *   actions: goToResource → gatherResource → goToBase → deliverResource
 *   goal:    { delivered: 1 }
 * `plan()` returns that ordered, minimum-cost action sequence deterministically
 * (its tie-break is caller-array order), and the controller walks the agent one
 * grid tile per fixed tick along the A* path to each action's target location,
 * applying the action's effect on arrival.
 *
 * Determinism contract: the plan is a pure function of the agent's start state +
 * action set; every path is a pure function of (grid, start, goal); movement is
 * one deterministic tile per tick. No clock, no randomness. Agent state lives in
 * an engine-core `World` store as JSON-serializable numbers, so @omega/replay
 * snapshots it every tick and playback reconstructs agent motion bit-for-bit.
 */

import { Vec2 } from '@omega/engine-math';
import type { World } from '@omega/engine-core';
import { plan, type Action, type Goal, type WorldState, type Plan } from '@omega/ai-goap';
import type { Grid } from '@omega/nav-core';
import { pathBetween, nearestFreeTile, tileToWorld } from './nav';

/** Engine-core store name for the serializable agent component. */
export const AGENT_STORE = 'GoapAgent';

/**
 * Serializable agent state (all numbers so it survives @omega/save's JSON
 * snapshot in @omega/replay). `tx,tz` is the agent's current tile; the flags
 * mirror the GOAP WorldState; `planStep` indexes the executing plan.
 */
export interface AgentComponent {
  /** Current tile X. */
  tx: number;
  /** Current tile Y (world Z). */
  tz: number;
  /** Index into the fixed plan (which action is executing). */
  planStep: number;
  /** 1 once the resource tile has been reached. */
  atResource: number;
  /** 1 once the resource is gathered. */
  hasResource: number;
  /** 1 once back at base with the resource. */
  atBase: number;
  /** 1 once delivered (goal). */
  delivered: number;
}

/** The GOAP goal every agent pursues: deliver the resource. */
export const AGENT_GOAL: Goal = { delivered: 1 };

/**
 * The agent's action repertoire. Order is significant: `plan()`'s deterministic
 * tie-break prefers the action listed earlier in this array, so keeping the list
 * stable keeps the chosen plan stable.
 */
export const AGENT_ACTIONS: readonly Action[] = [
  {
    name: 'goToResource',
    preconditions: { atResource: 0 },
    effects: { atResource: 1 },
    cost: 1,
  },
  {
    name: 'gatherResource',
    preconditions: { atResource: 1, hasResource: 0 },
    effects: { hasResource: 1 },
    cost: 1,
  },
  {
    name: 'goToBase',
    preconditions: { hasResource: 1, atBase: 0 },
    effects: { atBase: 1 },
    cost: 1,
  },
  {
    name: 'deliverResource',
    preconditions: { atBase: 1, hasResource: 1 },
    effects: { delivered: 1 },
    cost: 1,
  },
];

/** Build the GOAP WorldState from an agent component's flags. */
export function agentWorldState(a: AgentComponent): WorldState {
  return {
    atResource: a.atResource,
    hasResource: a.hasResource,
    atBase: a.atBase,
    delivered: a.delivered,
  };
}

/** Plan the ordered action sequence for an agent's current state (may be `[]`). */
export function planForAgent(a: AgentComponent): Plan | null {
  return plan(agentWorldState(a), AGENT_ACTIONS, AGENT_GOAL);
}

/** Which locomotion actions require walking to a target tile (vs. instant). */
function isMoveAction(name: string): boolean {
  return name === 'goToResource' || name === 'goToBase';
}

/**
 * A deterministic controller for one agent: holds the fixed plan + the current
 * A* path, and advances the agent one tile per `tick`. Locations are fixed tiles
 * supplied at construction (snapped to the nearest free tile). Instant actions
 * (gather/deliver) fire the moment their precondition location is reached.
 *
 * The controller keeps its plan/path in memory; the AUTHORITATIVE, replay-safe
 * state is the `AgentComponent` it writes back into the world every tick.
 */
export class AgentController {
  readonly entity: number;
  private readonly grid: Grid;
  private readonly resourceTile: Vec2;
  private readonly baseTile: Vec2;
  planActions: Plan;
  private path: Vec2[] = [];
  private pathIdx = 0;

  constructor(
    entity: number,
    grid: Grid,
    start: AgentComponent,
    resourceTile: Vec2,
    baseTile: Vec2,
  ) {
    this.entity = entity;
    this.grid = grid;
    // Snap targets onto walkable tiles so a blocked goal never crashes the plan.
    this.resourceTile = nearestFreeTile(grid, resourceTile.x, resourceTile.y) ?? resourceTile;
    this.baseTile = nearestFreeTile(grid, baseTile.x, baseTile.y) ?? baseTile;
    this.planActions = planForAgent(start) ?? [];
    this.retargetPath(start);
  }

  /** The fixed, deterministic plan chosen for this agent. */
  get actions(): Plan {
    return this.planActions;
  }

  /** True once the agent has executed its whole plan (goal reached). */
  isDone(state: AgentComponent): boolean {
    return state.delivered === 1 || state.planStep >= this.planActions.length;
  }

  /** Target tile of the current plan step (resource/base), or null when done. */
  private currentTarget(state: AgentComponent): Vec2 | null {
    const action = this.planActions[state.planStep];
    if (!action) return null;
    if (action.name === 'goToResource' || action.name === 'gatherResource') {
      return this.resourceTile;
    }
    return this.baseTile; // goToBase / deliverResource
  }

  /**
   * Replace the controller's plan and recompute its A* path from the agent's
   * current tile. Used by the full AI stack to inject a personality/learning/
   * goal-adjusted plan at runtime. Deterministic: same inputs ⇒ same plan/path.
   */
  setPlan(p: Plan, state: AgentComponent): void {
    this.planActions = p;
    this.pathIdx = 0;
    this.retargetPath(state);
  }

  /** Recompute the A* path from the agent's tile to the current target tile. */
  private retargetPath(state: AgentComponent): void {
    const target = this.currentTarget(state);
    if (!target) {
      this.path = [];
      this.pathIdx = 0;
      return;
    }
    const from = nearestFreeTile(this.grid, state.tx, state.tz) ?? new Vec2(state.tx, state.tz);
    const p = pathBetween(this.grid, from, target, { allowDiagonal: false });
    this.path = p ?? [new Vec2(state.tx, state.tz)];
    this.pathIdx = 0;
  }

  /**
   * Advance the agent by one fixed tick, mutating `state` in place. Returns the
   * (same) mutated state for convenience. Deterministic: at most one tile of
   * movement, then any instant actions whose location is satisfied fire.
   */
  step(state: AgentComponent): AgentComponent {
    if (this.isDone(state)) return state;

    const action = this.planActions[state.planStep];
    if (!action) return state;

    if (isMoveAction(action.name)) {
      // Walk one tile toward the target along the precomputed path.
      if (this.pathIdx < this.path.length - 1) {
        this.pathIdx++;
        const t = this.path[this.pathIdx]!;
        state.tx = t.x;
        state.tz = t.y;
      }
      const target = this.currentTarget(state);
      if (target && state.tx === target.x && state.tz === target.y) {
        // Arrived → apply the move action's effect and advance the plan.
        applyEffect(state, action.name);
        state.planStep++;
        this.retargetPath(state);
      }
    } else {
      // Instant action (gather/deliver): fire immediately, advance the plan.
      applyEffect(state, action.name);
      state.planStep++;
      this.retargetPath(state);
    }
    return state;
  }

  /** Agent's current world-space (x, z) centre for rendering. */
  worldPos(state: AgentComponent): Vec2 {
    return tileToWorld(state.tx, state.tz);
  }
}

/** Apply a GOAP action's effect onto the serializable agent flags. */
function applyEffect(state: AgentComponent, actionName: string): void {
  switch (actionName) {
    case 'goToResource':
      state.atResource = 1;
      break;
    case 'gatherResource':
      state.hasResource = 1;
      break;
    case 'goToBase':
      state.atBase = 1;
      break;
    case 'deliverResource':
      state.delivered = 1;
      break;
    default:
      break;
  }
}

/** A fresh agent component parked on a starting tile with all flags cleared. */
export function makeAgentComponent(tx: number, tz: number): AgentComponent {
  return {
    tx,
    tz,
    planStep: 0,
    atResource: 0,
    hasResource: 0,
    atBase: 0,
    delivered: 0,
  };
}

/**
 * A deterministic multi-agent GOAP system over an engine-core `World`. Each
 * agent is an entity carrying an {@link AgentComponent} in the {@link AGENT_STORE}
 * store; the system steps every agent one tile per tick along its planned route.
 * The component store is JSON-serializable, so @omega/replay snapshots it.
 */
export class GoapSystem {
  private readonly world: World;
  private readonly grid: Grid;
  private readonly controllersList: AgentController[] = [];

  constructor(world: World, grid: Grid) {
    this.world = world;
    this.grid = grid;
  }

  /** Spawn an agent at `startTile` planning to gather at `resource`, deliver at `base`. */
  spawnAgent(startTile: Vec2, resource: Vec2, base: Vec2): number {
    const id = this.world.createEntity();
    const start = nearestFreeTile(this.grid, startTile.x, startTile.y) ?? startTile;
    const comp = makeAgentComponent(start.x, start.y);
    this.world.addComponent<AgentComponent>(AGENT_STORE, id, comp);
    this.controllersList.push(new AgentController(id, this.grid, comp, resource, base));
    return id;
  }

  /** The chosen plan (action names) for agent `entity`, or `[]`. */
  planNames(entity: number): string[] {
    const c = this.controllersList.find((x) => x.entity === entity);
    return c ? c.actions.map((a) => a.name) : [];
  }

  /** Step every agent one fixed tick (deterministic, id-ascending order). */
  step(): void {
    for (const controller of this.controllersList) {
      const comp = this.world.getComponent<AgentComponent>(AGENT_STORE, controller.entity);
      if (!comp) continue;
      controller.step(comp);
      // Component is mutated in place, but re-add to be explicit about the write.
      this.world.addComponent<AgentComponent>(AGENT_STORE, controller.entity, comp);
    }
  }

  /** The live agent controllers (read-only). Used by the AI stack extension. */
  controllers(): readonly AgentController[] {
    return this.controllersList;
  }

  /** The engine-core store name the agent component lives in. */
  agentStore(): string {
    return AGENT_STORE;
  }

  /** The underlying engine-core world (used by the AI stack extension). */
  engineWorld(): World {
    return this.world;
  }

  /** Ascending entity ids of all spawned agents. */
  agentIds(): number[] {
    return [...this.controllersList.map((c) => c.entity)].sort((a, b) => a - b);
  }

  /** Observable agent tile positions, ascending by entity id. */
  positions(): { id: number; tx: number; tz: number; delivered: number }[] {
    const out: { id: number; tx: number; tz: number; delivered: number }[] = [];
    for (const id of this.world.store<AgentComponent>(AGENT_STORE).keys()) {
      const c = this.world.getComponent<AgentComponent>(AGENT_STORE, id);
      if (c) out.push({ id, tx: c.tx, tz: c.tz, delivered: c.delivered });
    }
    return out;
  }

  /** True once every agent has reached its goal. */
  allDone(): boolean {
    for (const controller of this.controllersList) {
      const comp = this.world.getComponent<AgentComponent>(AGENT_STORE, controller.entity);
      if (comp && !controller.isDone(comp)) return false;
    }
    return true;
  }
}
