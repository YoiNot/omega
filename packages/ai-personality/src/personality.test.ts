import { describe, it, expect } from 'vitest';
import { Personality, normalizedTrait, TRAIT_MIN, TRAIT_MAX, type PersonaAction } from './index.js';
import { plan } from '@omega/ai-goap';

const baseActions: PersonaAction[] = [
  {
    base: { name: 'getAxe', preconditions: { hasAxe: 0 }, effects: { hasAxe: 1 }, cost: 2 },
    costModifiers: { boldness: 0, caution: -0.2 }, // careful agents find this slightly cheaper
  },
  {
    base: { name: 'chop', preconditions: { hasAxe: 1 }, effects: { hasWood: 1 }, cost: 1 },
    costModifiers: { boldness: 0, caution: 0 },
  },
  {
    base: { name: 'riskyShortcut', preconditions: {}, effects: { hasWood: 1 }, cost: 1 },
    costModifiers: { caution: 0.6 }, // a cautious agent pays a big premium for RISK
  },
  {
    base: { name: 'likedAction', preconditions: {}, effects: { x: 1 }, cost: 5 },
    preference: -3, // this agent just likes doing it
  },
];

describe('Personality — trait clamping & reading', () => {
  it('clamps traits into the declared range', () => {
    const p = new Personality('ranger', { boldness: 5, caution: -9 }, [-1, 1]);
    expect(p.get('boldness')).toBe(1);
    expect(p.get('caution')).toBe(-1);
  });

  it('absent trait reads as the neutral midpoint', () => {
    const p = new Personality('n', { a: 1 }, [-1, 1]);
    expect(p.get('missing')).toBe(0);
  });

  it('reads back the clamped traits snapshot', () => {
    const p = new Personality('n', { a: 0.5 }, [-1, 1]);
    expect(p.traitsSnapshot()).toEqual({ a: 0.5 });
  });
});

describe('Personality — cost shift is deterministic & reproducible', () => {
  it('same persona + action => identical shifted cost (many runs)', () => {
    const cautious = new Personality('cautious', { caution: 0.8 });
    const ref = cautious.applyCostShift(baseActions[2]).cost; // riskyShortcut with caution premium
    for (let i = 0; i < 30; i++) {
      const p = new Personality('cautious', { caution: 0.8 });
      expect(p.applyCostShift(baseActions[2]).cost).toBeCloseTo(ref, 12);
    }
  });

  it('cautious agent pays MORE for the risky action than a bold agent', () => {
    const cautious = new Personality('cautious', { caution: 0.8 });
    const bold = new Personality('bold', { caution: -0.8 });
    const cCost = cautious.applyCostShift(baseActions[2]).cost;
    const bCost = bold.applyCostShift(baseActions[2]).cost;
    expect(cCost).toBeGreaterThan(bCost);
  });

  it('preference bias is applied additively after trait scaling', () => {
    const p = new Personality('n', {}, [-1, 1]);
    const shifted = p.applyCostShift(baseActions[3]); // base 5, preference -3 => ~2
    expect(shifted.cost).toBeCloseTo(2, 12);
  });

  it('does not mutate the base action cost', () => {
    const p = new Personality('n', { caution: 1 });
    p.applyCostShift(baseActions[2]);
    expect(baseActions[2].base.cost).toBe(1);
  });

  it('never produces a non-positive cost (floored)', () => {
    const harsh: PersonaAction[] = [
      { base: { name: 'a', preconditions: {}, effects: {}, cost: 1 }, costModifiers: { caution: -5 } },
    ];
    const extreme = new Personality('extreme', { caution: -1 });
    expect(extreme.applyCostShift(harsh[0]).cost).toBeGreaterThan(0);
  });

  it('shiftActions preserves order', () => {
    const p = new Personality('n', { caution: 0.3 });
    const out = p.shiftActions(baseActions);
    expect(out.map((a) => a.name)).toEqual(baseActions.map((a) => a.base.name));
  });
});

describe('Personality — changes planner behaviour reproducibly', () => {
  it('cautious agent avoids the risky shortcut in favour of the safe path', () => {
    // Safe path: getAxe(2) + chop(1) = 3. Risky shortcut base 4, but a cautious agent pays a
    // steep caution premium (0.6 factor * 0.9 caution = +54%) so it costs ~6.16 — more than the
    // safe path — and the planner takes the safe route.
    const actions: PersonaAction[] = [
      { base: { name: 'getAxe', preconditions: { hasAxe: 0 }, effects: { hasAxe: 1 }, cost: 2 },
        costModifiers: { caution: 0 } },
      { base: { name: 'chop', preconditions: { hasAxe: 1 }, effects: { hasWood: 1 }, cost: 1 },
        costModifiers: { caution: 0 } },
      { base: { name: 'riskyShortcut', preconditions: {}, effects: { hasWood: 1 }, cost: 4 },
        costModifiers: { caution: 0.6 } },
    ];
    const cautious = new Personality('cautious', { caution: 0.9 });
    const shifted = cautious.shiftActions(actions);
    const planCautious = plan({ hasAxe: 0, hasWood: 0 }, shifted, { hasWood: 1 });
    expect(planCautious!.map((a) => a.name)).toEqual(['getAxe', 'chop']);
  });

  it('a bold agent (negative caution) may take the risky shortcut when it is cheaper', () => {
    // Make the safe path artificially expensive so the bold agent prefers the (now cheaper)
    // risky shortcut. This proves the persona flips the deterministic plan.
    const actions: PersonaAction[] = [
      { base: { name: 'getAxe', preconditions: { hasAxe: 0 }, effects: { hasAxe: 1 }, cost: 20 },
        costModifiers: { caution: -0.2 } },
      { base: { name: 'chop', preconditions: { hasAxe: 1 }, effects: { hasWood: 1 }, cost: 20 },
        costModifiers: { caution: 0 } },
      { base: { name: 'riskyShortcut', preconditions: {}, effects: { hasWood: 1 }, cost: 1 },
        costModifiers: { caution: 0.6 } },
    ];
    const bold = new Personality('bold', { caution: -0.9 });
    const shifted = bold.shiftActions(actions);
    const planBold = plan({ hasAxe: 0, hasWood: 0 }, shifted, { hasWood: 1 });
    expect(planBold!.map((a) => a.name)).toEqual(['riskyShortcut']);
  });

  it('neutral traits leave cost-modifier actions unchanged; preference bias still applies', () => {
    // With no traits, the trait scaling factor is 1, so actions WITHOUT a preference bias keep
    // their base cost exactly. The trait-independent `preference` bias (likedAction: -3) still
    // applies regardless of personality — that is the intended semantics.
    const neutral = new Personality('neutral', {}, [-1, 1]);
    const shifted = neutral.shiftActions(baseActions);
    expect(shifted.map((a) => a.cost)).toEqual([2, 1, 1, 2]);
    // The liked action (base 5, preference -3) is cheaper; the others match their base.
    expect(shifted[3].cost).toBeCloseTo(2, 12);
    expect(shifted[0].cost).toBe(2);
  });
});

describe('normalizedTrait', () => {
  it('maps a [-1,1] trait to [0,1]', () => {
    const p = new Personality('n', { a: -1 }, [-1, 1]);
    expect(normalizedTrait(p, 'a')).toBe(0);
    const p2 = new Personality('n', { a: 1 }, [-1, 1]);
    expect(normalizedTrait(p2, 'a')).toBe(1);
    const p3 = new Personality('n', { a: 0 }, [-1, 1]);
    expect(normalizedTrait(p3, 'a')).toBe(0.5);
  });
});

describe('TRAIT constants', () => {
  it('exposes the default range', () => {
    expect([TRAIT_MIN, TRAIT_MAX]).toEqual([-1, 1]);
  });
});
