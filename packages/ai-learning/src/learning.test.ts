import { describe, it, expect } from 'vitest';
import { PracticeLog } from './index.js';
import { plan, type Action } from '@omega/ai-goap';

const actions: Action[] = [
  { name: 'getAxe', preconditions: { hasAxe: 0 }, effects: { hasAxe: 1 }, cost: 5 },
  { name: 'chop', preconditions: { hasAxe: 1 }, effects: { hasWood: 1 }, cost: 5 },
  { name: 'buy', preconditions: {}, effects: { hasWood: 1 }, cost: 8 },
];

describe('PracticeLog — determinism (same experience => same factors)', () => {
  it('same practice sequence yields identical counts and factors (many runs)', () => {
    const build = () => {
      const log = new PracticeLog(0.5, 0.5);
      log.practice('chop', 3);
      log.practice('getAxe', 1);
      log.practice('chop', 2);
      return log;
    };
    const ref = build().serialize();
    for (let i = 0; i < 30; i++) expect(build().serialize()).toEqual(ref);
  });

  it('serialize/restore is byte-identical', () => {
    const log = new PracticeLog(0.3, 0.4);
    log.practice('a', 4);
    const r = PracticeLog.fromSnapshot(log.serialize());
    expect(r.serialize()).toEqual(log.serialize());
  });
});

describe('proficiency & cost curve', () => {
  it('proficiency is 0 at n=0 and rises toward 1', () => {
    const log = new PracticeLog(0.5, 0.5);
    expect(log.proficiency('x')).toBeCloseTo(0, 12);
    log.practice('x');
    expect(log.proficiency('x')).toBeCloseTo(0.5, 12); // 1 - (1-0.5)^1
    log.practice('x');
    expect(log.proficiency('x')).toBeCloseTo(0.75, 12); // 1 - (1-0.5)^2
  });

  it('cost factor is 1 at n=0 and approaches minFactor', () => {
    const log = new PracticeLog(0.5, 0.5);
    expect(log.costFactorFor('x')).toBeCloseTo(1, 12);
    log.practice('x');
    expect(log.costFactorFor('x')).toBeCloseTo(0.75, 12); // 1 - 0.5*(1-0.5)
    for (let i = 0; i < 20; i++) log.practice('x');
    expect(log.costFactorFor('x')).toBeCloseTo(0.5, 6); // saturates near minFactor
  });

  it('higher decay -> faster proficiency gain', () => {
    const fast = new PracticeLog(0.9, 0.5);
    const slow = new PracticeLog(0.1, 0.5);
    fast.practice('x');
    slow.practice('x');
    expect(fast.proficiency('x')).toBeGreaterThan(slow.proficiency('x'));
  });

  it('unknown action has count 0 and factor 1', () => {
    const log = new PracticeLog();
    expect(log.count('nope')).toBe(0);
    expect(log.costFactorFor('nope')).toBe(1);
  });

  it('amount accumulates deterministically', () => {
    const a = new PracticeLog();
    a.practice('x', 2);
    a.practice('x', 3);
    const b = new PracticeLog();
    b.practice('x', 5);
    expect(a.count('x')).toBe(b.count('x'));
    expect(a.costFactorFor('x')).toBe(b.costFactorFor('x'));
  });
});

describe('adjustedAction integrates with the GOAP planner', () => {
  it('practising one action makes the planner prefer it', () => {
    // Base: buy (8) is cheaper than getAxe+chop (10). So baseline planner buys wood.
    const basePlan = plan({ hasAxe: 0, hasWood: 0 }, actions, { hasWood: 1 });
    expect(basePlan!.map((a) => a.name)).toEqual(['buy']);

    // Practise getAxe+chop a lot -> they become cheaper than buy -> planner switches.
    const log = new PracticeLog(0.5, 0.2);
    log.practicePlan(actions.slice(0, 2), 20); // practise getAxe & chop 20x each
    const adjusted = log.adjustActions(actions);
    const learnedPlan = plan({ hasAxe: 0, hasWood: 0 }, adjusted, { hasWood: 1 });
    expect(learnedPlan!.map((a) => a.name)).toEqual(['getAxe', 'chop']);
  });

  it('adjustedAction never mutates the base action', () => {
    const log = new PracticeLog();
    log.practice('chop', 5);
    log.adjustedAction(actions[1]);
    expect(actions[1].cost).toBe(5);
  });

  it('cost is always positive (floored)', () => {
    const log = new PracticeLog(0.5, 1e-6);
    log.practice('x', 100);
    const adj = log.adjustedAction({ name: 'x', preconditions: {}, effects: {}, cost: 1 });
    expect(adj.cost).toBeGreaterThan(0);
  });
});

describe('practicePlan', () => {
  it('practises every action in the plan once each', () => {
    const log = new PracticeLog();
    const p = plan({ hasAxe: 0, hasWood: 0 }, actions, { hasWood: 1 })!;
    log.practicePlan(p);
    expect(log.count('buy')).toBe(1);
    expect(p.length).toBe(1);
  });
});
