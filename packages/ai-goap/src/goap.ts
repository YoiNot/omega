/**
 * @omega/ai-goap — deterministic Goal-Oriented Action Planning.
 *
 * A GOAP planner turns a WORLD STATE plus a GOAL into an ordered ACTION PLAN. The search
 * is a forward state-space A* over the reachable state graph: every {@link Action} declares
 * `preconditions` (a partial WorldState that must hold to be applicable) and `effects` (how
 * the world changes when it is applied), together with a positive `cost`. Given a start
 * state and a goal, {@link plan} returns the minimum-cost action sequence reaching the goal,
 * or `null` when the goal is unreachable.
 *
 * DETERMINISM CONTRACT (ADR 0001): the core is a PURE function of its inputs. No
 * `Math.random`, no `Date.now()`. State keys are sorted when serialized so equality is
 * order-independent, and the priority queue orders strictly by (f, then g, then the index
 * of the action that produced the node, then insertion order). Identical `state + actions +
 * goal` therefore always yield an identical `Plan` — including which of several equal-cost
 * plans is chosen. The chosen tie-break rule: prefer the plan whose earliest differing
 * action appears earlier in the caller-supplied `actions` array.
 */

import { clamp } from '@omega/engine-math';

/**
 * A world state: a flat map of named features. Boolean features are accepted for ergonomic
 * flags (`{ hasAxe: true }`) and canonicalized to 0/1 internally, so a numeric `1` and a
 * boolean `true` compare equal. Absent keys read as 0 / false.
 */
export type FeatureValue = number | boolean;
export type WorldState = Record<string, FeatureValue>;

/** Effects applied when an action fires: an ABSOLUTE assignment of the listed features. */
export type Effects = WorldState;

/** A single planning action. */
export interface Action {
  /** Stable, human-readable identifier (used in the returned plan). */
  readonly name: string;
  /** Partial state that must hold for the action to be applicable. */
  readonly preconditions: WorldState;
  /** Absolute feature assignments produced by applying the action. */
  readonly effects: Effects;
  /** Strictly positive cost; the planner minimizes total plan cost. */
  readonly cost: number;
}

/** A goal is the desired (partial) world state. */
export type Goal = WorldState;

/** A plan is the ordered sequence of actions from start to goal (possibly empty). */
export type Plan = Action[];

/** Canonicalize a feature value to a number (false→0, true→1). */
export function toNumber(v: FeatureValue | undefined): number {
  if (v === undefined) return 0;
  return typeof v === 'boolean' ? (v ? 1 : 0) : v;
}

/** Read a feature from a state as a number, treating absent keys as 0. */
export function getFeature(state: WorldState, key: string): number {
  return toNumber(state[key]);
}

/** Shallow clone of a world state (flat record). */
export function cloneState(state: WorldState): WorldState {
  const out: WorldState = {};
  for (const k in state) out[k] = state[k];
  return out;
}

/**
 * Stable, order-independent serialization of a world state: keys sorted lexicographically,
 * every value canonicalized to a number so `{a:true}` and `{a:1}` hash identically.
 */
export function serializeState(state: WorldState): string {
  const keys = Object.keys(state).sort();
  let out = '';
  for (const k of keys) out += `${k}=${toNumber(state[k])};`;
  return out;
}

/** True when every entry of `partial` matches `state` (absent keys read as 0). */
export function satisfies(state: WorldState, partial: WorldState): boolean {
  for (const k in partial) {
    if (getFeature(state, k) !== toNumber(partial[k])) return false;
  }
  return true;
}

/** True when `state` satisfies the goal. */
export function meetsGoal(state: WorldState, goal: Goal): boolean {
  return satisfies(state, goal);
}

/** Apply an action's absolute effects to a copy of `state`. */
export function applyEffects(state: WorldState, action: Action): WorldState {
  const next = cloneState(state);
  const eff = action.effects;
  for (const k in eff) next[k] = toNumber(eff[k]);
  return next;
}

/**
 * Admissible heuristic: the number of goal features not yet satisfied. Each unsatisfied
 * feature needs at least one action to change it, and every action costs > 0, so this never
 * over-estimates the remaining cost when the cheapest action costs >= 1. It is scaled by the
 * cheapest action cost to stay admissible for sub-unit costs.
 */
export function heuristic(state: WorldState, goal: Goal, minCost: number): number {
  let unmet = 0;
  for (const k in goal) {
    if (getFeature(state, k) !== toNumber(goal[k])) unmet++;
  }
  return unmet * minCost;
}

/** A* search node. Parent-linked for O(1)-per-expansion path reconstruction. */
interface SearchNode {
  readonly idx: number;
  readonly state: WorldState;
  readonly g: number;
  readonly f: number;
  readonly parent: number;
  readonly action: Action | null;
  /** Index of the producing action in the caller's `actions` array (-1 for start). */
  readonly actionOrder: number;
  /** Global insertion order — final tie-breaker for total determinism. */
  readonly seq: number;
}

/**
 * Binary min-heap keyed on (f, g, actionOrder, seq). Lower f wins; ties broken by lower g
 * (cheaper path so far), then by the earlier action in the caller's array, then by earlier
 * insertion. This makes both WHICH plan is returned and the order of exploration fully
 * deterministic across runs and platforms.
 */
class PriorityQueue {
  private readonly heap: SearchNode[] = [];

  get size(): number {
    return this.heap.length;
  }

  push(node: SearchNode): void {
    const heap = this.heap;
    heap.push(node);
    let i = heap.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (less(heap[i], heap[parent])) {
        [heap[i], heap[parent]] = [heap[parent], heap[i]];
        i = parent;
      } else break;
    }
  }

  pop(): SearchNode | undefined {
    const heap = this.heap;
    if (heap.length === 0) return undefined;
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length > 0) {
      heap[0] = last;
      let i = 0;
      const n = heap.length;
      for (;;) {
        const l = 2 * i + 1;
        const r = 2 * i + 2;
        let smallest = i;
        if (l < n && less(heap[l], heap[smallest])) smallest = l;
        if (r < n && less(heap[r], heap[smallest])) smallest = r;
        if (smallest === i) break;
        [heap[i], heap[smallest]] = [heap[smallest], heap[i]];
        i = smallest;
      }
    }
    return top;
  }
}

/** Deterministic total order over search nodes. */
function less(a: SearchNode, b: SearchNode): boolean {
  if (a.f !== b.f) return a.f < b.f;
  if (a.g !== b.g) return a.g < b.g;
  if (a.actionOrder !== b.actionOrder) return a.actionOrder < b.actionOrder;
  return a.seq < b.seq;
}

/** Options controlling the planner's safety bounds. */
export interface PlanOptions {
  /** Hard cap on node expansions before giving up (returns null). Default 1_000_000. */
  readonly maxExpansions?: number;
}

/**
 * Plan a minimum-cost action sequence from `state` to `goal`.
 *
 * @returns the ordered {@link Plan} (empty if `state` already meets `goal`), or `null` if
 *          the goal is unreachable (or the expansion cap is hit — the search never loops).
 *
 * The function is pure and deterministic: identical arguments always produce an identical
 * result, including the specific plan chosen among equal-cost alternatives.
 */
export function plan(
  state: WorldState,
  actions: readonly Action[],
  goal: Goal,
  options: PlanOptions = {},
): Plan | null {
  if (meetsGoal(state, goal)) return [];

  // Cheapest positive action cost — keeps the heuristic admissible for sub-unit costs.
  let minCost = Infinity;
  for (const a of actions) {
    if (a.cost > 0 && a.cost < minCost) minCost = a.cost;
  }
  if (!Number.isFinite(minCost)) minCost = 1;

  const maxExpansions = clamp(options.maxExpansions ?? 1_000_000, 1, Number.MAX_SAFE_INTEGER);

  const open = new PriorityQueue();
  const nodes: SearchNode[] = [];
  let seq = 0;

  const startNode: SearchNode = {
    idx: 0,
    state: cloneState(state),
    g: 0,
    f: heuristic(state, goal, minCost),
    parent: -1,
    action: null,
    actionOrder: -1,
    seq: seq++,
  };
  nodes.push(startNode);
  open.push(startNode);

  const best = new Map<string, number>();
  best.set(serializeState(state), 0);

  let expansions = 0;

  while (open.size > 0) {
    const current = open.pop()!;
    const currentKey = serializeState(current.state);

    // Skip stale queue entries superseded by a cheaper path to the same state.
    const known = best.get(currentKey);
    if (known !== undefined && known < current.g) continue;

    // Goal test on POP (not on generation): with an admissible heuristic the first goal
    // node dequeued is provably minimum-cost. Testing at generation time would return the
    // first goal-reaching action found during expansion, which need not be the cheapest.
    if (meetsGoal(current.state, goal)) {
      const path: Plan = [];
      let n: SearchNode = current;
      while (n.parent !== -1) {
        path.push(n.action!);
        n = nodes[n.parent];
      }
      path.reverse();
      return path;
    }

    if (++expansions > maxExpansions) break;

    for (let ai = 0; ai < actions.length; ai++) {
      const action = actions[ai];
      if (action.cost <= 0) continue; // non-positive costs would let the search loop
      if (!satisfies(current.state, action.preconditions)) continue;

      const nextState = applyEffects(current.state, action);
      const nextG = current.g + action.cost;
      const nextKey = serializeState(nextState);
      const prevG = best.get(nextKey);
      if (prevG !== undefined && prevG <= nextG) continue;

      best.set(nextKey, nextG);
      const child: SearchNode = {
        idx: nodes.length,
        state: nextState,
        g: nextG,
        f: nextG + heuristic(nextState, goal, minCost),
        parent: current.idx,
        action,
        actionOrder: ai,
        seq: seq++,
      };
      nodes.push(child);
      open.push(child);
    }
  }

  return null;
}

/** Total cost of a plan (sum of action costs). */
export function planCost(p: Plan): number {
  let sum = 0;
  for (const a of p) sum += a.cost;
  return sum;
}
