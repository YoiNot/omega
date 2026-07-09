import { describe, it, expect } from 'vitest';
import { GoapPlanner, WorldState, GoapAction } from './goap.js';

const actions: GoapAction[] = [
  { name: 'walkToTree', cost: 1, preconditions: { hasAxe: 0 }, effects: { atTree: 1 } },
  { name: 'chopTree', cost: 2, preconditions: { hasAxe: 1, atTree: 1 }, effects: { hasWood: 1 } },
  { name: 'pickUpAxe', cost: 1, preconditions: { atTree: 1 }, effects: { hasAxe: 1 } },
];

describe('first', () => {
  it('ordered sequence', () => {
    const planner = new GoapPlanner();
    const start: WorldState = { hasAxe: 0, atTree: 0, hasWood: 0 };
    const goal: WorldState = { hasWood: 1 };
    const plan = planner.plan(start, goal, actions);
    expect(plan).not.toBeNull();
    expect((plan as GoapAction[]).map((a) => a.name)).toEqual(['walkToTree', 'pickUpAxe', 'chopTree']);
  });
});
