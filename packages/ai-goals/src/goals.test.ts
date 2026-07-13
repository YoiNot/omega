import { describe, it, expect } from 'vitest';
import { GoalSystem, goalUtility, type GoalDef } from './index.js';
import { plan, type Action } from '@omega/ai-goap';

const actions: Action[] = [
  { name: 'getAxe', preconditions: { hasAxe: 0 }, effects: { hasAxe: 1 }, cost: 2 },
  { name: 'chop', preconditions: { hasAxe: 1 }, effects: { hasWood: 1 }, cost: 1 },
  { name: 'rest', preconditions: {}, effects: { rested: 1 }, cost: 1 },
  { name: 'eat', preconditions: {}, effects: { fed: 1 }, cost: 1 },
];

const goals: GoalDef[] = [
  { id: 'survive', desired: { fed: 1 }, baseUtility: 100, priority: 1 },
  { id: 'shelter', desired: { rested: 1 }, baseUtility: 50, priority: 1 },
  { id: 'wood', desired: { hasWood: 1 }, baseUtility: 40, spawnOnComplete: ['rest', 'eat'] },
  { id: 'rest', desired: { rested: 1 }, baseUtility: 30, priority: 0 },
  { id: 'eat', desired: { fed: 1 }, baseUtility: 30, priority: 0 },
];

describe('goalUtility', () => {
  it('combines base + dynamic term', () => {
    const g: GoalDef = { id: 'g', desired: {}, baseUtility: 10, utility: () => 5 };
    expect(goalUtility(g, {})).toBe(15);
  });
  it('dynamic term defaults to 0', () => {
    const g: GoalDef = { id: 'g', desired: {}, baseUtility: 7 };
    expect(goalUtility(g, {})).toBe(7);
  });
});

describe('GoalSystem — deterministic selection', () => {
  it('selects the highest-utility unsatisfied goal', () => {
    const sys = new GoalSystem(goals);
    const sel = sys.select({ fed: 0, rested: 0, hasWood: 0 });
    expect(sel?.id).toBe('survive');
  });

  it('is stable across many runs with identical inputs', () => {
    const sys = new GoalSystem(goals);
    const ref = sys.select({ fed: 0, rested: 0, hasWood: 0 })!.id;
    for (let i = 0; i < 40; i++) {
      const s = new GoalSystem(goals);
      expect(s.select({ fed: 0, rested: 0, hasWood: 0 })!.id).toBe(ref);
    }
  });

  it('skips already-satisfied goals and picks the next one', () => {
    const sys = new GoalSystem(goals);
    expect(sys.select({ fed: 1, rested: 0, hasWood: 0 })!.id).toBe('shelter');
  });

  it('returns null when every active goal is already satisfied', () => {
    const sys = new GoalSystem(goals);
    expect(sys.select({ fed: 1, rested: 1, hasWood: 1 })).toBeNull();
  });

  it('tie-break by priority when utilities equal, then declaration order', () => {
    // Two goals with identical utility; 'first' was declared before 'second', and has higher
    // priority. Determinism: 'first' must always win the tie.
    const tied: GoalDef[] = [
      { id: 'second', desired: { b: 1 }, baseUtility: 10, priority: 0 },
      { id: 'first', desired: { a: 1 }, baseUtility: 10, priority: 1 },
      { id: 'third', desired: { c: 1 }, baseUtility: 10, priority: 0 },
    ];
    const sys = new GoalSystem(tied);
    const ranked = sys.rank({ a: 0, b: 0, c: 0 }).map((r) => r.id);
    expect(ranked[0]).toBe('first'); // higher priority
    // 'second' and 'third' have equal utility+priority -> declaration-order tie-break (second < third)
    expect(ranked).toEqual(['first', 'second', 'third']);
  });

  it('reordering declarations is reflected by declaration-order tie-break', () => {
    // If both have equal utility and equal priority, the earlier-declared one should win.
    const tied: GoalDef[] = [
      { id: 'alpha', desired: { a: 1 }, baseUtility: 10 },
      { id: 'beta', desired: { b: 1 }, baseUtility: 10 },
    ];
    const sys = new GoalSystem(tied);
    expect(sys.rank({ a: 0, b: 0 })[0].id).toBe('alpha');
    const sysRev = new GoalSystem([tied[1], tied[0]]);
    expect(sysRev.rank({ a: 0, b: 0 })[0].id).toBe('beta');
  });
});

describe('GoalSystem — planning on top of GOAP', () => {
  it('plans toward the selected goal using the existing planner', () => {
    const sys = new GoalSystem(goals);
    const p = sys.plan({ fed: 0, rested: 0, hasWood: 0 }, actions);
    expect(p).not.toBeNull();
    expect(p![0].name).toBe('eat'); // cheapest way to satisfy 'survive'
  });

  it('plans toward the wood goal and the resulting plan reaches it', () => {
    const sys = new GoalSystem(goals, ['wood']);
    const p = sys.plan({ hasAxe: 0, hasWood: 0 }, actions);
    expect(p!.map((a) => a.name)).toEqual(['getAxe', 'chop']);
  });
});

describe('GoalSystem — spawning on completion', () => {
  it('completing a goal activates its spawned children', () => {
    const sys = new GoalSystem(goals); // all active initially
    sys.deactivate('rest');
    sys.deactivate('eat');
    const spawned = sys.complete('wood');
    expect(spawned).toEqual(['rest', 'eat']);
    expect(sys.isActive('rest')).toBe(true);
    expect(sys.isActive('eat')).toBe(true);
    expect(sys.isActive('wood')).toBe(false); // non-persistent -> deactivated
  });

  it('autoComplete chains deterministically: reach wood -> spawn rest+eat', () => {
    const sys = new GoalSystem(goals);
    // satisfy 'wood' only; survive+shelter still active and unsatisfied.
    const spawned = sys.autoComplete({ fed: 0, rested: 0, hasWood: 1 });
    expect(spawned).toContain('wood');
    expect(sys.isActive('rest')).toBe(true);
    expect(sys.isActive('eat')).toBe(true);
  });

  it('persistent goals stay active after completion', () => {
    const g: GoalDef[] = [
      { id: 'always', desired: { ok: 1 }, baseUtility: 5, persistent: true },
      { id: 'once', desired: { done: 1 }, baseUtility: 5, spawnOnComplete: [] },
    ];
    const sys = new GoalSystem(g);
    sys.complete('always');
    expect(sys.isActive('always')).toBe(true);
  });
});

describe('GoalSystem — serialize / restore', () => {
  it('restores active set and order', () => {
    const sys = new GoalSystem(goals);
    sys.deactivate('survive');
    sys.activate('rest');
    const snap = sys.serialize();
    // Rebuild defs map via the same declaration, then restore active.
    const restored = GoalSystem.fromSnapshot(snap);
    expect(restored.activeGoals).toEqual(sys.activeGoals);
    expect(restored.goalIds).toEqual(sys.goalIds);
  });
});

describe('integration: plan is identical to a direct GOAP plan', () => {
  it('GoalSystem.plan matches standalone plan() for the selected goal', () => {
    const sys = new GoalSystem(goals, ['wood']);
    const viaSystem = sys.plan({ hasAxe: 0, hasWood: 0 }, actions);
    const viaDirect = plan({ hasAxe: 0, hasWood: 0 }, actions, { hasWood: 1 });
    expect(viaSystem?.map((a) => a.name)).toEqual(viaDirect?.map((a) => a.name));
  });
});
