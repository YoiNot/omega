/**
 * @omega/ai-learning — deterministic "practice makes perfect" cost refinement.
 *
 * NOT reinforcement learning. This is a reproducible, closed-form adaptation: the more an agent
 * PERFORMS an action, the more PROFICIENT it becomes, and the cheaper the action gets. The
 * proficiency curve is a fixed, monotonic, saturating function of the practice count, so the
 * same sequence of practice events always yields the same cost factors — no gradient, no
 * exploration noise, no clock.
 *
 *   proficiency(n) = 1 - (1 - decay)^n      (n = times practised, decay in [0,1))
 *      -> starts at 0 for n=0, rises toward 1 as n grows. Higher `decay` means a STEEPER
 *         learning curve (a single practice closes more of the gap), matching the intuitive
 *         meaning of a "decay rate" of the unpractised state.
 *   costFactor(n) = max(minFactor, 1 - proficiency * (1 - minFactor))
 *      -> 1 at n=0, approaches `minFactor` (the cheapest the action ever gets) as n -> inf.
 *
 * A {@link PracticeLog} records `(actionName, amount)` events. Each event increments the
 * practice count by `amount` (default 1) — this is the ONLY mutable state. `costFactorFor`
 * returns the deterministic multiplier; `adjustedAction` / `adjustActions` fold it into a
 * GOAP {@link Action} so the EXISTING planner automatically prefers well-practised actions.
 *
 * DETERMINISM CONTRACT: the practice count is a pure integer sum; the cost factor is a pure
 * deterministic function of that integer plus the (static) `decay`/`minFactor` config. SAME
 * practice record sequence -> SAME counts -> SAME factors -> SAME planner behaviour.
 */

import { clamp } from '@omega/engine-math';
import type { Action } from '@omega/ai-goap';

/** Serializable dump of a practice log (save/load + deterministic equality). */
export interface PracticeSnapshot {
  readonly decay: number;
  readonly minFactor: number;
  readonly counts: Record<string, number>;
}

/** A deterministic practice ledger: maps action name -> times practised. */
export class PracticeLog {
  private readonly counts: Record<string, number> = {};
  private readonly decay: number;
  private readonly minFactor: number;

  /**
   * @param decay      proficiency decay per practice (0,1). Higher = proficiency rises faster.
   *                   Default 0.5 (each practice halves the remaining "unpractised" gap).
   * @param minFactor  lowest cost factor an action can reach (0,1]. Default 0.5 (practised
   *                   actions cost at least half their base). Must be > 0.
   */
  constructor(decay = 0.5, minFactor = 0.5) {
    this.decay = clamp(decay, 0, 1);
    this.minFactor = clamp(minFactor, 1e-6, 1);
  }

  /** How many times `actionName` has been practised (0 if never). */
  count(actionName: string): number {
    return this.counts[actionName] ?? 0;
  }

  /** Record a practice event for an action (amount defaults to 1, must be >= 0). */
  practice(actionName: string, amount = 1): void {
    if (!Number.isFinite(amount) || amount < 0) {
      throw new Error('PracticeLog.practice: amount must be a non-negative finite number');
    }
    this.counts[actionName] = (this.counts[actionName] ?? 0) + amount;
  }

  /**
   * Record a practice event for EVERY action in a plan (in order, deterministic). Each action
   * name is practised `amount` times. Lets a caller "learn from" an executed plan trivially.
   */
  practicePlan(actions: readonly Action[], amount = 1): void {
    for (const a of actions) this.practice(a.name, amount);
  }

  /** Proficiency of an action in [0,1): `1 - (1 - decay)^n`. */
  proficiency(actionName: string): number {
    const n = this.count(actionName);
    // (1-decay)^n; for n=0 -> 1 -> proficiency 0. decay in [0,1) keeps (1-decay) in (0,1].
    return 1 - Math.pow(1 - this.decay, n);
  }

  /** Cost multiplier for an action in [minFactor, 1]: cheaper the more it is practised. */
  costFactorFor(actionName: string): number {
    const p = this.proficiency(actionName);
    const factor = 1 - p * (1 - this.minFactor);
    return clamp(factor, this.minFactor, 1);
  }

  /**
   * Return a planner-ready {@link Action} whose cost is scaled by the action's practice factor.
   * The base action is NOT mutated. Cost is floored at a tiny positive epsilon so the planner
   * never sees a non-positive cost.
   */
  adjustedAction(action: Action): Action {
    const factor = this.costFactorFor(action.name);
    const adjusted = action.cost * factor;
    const floor = action.cost * 1e-6;
    return {
      name: action.name,
      preconditions: action.preconditions,
      effects: action.effects,
      cost: adjusted < floor ? floor : adjusted,
    };
  }

  /** Adjust a whole action list deterministically (input order preserved). */
  adjustActions(actions: readonly Action[]): Action[] {
    return actions.map((a) => this.adjustedAction(a));
  }

  /** Reset all practice counts (decay/minFactor config is kept). */
  clear(): void {
    for (const k in this.counts) delete this.counts[k];
  }

  /** Serialize the ledger for checkpoint/restore. */
  serialize(): PracticeSnapshot {
    return { decay: this.decay, minFactor: this.minFactor, counts: { ...this.counts } };
  }

  /** Rebuild a ledger byte-identically from a {@link serialize} blob. */
  static fromSnapshot(s: PracticeSnapshot): PracticeLog {
    const log = new PracticeLog(s.decay, s.minFactor);
    for (const k in s.counts) log.counts[k] = s.counts[k];
    return log;
  }
}
