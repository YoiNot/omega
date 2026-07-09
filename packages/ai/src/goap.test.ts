import { describe, it, expect } from 'vitest';
import { GoapPlanner, WorldState, GoapAction, cloneState, heuristic } from './goap.js';

// Classic GOAP puzzle: need wood, but chopping needs an axe, and getting the axe
// requires walking to the tree first. Order matters.
const actions: GoapAction[] = [
  {
    name: 'walkToTree',
    cost: 1,
    preconditions: { hasAxe: 0 },
    effects: { atTree: 1 },
  },
  {
    name: 'chopTree',
    cost: 2,
    preconditions: { hasAxe: 1, atTree: 1 },
    effects: { hasWood: 1 },
  },
  {
    name: 'pickUpAxe',
    cost: 1,
    preconditions: { atTree: 1 },
    effects: { hasAxe: 1 },
  },
];

describe('GoapPlanner', () => {
  it('returns the correctly ordered sequence for a reachable goal', () => {
    const planner = new GoapPlanner();
    const start: WorldState = { hasAxe: 0, atTree: 0, hasWood: 0 };
    const goal: WorldState = { hasWood: 1 };
    const plan = planner.plan(start, goal, actions);
    expect(plan).not.toBeNull();
    const names = (plan as GoapAction[]).map((a) => a.name);
    expect(names).toEqual(['walkToTree', 'pickUpAxe', 'chopTree']);
  });

  it('returns an empty plan when start already meets the goal', () => {
    const planner = new GoapPlanner();
    const start: WorldState = { hasWood: 1 };
    const plan = planner.plan(start, { hasWood: 1 }, actions);
    expect(plan).toEqual([]);
  });

  it('returns null for an unreachable goal', () => {
    const planner = new GoapPlanner();
    // Goal requires hasAxe:1 but no action can ever produce hasAxe (remove pickUpAxe).
    const limited = actions.filter((a) => a.name !== 'pickUpAxe');
    const plan = planner.plan({ hasAxe: 0, atTree: 0, hasWood: 0 }, { hasAxe: 1 }, limited);
    expect(plan).toBeNull();
  });

  it('is deterministic across repeated calls with identical inputs', () => {
    const planner = new GoapPlanner();
    const start: WorldState = { hasAxe: 0, atTree: 0, hasWood: 0 };
    const goal: WorldState = { hasWood: 1 };
    const a = planner.plan(start, goal, actions)!.map((x) => x.name);
    const b = planner.plan(start, goal, actions)!.map((x) => x.name);
    const c = planner.plan(start, goal, actions)!.map((x) => x.name);
    expect(a).toEqual(b);
    expect(b).toEqual(c);
  });

  it('prefers the cheaper of two valid paths', () => {
    // Two routes to hasWood: cheap (1+2) and expensive (5+2). Planner should pick cheap.
    const cheap: GoapAction[] = [
      { name: 'cheapAxe', cost: 1, preconditions: {}, effects: { hasAxe: 1 } },
      { name: 'makeWood', cost: 2, preconditions: { hasAxe: 1 }, effects: { hasWood: 1 } },
      { name: 'expensiveAxe', cost: 5, preconditions: {}, effects: { hasAxe: 1 } },
    ];
    const planner = new GoapPlanner();
    const plan = planner.plan({ hasAxe: 0, hasWood: 0 }, { hasWood: 1 }, cheap)!;
    expect(plan.map((a) => a.name)).toEqual(['cheapAxe', 'makeWood']);
  });

  it('supports function-form effects', () => {
    const planner = new GoapPlanner();
    const fnActions: GoapAction[] = [
      { name: 'inc', cost: 1, preconditions: {}, effects: (s) => { s.count = (s.count ?? 0) + 1; } },
    ];
    const plan = planner.plan({ count: 0 }, { count: 1 }, fnActions)!;
    expect(plan.map((a) => a.name)).toEqual(['inc']);
  });

  it('heuristic sums absolute distance to goal', () => {
    expect(heuristic({ a: 0, b: 5 }, { a: 3, b: 5 })).toBe(3);
    expect(heuristic({ a: 2 }, { a: 0 })).toBe(2);
  });

  it('does not mutate the input start state', () => {
    const planner = new GoapPlanner();
    const start: WorldState = { hasAxe: 0, atTree: 0, hasWood: 0 };
    const snapshot = cloneState(start);
    planner.plan(start, { hasWood: 1 }, actions);
    expect(start).toEqual(snapshot);
  });
});
