/**
 * @omega/ai-goals — prioritized, persistent goals built ON TOP of @omega/ai-goap.
 *
 * GOAP alone answers "given ONE goal, what is the cheapest action plan?" This module answers
 * the meta-question: "which goal should I pursue right now, and what happens when I reach it?"
 *
 *   - Each {@link GoalDef} pairs a GOAP {@link WorldState} goal (its `desired` partial state)
 *     with a `baseUtility` and optional dynamic `utility(state)` term. A goal may also declare
 *     `spawnOnComplete` — goal ids to ACTIVATE the moment it is reached — which is how complex
 *     behaviours chain (e.g. reach the camp -> spawn "rest" and "eat" goals).
 *
 *   - {@link GoalSystem} holds the set of ACTIVE goals (the persistent goal pool / stack).
 *     `select(state)` ranks active, not-yet-satisfied goals by effective utility and returns
 *     the winner; `plan(state, actions)` runs the existing GOAP `plan` toward that winner.
 *
 *   - `complete(goalId)` marks a goal reached: it deactivates it (unless `persistent`) and
 *     activates its spawned children. `autoComplete(state)` does this for every active goal
 *     already satisfied, so "reaching a goal spawns the next ones" happens in one call.
 *
 * DETERMINISM CONTRACT: no clock, no RNG. `select`/`rank` order goals by the total key
 *   (-utility, -priority, +declarationIndex, +id) computed from the STATIC goal defs plus the
 *   pure `utility(state)` term. Identical (goal defs, active set, world state) ALWAYS yields
 *   the same selected goal and the same plan. Tie-breaks are stable: declaration order in the
 *   constructor array, then lexicographic `id`, so two equal-utility goals never flip between
 *   runs or platforms.
 */

import { meetsGoal, plan, type Action, type Plan, type WorldState } from '@omega/ai-goap';

/** A single prioritized, persistent goal definition. */
export interface GoalDef {
  /** Stable identifier (used for activation / spawning / tie-breaks). */
  readonly id: string;
  /** The GOAP goal: the desired partial world state. */
  readonly desired: WorldState;
  /** Static utility contribution (higher = more desirable). */
  readonly baseUtility: number;
  /**
   * Optional dynamic utility term. Pure function of the current world state — must be
   * deterministic. Default: 0. Combined as `baseUtility + utility(state, this)`.
   */
  readonly utility?: (state: WorldState, def: GoalDef) => number;
  /**
   * Static priority tie-break. When two goals have EQUAL effective utility, the one with the
   * higher `priority` wins. Default 0.
   */
  readonly priority?: number;
  /** Goal ids to activate (spawn) when this goal is reached. Applied in array order. */
  readonly spawnOnComplete?: readonly string[];
  /**
   * If true, the goal stays ACTIVE after being reached (it is re-selected once it stops being
   * satisfied). Default false — non-persistent goals are deactivated on completion.
   */
  readonly persistent?: boolean;
  /** Override the "is this goal satisfied?" test. Default: GOAP `meetsGoal(state, desired)`. */
  readonly completeWhen?: (state: WorldState) => boolean;
}

/** Per-goal computed status, as returned by {@link GoalSystem.rank}. */
export interface GoalStatus {
  readonly id: string;
  readonly utility: number;
  readonly satisfied: boolean;
  readonly active: boolean;
}

/** Serializable dump of a goal system (save/load + deterministic equality). */
export interface GoalSystemSnapshot {
  readonly active: readonly string[];
  readonly order: readonly string[];
  readonly goalIds: readonly string[];
}

/** Effective utility of a goal in a given state (pure). */
export function goalUtility(def: GoalDef, state: WorldState): number {
  const dyn = def.utility ? def.utility(state, def) : 0;
  return def.baseUtility + dyn;
}

/**
 * Holds the active goal pool and selects the best goal to pursue, chaining new goals on
 * completion. Built directly on the existing GOAP planner via `plan`.
 */
export class GoalSystem {
  private readonly defs: Map<string, GoalDef> = new Map();
  /** Original declaration order — the stable primary tie-break after utility/priority. */
  private readonly order: string[] = [];
  /** Currently active goal ids, in activation order. */
  private active: string[] = [];

  constructor(goals: readonly GoalDef[], active?: readonly string[]) {
    for (const g of goals) {
      if (this.defs.has(g.id)) throw new Error(`GoalSystem: duplicate goal id '${g.id}'`);
      this.defs.set(g.id, g);
      this.order.push(g.id);
    }
    const init = active ?? goals.map((g) => g.id);
    for (const id of init) {
      if (!this.defs.has(id)) throw new Error(`GoalSystem: unknown active goal id '${id}'`);
      if (!this.active.includes(id)) this.active.push(id);
    }
  }

  /** The declared goal ids in declaration order. */
  get goalIds(): readonly string[] {
    return this.order;
  }

  /** Currently active goal ids (the persistent goal pool). */
  get activeGoals(): readonly string[] {
    return this.active;
  }

  /** Look up a goal definition. */
  def(id: string): GoalDef | undefined {
    return this.defs.get(id);
  }

  /** Is `goalId` currently active? */
  isActive(goalId: string): boolean {
    return this.active.includes(goalId);
  }

  /** Manually activate a goal (no-op if already active / unknown). */
  activate(goalId: string): void {
    if (this.defs.has(goalId) && !this.active.includes(goalId)) this.active.push(goalId);
  }

  /** Manually deactivate a goal. */
  deactivate(goalId: string): void {
    this.active = this.active.filter((x) => x !== goalId);
  }

  /** Is `goalId` currently satisfied by `state`? */
  isSatisfied(state: WorldState, goalId: string): boolean {
    const g = this.defs.get(goalId);
    if (!g) return false;
    return g.completeWhen ? g.completeWhen(state) : meetsGoal(state, g.desired);
  }

  /**
   * Rank every ACTIVE goal by the deterministic key (-utility, -priority, +declarationIndex,
   * +id). Returned best-first. Inactive goals are excluded.
   */
  rank(state: WorldState): GoalStatus[] {
    const out: GoalStatus[] = [];
    for (const id of this.active) {
      const g = this.defs.get(id)!;
      out.push({
        id,
        utility: goalUtility(g, state),
        satisfied: this.isSatisfied(state, id),
        active: true,
      });
    }
    out.sort((a, b) => {
      if (b.utility !== a.utility) return b.utility - a.utility;
      const pa = this.defs.get(a.id)!.priority ?? 0;
      const pb = this.defs.get(b.id)!.priority ?? 0;
      if (pb !== pa) return pb - pa;
      const ia = this.order.indexOf(a.id);
      const ib = this.order.indexOf(b.id);
      if (ia !== ib) return ia - ib;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
    return out;
  }

  /**
   * Select the best goal to pursue: the highest-ranked ACTIVE goal that is NOT yet satisfied.
   * Returns null when no active goal needs work (everything desired is already true).
   */
  select(state: WorldState): GoalDef | null {
    const ranked = this.rank(state);
    for (const s of ranked) {
      if (!s.satisfied) return this.defs.get(s.id)!;
    }
    return null;
  }

  /**
   * Plan toward the currently selected goal using the existing GOAP planner. Returns the plan
   * (possibly empty if already at the goal) or null if no goal is active/needed or the goal is
   * unreachable from `state`.
   */
  plan(state: WorldState, actions: readonly Action[], options: { maxExpansions?: number } = {}): Plan | null {
    const g = this.select(state);
    if (!g) return null;
    return plan(state, actions, g.desired, options);
  }

  /**
   * Mark `goalId` as reached: deactivate it (unless persistent) and activate its spawned
   * children in array order. Idempotent for already-inactive goals. Returns the list of
   * child goal ids that were (re)activated.
   */
  complete(goalId: string): string[] {
    const g = this.defs.get(goalId);
    if (!g || !this.active.includes(goalId)) return [];
    const spawned: string[] = [];
    if (!g.persistent) this.deactivate(goalId);
    if (g.spawnOnComplete) {
      for (const child of g.spawnOnComplete) {
        if (this.defs.has(child) && !this.active.includes(child)) {
          this.active.push(child);
          spawned.push(child);
        }
      }
    }
    return spawned;
  }

  /**
   * Complete every currently-active goal that is already satisfied by `state`. Spawns children
   * in a deterministic order (ranked, so equal-utility satisfied goals complete by the same
   * stable key). Returns the ids that were completed.
   */
  autoComplete(state: WorldState): string[] {
    const completed: string[] = [];
    for (const s of this.rank(state)) {
      if (s.satisfied) {
        const wasActive = this.active.includes(s.id);
        this.complete(s.id);
        if (wasActive) completed.push(s.id);
      }
    }
    return completed;
  }

  /** Serialize the active set + declaration order (for checkpoint / restore). */
  serialize(): GoalSystemSnapshot {
    return {
      active: [...this.active],
      order: [...this.order],
      goalIds: [...this.defs.keys()],
    };
  }

  /** Restore active set from a {@link serialize} blob. Declaration order must match. */
  static fromSnapshot(s: GoalSystemSnapshot): GoalSystem {
    const sys = new GoalSystem([]);
    for (const id of s.goalIds) {
      // Defs are not serializable; caller must rebuild with the same defs and restore active.
      (sys as unknown as { defs: Map<string, GoalDef> }).defs.set(id, { id, desired: {}, baseUtility: 0 } as GoalDef);
    }
    (sys as unknown as { order: string[] }).order = [...s.order];
    (sys as unknown as { active: string[] }).active = [...s.active];
    return sys;
  }
}
