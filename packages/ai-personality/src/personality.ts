/**
 * @omega/ai-personality — deterministic persona parameters that reshape agent behaviour.
 *
 * A {@link Personality} is a vector of named TRAITS, each a number in a closed, documented
 * range (default [-1, 1]). Traits modify GOAP action costs and preferences in a PURE,
 * reproducible way, so identical (persona, world, actions) always yields identical planning
 * behaviour. No clock, no RNG.
 *
 * Two mechanisms are provided:
 *
 *  1. PER-TRAIT ACTION COST MODIFIERS — `applyCostShift(action)` reads the action's static
 *     `costModifiers` map (action.author: `{ trait: factor }`) and scales the cost by the
 *     weighted trait vector. Example: a "cautious" agent (high `caution`) makes RISK actions
 *     cost more, so the planner avoids them unless they are clearly cheaper overall. A
 *     "bold" agent (low caution, or `cautious` near -1) makes them cheaper.
 *
 *  2. PREFERENCE BIASES — `applyPreference(action)` applies a flat additive/subtractive bias
 *     from a separate `preference` map (e.g. an agent that "likes woodcutting" gets a cost
 *     discount on the `chop` action regardless of traits), so personalities can express plain
 *     likes/dislikes deterministically.
 *
 * The GOAP {@link Action} type is RE-USED unchanged; personality modifiers are carried on an
 * OPTIONAL `persona` field added via module augmentation-free composition — we wrap actions in
 * a `{ base: Action, costModifiers?, preference? }` record (`PersonaAction`) so the planner's
 * own `Action` type is never mutated upstream.
 */

import { clamp, clamp01 } from '@omega/engine-math';
import type { Action } from '@omega/ai-goap';

/** A trait vector: trait name -> value. Values are expected in `traitRange` (default [-1,1]). */
export type TraitVector = Record<string, number>;

/** A GOAP action augmented with personality hooks. The `base` action is the real planner Action. */
export interface PersonaAction {
  readonly base: Action;
  /**
   * Per-trait cost multipliers. The action's effective cost is scaled by
   * `1 + sum(trait_i * factor_i)`. A POSITIVE factor means the trait MAKES the action
   * EXPENSIVE (e.g. `caution: +0.5` => cautious agents pay +50% for this risky action).
   * A NEGATIVE factor makes the trait CHEAPEN the action.
   */
  readonly costModifiers?: TraitVector;
  /**
   * Flat additive cost bias (after the trait scaling), independent of traits. Positive biases
   * make the action less preferred; negative biases make it preferred. Range is unbounded but
   * typically small (e.g. -2..+2).
   */
  readonly preference?: number;
}

/** Default closed range a trait value is clamped into. */
export const TRAIT_MIN = -1;
export const TRAIT_MAX = 1;

/** A persona: a name, a trait vector, and the trait range it clamps into. */
export class Personality {
  readonly name: string;
  private readonly traits: TraitVector;
  private readonly lo: number;
  private readonly hi: number;

  constructor(name: string, traits: TraitVector, range: [number, number] = [TRAIT_MIN, TRAIT_MAX]) {
    this.name = name;
    this.lo = Math.min(range[0], range[1]);
    this.hi = Math.max(range[0], range[1]);
    this.traits = {};
    for (const k in traits) this.traits[k] = clamp(traits[k], this.lo, this.hi);
  }

  /** Read a trait, clamped to range. Absent trait reads as the range midpoint (neutral). */
  get(trait: string): number {
    const v = this.traits[trait];
    if (v === undefined) return (this.lo + this.hi) / 2;
    return v;
  }

  /** All traits (clamped, copy). */
  traitsSnapshot(): TraitVector {
    return { ...this.traits };
  }

  /** Trait range. */
  get range(): [number, number] {
    return [this.lo, this.hi];
  }

  /**
   * Weighted trait contribution to a PersonaAction's cost scaling:
   *   sum(trait_i * factor_i), using the clamped trait value for every declared modifier.
   */
  traitContribution(modifiers?: TraitVector): number {
    if (!modifiers) return 0;
    let acc = 0;
    for (const k in modifiers) acc += this.get(k) * modifiers[k];
    return acc;
  }

  /**
   * Apply this persona to a PersonaAction, producing a concrete planner {@link Action} whose
   * cost is shifted deterministically:
   *   effectiveCost = baseCost * (1 + traitContribution) + (preference ?? 0)
   * Costs are floored at a small positive epsilon so the planner never sees a non-positive
   * cost (which would break its loop-guards). Returns a NEW action object; `base` is untouched.
   */
  applyCostShift(action: PersonaAction): Action {
    const contribution = this.traitContribution(action.costModifiers);
    const pref = action.preference ?? 0;
    const shifted = action.base.cost * (1 + contribution) + pref;
    const bounded = shifted < action.base.cost * 1e-6 ? action.base.cost * 1e-6 : shifted;
    return {
      name: action.base.name,
      preconditions: action.base.preconditions,
      effects: action.base.effects,
      cost: bounded,
    };
  }

  /**
   * Convenience: shift an entire action list into planner-ready actions. Deterministic order
   * (input order preserved), so the downstream planner's tie-breaks remain stable.
   */
  shiftActions(actions: readonly PersonaAction[]): Action[] {
    return actions.map((a) => this.applyCostShift(a));
  }
}

/** Clamp a trait value into [0,1] (handy for "intensity" computations). */
export function normalizedTrait(p: Personality, trait: string): number {
  const [lo, hi] = p.range;
  if (hi === lo) return clamp01((p.get(trait) - lo) / 1);
  return clamp01((p.get(trait) - lo) / (hi - lo));
}
