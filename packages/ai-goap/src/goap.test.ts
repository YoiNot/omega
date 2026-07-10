import { describe, it, expect } from 'vitest';
import {
  plan,
  planCost,
  meetsGoal,
  satisfies,
  applyEffects,
  serializeState,
  getFeature,
  heuristic,
  type Action,
  type WorldState,
} from './index.js';

/**
 * Classic woodcutting GOAP scenario: to satisfy `{ hasWood: 1 }` the agent may either buy
 * wood outright (expensive) or get an axe then chop (cheaper in total). The planner must
 * pick the minimum-cost path.
 */
const woodActions: Action[] = [
  {
    name: 'getAxe',
    preconditions: { hasAxe: 0 },
    effects: { hasAxe: 1 },
    cost: 2,
  },
  {
    name: 'chopWood',
    preconditions: { hasAxe: 1 },
    effects: { hasWood: 1 },
    cost: 1,
  },
  {
    name: 'buyWood',
    preconditions: {},
    effects: { hasWood: 1 },
    cost: 10,
  },
];

describe('helpers', () => {
  it('getFeature treats absent keys as 0 and canonicalizes booleans', () => {
    expect(getFeature({}, 'x')).toBe(0);
    expect(getFeature({ x: true }, 'x')).toBe(1);
    expect(getFeature({ x: false }, 'x')).toBe(0);
    expect(getFeature({ x: 5 }, 'x')).toBe(5);
  });

  it('serializeState is order-independent and boolean/number equivalent', () => {
    expect(serializeState({ a: 1, b: 2 })).toBe(serializeState({ b: 2, a: 1 }));
    expect(serializeState({ a: true })).toBe(serializeState({ a: 1 }));
    expect(serializeState({ a: false })).toBe(serializeState({ a: 0 }));
  });

  it('satisfies / meetsGoal respect partial states', () => {
    expect(satisfies({ a: 1, b: 2 }, { a: 1 })).toBe(true);
    expect(satisfies({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(meetsGoal({ hasWood: 1 }, { hasWood: 1 })).toBe(true);
    expect(meetsGoal({ hasWood: 0 }, { hasWood: 1 })).toBe(false);
  });

  it('applyEffects assigns absolute effect values on a copy', () => {
    const s: WorldState = { hasAxe: 0 };
    const next = applyEffects(s, woodActions[0]);
    expect(next.hasAxe).toBe(1);
    expect(s.hasAxe).toBe(0); // original untouched
  });

  it('heuristic counts unmet goal features scaled by min cost, never over-estimating', () => {
    expect(heuristic({ hasWood: 1 }, { hasWood: 1 }, 1)).toBe(0);
    expect(heuristic({}, { hasWood: 1, hasAxe: 1 }, 1)).toBe(2);
    expect(heuristic({}, { hasWood: 1 }, 0.5)).toBe(0.5);
  });
});

describe('plan — correctness', () => {
  it('returns [] when the goal is already met', () => {
    expect(plan({ hasWood: 1 }, woodActions, { hasWood: 1 })).toEqual([]);
  });

  it('finds the minimum-cost plan (getAxe + chopWood, cost 3 < buyWood 10)', () => {
    const p = plan({ hasAxe: 0 }, woodActions, { hasWood: 1 });
    expect(p).not.toBeNull();
    expect(p!.map((a) => a.name)).toEqual(['getAxe', 'chopWood']);
    expect(planCost(p!)).toBe(3);
  });

  it('takes the direct expensive action when it is the only applicable path', () => {
    // No axe obtainable (getAxe precondition already violated by hasAxe:1 but no chop effect
    // reachable because chopWood needs hasWood not present) — force buyWood as the only route.
    const actions: Action[] = [
      { name: 'buyWood', preconditions: {}, effects: { hasWood: 1 }, cost: 10 },
    ];
    const p = plan({}, actions, { hasWood: 1 });
    expect(p!.map((a) => a.name)).toEqual(['buyWood']);
  });

  it('the resulting plan actually transforms start into a goal-satisfying state', () => {
    const start: WorldState = { hasAxe: 0 };
    const p = plan(start, woodActions, { hasWood: 1 })!;
    let s = start;
    for (const a of p) {
      expect(satisfies(s, a.preconditions)).toBe(true);
      s = applyEffects(s, a);
    }
    expect(meetsGoal(s, { hasWood: 1 })).toBe(true);
  });
});

describe('plan — shortest / cheapest with obstacles', () => {
  /**
   * "reach target" grid-ish scenario with an obstacle: move along a corridor where a
   * shortcut exists but is blocked unless a gate is opened (extra cost). The planner should
   * pick whichever total-cost path is cheaper.
   */
  const moveActions: Action[] = [
    { name: 'stepAB', preconditions: { at: 0 }, effects: { at: 1 }, cost: 1 },
    { name: 'stepBC', preconditions: { at: 1 }, effects: { at: 2 }, cost: 1 },
    { name: 'stepCD', preconditions: { at: 2 }, effects: { at: 3 }, cost: 1 },
    // Shortcut A->D but requires opening a gate first (obstacle).
    { name: 'openGate', preconditions: { gate: 0 }, effects: { gate: 1 }, cost: 1 },
    { name: 'shortcutAD', preconditions: { at: 0, gate: 1 }, effects: { at: 3 }, cost: 1 },
  ];

  it('prefers the gated shortcut when cheaper (cost 2 < 3 steps)', () => {
    const p = plan({ at: 0, gate: 0 }, moveActions, { at: 3 })!;
    expect(p.map((a) => a.name)).toEqual(['openGate', 'shortcutAD']);
    expect(planCost(p)).toBe(2);
  });

  it('walks the corridor when the shortcut is more expensive', () => {
    const expensiveShortcut: Action[] = moveActions.map((a) =>
      a.name === 'openGate' ? { ...a, cost: 5 } : a,
    );
    const p = plan({ at: 0, gate: 0 }, expensiveShortcut, { at: 3 })!;
    expect(p.map((a) => a.name)).toEqual(['stepAB', 'stepBC', 'stepCD']);
    expect(planCost(p)).toBe(3);
  });
});

describe('plan — unreachable', () => {
  it('returns null (does not hang) when the goal cannot be reached', () => {
    const actions: Action[] = [
      { name: 'noop', preconditions: { flag: 0 }, effects: { flag: 0 }, cost: 1 },
    ];
    expect(plan({ flag: 0 }, actions, { impossible: 1 })).toBeNull();
  });

  it('returns null with no actions at all', () => {
    expect(plan({ a: 0 }, [], { a: 1 })).toBeNull();
  });

  it('returns null when preconditions can never be met', () => {
    const actions: Action[] = [
      { name: 'needsKey', preconditions: { key: 1 }, effects: { door: 1 }, cost: 1 },
    ];
    expect(plan({ key: 0 }, actions, { door: 1 })).toBeNull();
  });

  it('does not loop forever on a cyclic state space and still finds the goal', () => {
    const actions: Action[] = [
      { name: 'toggleOn', preconditions: { s: 0 }, effects: { s: 1 }, cost: 1 },
      { name: 'toggleOff', preconditions: { s: 1 }, effects: { s: 0 }, cost: 1 },
      { name: 'finish', preconditions: { s: 1 }, effects: { done: 1 }, cost: 1 },
    ];
    const p = plan({ s: 0 }, actions, { done: 1 })!;
    expect(p.map((a) => a.name)).toEqual(['toggleOn', 'finish']);
  });

  it('ignores non-positive-cost actions (guards against zero-cost loops)', () => {
    const actions: Action[] = [
      { name: 'free', preconditions: {}, effects: { x: 1 }, cost: 0 },
    ];
    expect(plan({ x: 0 }, actions, { x: 1 })).toBeNull();
  });
});

describe('plan — strict determinism', () => {
  it('identical inputs yield identical plans (referentially stable action names)', () => {
    const p1 = plan({ hasAxe: 0 }, woodActions, { hasWood: 1 })!;
    const p2 = plan({ hasAxe: 0 }, woodActions, { hasWood: 1 })!;
    expect(p1.map((a) => a.name)).toEqual(p2.map((a) => a.name));
    expect(planCost(p1)).toBe(planCost(p2));
  });

  it('breaks equal-cost ties by earlier action-array order, stably across runs', () => {
    // Two equal-cost, single-action paths to the goal. Tie-break => the one listed FIRST.
    const tie: Action[] = [
      { name: 'pathA', preconditions: {}, effects: { at: 1 }, cost: 1 },
      { name: 'pathB', preconditions: {}, effects: { at: 1 }, cost: 1 },
    ];
    const p = plan({ at: 0 }, tie, { at: 1 })!;
    expect(p.map((a) => a.name)).toEqual(['pathA']);

    // Reordering the array flips the deterministic choice — proving the tie-break is the
    // array order, not insertion luck.
    const tieRev = [tie[1], tie[0]];
    const pr = plan({ at: 0 }, tieRev, { at: 1 })!;
    expect(pr.map((a) => a.name)).toEqual(['pathB']);
  });

  it('is stable over many repetitions', () => {
    const first = plan({ at: 0, gate: 0 }, [
      { name: 'stepAB', preconditions: { at: 0 }, effects: { at: 1 }, cost: 1 },
      { name: 'stepBC', preconditions: { at: 1 }, effects: { at: 2 }, cost: 1 },
    ], { at: 2 })!.map((a) => a.name);
    for (let i = 0; i < 50; i++) {
      const p = plan({ at: 0, gate: 0 }, [
        { name: 'stepAB', preconditions: { at: 0 }, effects: { at: 1 }, cost: 1 },
        { name: 'stepBC', preconditions: { at: 1 }, effects: { at: 2 }, cost: 1 },
      ], { at: 2 })!.map((a) => a.name);
      expect(p).toEqual(first);
    }
  });

  it('respects the maxExpansions safety bound (returns null instead of hanging)', () => {
    // An action that endlessly grows a counter never reaches the goal; the bound stops it.
    const actions: Action[] = [
      { name: 'inc', preconditions: {}, effects: {}, cost: 1 },
    ];
    // effects:{} means state never changes -> visited-set dedupes immediately -> null fast.
    expect(plan({ n: 0 }, actions, { n: 999 }, { maxExpansions: 100 })).toBeNull();
  });

  it('boolean and numeric feature encodings are interchangeable in state and goal', () => {
    const actions: Action[] = [
      { name: 'open', preconditions: { locked: false }, effects: { open: true }, cost: 1 },
    ];
    const p = plan({ locked: 0 }, actions, { open: 1 })!;
    expect(p.map((a) => a.name)).toEqual(['open']);
  });
});
