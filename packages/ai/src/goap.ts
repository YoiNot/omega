/**
 * @omega/ai — Goal-Oriented Action Planning (GOAP).
 *
 * Forward state-space search (A*) over a finite world-state space. Each `GoapAction`
 * declares `preconditions` (a WorldState that must hold for the action to be applicable)
 * and `effects` (how the world state changes when the action is applied). Given a start
 * state and a goal state, `GoapPlanner.plan` returns the ordered action sequence that
 * reaches the goal at minimum cost, or `null` if the goal is unreachable.
 *
 * Determinism: no Math.random / Date.now(). The search is a pure function of its inputs,
 * the priority queue orders nodes deterministically (f, then g, then insertion order), and
 * state equality is order-independent (keys are sorted when serializing). Identical inputs
 * always yield identical output.
 */

import { clamp } from '@omega/engine-math';

/** A world state is a flat record of named numeric features (e.g. { hasAxe: 1 }). */
export type WorldState = Record<string, number>;

/** Effects may be a delta record (added to each feature) or a mutating function. */
export type GoapEffects = WorldState | ((s: WorldState) => void);

export interface GoapAction {
  name: string;
  /** Positive action cost; lower is preferred by the planner. */
  cost: number;
  /** Required state for the action to be applicable. */
  preconditions: WorldState;
  /** Resulting state change when the action is applied. */
  effects: GoapEffects;
}

/**
 * Read a feature from a WorldState, treating an absent key as 0. This keeps boolean-style
 * flags ({ hasAxe: 1 }) safe to query before they have ever been written.
 */
export function getFeature(s: WorldState, key: string): number {
  const v = s[key];
  return v === undefined ? 0 : v;
}

/** Deep-ish clone of a WorldState (flat record of numbers). */
export function cloneState(s: WorldState): WorldState {
  const out: WorldState = {};
  for (const k in s) out[k] = s[k];
  return out;
}

/** Stable, order-independent serialization of a WorldState (sorted keys). */
export function serializeState(s: WorldState): string {
  const keys = Object.keys(s).sort();
  let out = '';
  for (const k of keys) out += `${k}=${s[k]};`;
  return out;
}

/**
 * A* search node. Held in the priority queue with a deterministic ordering key.
 */
interface SearchNode {
  idx: number; // index into the node list, used for path reconstruction
  state: WorldState;
  g: number; // accumulated cost
  parent: number; // index of the parent node, or -1 for the start node
  action: GoapAction | null; // action taken from parent to reach this node
  seq: number; // insertion order, used as a stable tie-breaker
}

/**
 * Binary min-heap keyed on (f, g, seq). Lower f wins; ties broken by lower g (cheaper
 * path so far), then by lower seq (earlier insertion) so the search is fully deterministic.
 */
class PriorityQueue {
  private heap: SearchNode[] = [];

  get size(): number {
    return this.heap.length;
  }

  push(node: SearchNode, goal: WorldState): void {
    const heap = this.heap;
    heap.push(node);
    let i = heap.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.less(heap[i], heap[parent], goal)) {
        [heap[i], heap[parent]] = [heap[parent], heap[i]];
        i = parent;
      } else break;
    }
  }

  pop(goal: WorldState): SearchNode | undefined {
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
        if (l < n && this.less(heap[l], heap[smallest], goal)) smallest = l;
        if (r < n && this.less(heap[r], heap[smallest], goal)) smallest = r;
        if (smallest === i) break;
        [heap[i], heap[smallest]] = [heap[smallest], heap[i]];
        i = smallest;
      }
    }
    return top;
  }

  private less(a: SearchNode, b: SearchNode, goal: WorldState): boolean {
    const fa = a.g + heuristic(a.state, goal);
    const fb = b.g + heuristic(b.state, goal);
    if (fa !== fb) return fa < fb;
    if (a.g !== b.g) return a.g < b.g;
    return a.seq < b.seq;
  }
}

/** Admissible heuristic: sum of absolute distances to each goal feature. */
export function heuristic(state: WorldState, goal: WorldState): number {
  let sum = 0;
  for (const k in goal) sum += Math.abs(getFeature(state, k) - goal[k]);
  return sum;
}

/** Whether the action's preconditions are satisfied by `state`. */
export function satisfies(state: WorldState, preconditions: WorldState): boolean {
  for (const k in preconditions) {
    if (getFeature(state, k) !== preconditions[k]) return false;
  }
  return true;
}

/** Whether `state` meets every entry in the goal. */
export function meetsGoal(state: WorldState, goal: WorldState): boolean {
  return satisfies(state, goal);
}

/** Apply an action's effects to a copy of `state` and return the result. */
export function applyEffects(state: WorldState, action: GoapAction): WorldState {
  const next = cloneState(state);
  const eff = action.effects;
  if (typeof eff === 'function') {
    eff(next);
  } else {
    for (const k in eff) next[k] = getFeature(next, k) + eff[k];
  }
  return next;
}

/**
 * Goal-Oriented Action Planner. Pure, deterministic, forward state-space A* search.
 */
export class GoapPlanner {
  /**
   * Plan a path of actions from `start` to `goal`.
   *
   * Returns the ordered action sequence (start -> goal) or `null` if unreachable.
   * If the start already meets the goal, returns an empty array.
   */
  plan(start: WorldState, goal: WorldState, actions: GoapAction[]): GoapAction[] | null {
    // Already at the goal: zero-step plan.
    if (meetsGoal(start, goal)) return [];

    const open = new PriorityQueue();
    // Persistent node list for O(1) predecessor-based path reconstruction. Storing only a
    // parent index + the action taken (instead of copying the whole path into every node)
    // keeps each expansion O(1) and makes the expansion cap below a *real* termination bound
    // even when the state space is unbounded (e.g. an action whose effect never moves the
    // search closer to the goal keeps spawning brand-new states forever).
    const nodes: SearchNode[] = [];
    let seq = 0;
    const startNode: SearchNode = {
      idx: nodes.length,
      state: cloneState(start),
      g: 0,
      parent: -1,
      action: null,
      seq: seq++,
    };
    nodes.push(startNode);
    open.push(startNode, goal);

    // Best known cost to reach a given state; skip re-expansion at higher/equal cost.
    const best = new Map<string, number>();
    best.set(serializeState(start), 0);

    let expansions = 0;
    const maxExpansions = 500_000; // safety bound against pathological blow-up

    while (open.size > 0) {
      const current = open.pop(goal)!;
      const currentKey = serializeState(current.state);

      // Skip stale queue entries (a better path was already expanded).
      const known = best.get(currentKey);
      if (known !== undefined && known < current.g) continue;

      if (++expansions > maxExpansions) break;

      for (const action of actions) {
        if (!satisfies(current.state, action.preconditions)) continue;
        if (action.cost <= 0) continue; // positive costs only, else search loops

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
          parent: current.idx,
          action,
          seq: seq++,
        };
        nodes.push(child);

        if (meetsGoal(nextState, goal)) {
          // Reconstruct the path by walking parent pointers back to the start node.
          const path: GoapAction[] = [];
          let n: SearchNode = child;
          while (n.parent !== -1) {
            path.push(n.action!);
            n = nodes[n.parent];
          }
          path.reverse();
          return path;
        }
        open.push(child, goal);
      }
    }

    return null;
  }
}

// Re-export clamp for downstream convenience (used by utility AI curves too).
export { clamp };
