import { describe, it, expect } from 'vitest';
import { GoapPlanner, WorldState, GoapAction } from './goap.js';

describe('second-half', () => {
  it('returns null for an unreachable goal', () => {
    const planner = new GoapPlanner();
    const limited: GoapAction[] = [
      { name: 'walkToTree', cost: 1, preconditions: { hasAxe: 0 }, effects: { atTree: 1 } },
      { name: 'chopTree', cost: 2, preconditions: { hasAxe: 1, atTree: 1 }, effects: { hasWood: 1 } },
    ];
    const plan = planner.plan({ hasAxe: 0, atTree: 0, hasWood: 0 }, { hasAxe: 1 }, limited);
    expect(plan).toBeNull();
  });

  it('is deterministic across repeated calls', () => {
    const actions: GoapAction[] = [
      { name: 'walkToTree', cost: 1, preconditions: { hasAxe: 0 }, effects: { atTree: 1 } },
      { name: 'chopTree', cost: 2, preconditions: { hasAxe: 1, atTree: 1 }, effects: { hasWood: 1 } },
      { name: 'pickUpAxe', cost: 1, preconditions: { atTree: 1 }, effects: { hasAxe: 1 } },
    ];
    const planner = new GoapPlanner();
    const start: WorldState = { hasAxe: 0, atTree: 0, hasWood: 0 };
    const goal: WorldState = { hasWood: 1 };
    const get = () => planner.plan(start, goal, actions)!.map((x) => x.name);
    expect(get()).toEqual(get());
  });
});
