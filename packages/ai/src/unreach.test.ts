import { describe, it, expect } from 'vitest';
import { GoapPlanner, GoapAction } from './goap.js';

describe('unreachable-only', () => {
  it('returns null for unreachable', () => {
    const planner = new GoapPlanner();
    const limited: GoapAction[] = [
      { name: 'walkToTree', cost: 1, preconditions: { hasAxe: 0 }, effects: { atTree: 1 } },
      { name: 'chopTree', cost: 2, preconditions: { hasAxe: 1, atTree: 1 }, effects: { hasWood: 1 } },
    ];
    const plan = planner.plan({ hasAxe: 0, atTree: 0, hasWood: 0 }, { hasAxe: 1 }, limited);
    expect(plan).toBeNull();
  });
});
