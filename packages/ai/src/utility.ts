/**
 * @omega/ai — Utility AI.
 *
 * Utility AI scores a set of options against the current context and picks the best one.
 * Each `UtilityOption` is a list of `Consideration`s; a consideration maps a normalized
 * input (0..1) through a response curve to produce a 0..1 weight. An option's score is the
 * product of all its consideration weights (the classic "multiplicative" blend; a `min`
 * blending mode is also provided), clamped to 0..1.
 *
 * Determinism: all curves are pure functions of `x`; `chooseBest` breaks ties by earliest
 * option (first max), so identical inputs always yield the same winner.
 */

import { clamp01 } from '@omega/engine-math';

/** A response curve mapping a normalized input x in [0,1] to a weight in [0,1]. */
export type UtilityCurve = (x: number) => number;

/** A consideration: an input extractor plus a response curve. */
export interface Consideration {
  /** Extract and normalize a 0..1 signal from the context. */
  input: (ctx: unknown) => number;
  /** Response curve applied to the normalized input. */
  curve: UtilityCurve;
}

/** A selectable action with one or more considerations. */
export interface UtilityOption {
  name: string;
  considerations: Consideration[];
}

/** How an option's consideration weights are combined into a single score. */
export type BlendMode = 'product' | 'min';

// --- Default response curves (pure, normalized 0..1) ---------------------

/** Linear: y = x. */
export const linear: UtilityCurve = (x) => clamp01(x);

/** Quadratic: y = x^2 (favors high inputs). */
export const quadratic: UtilityCurve = (x) => clamp01(x) * clamp01(x);

/** Inverse quadratic: y = 1 - (1 - x)^2 (favors low inputs). */
export const inverse: UtilityCurve = (x) => {
  const t = clamp01(x);
  return 1 - (1 - t) * (1 - t);
};

/**
 * Logistic (sigmoid) centered at `mid` with steepness `k` (default 10),
 * i.e. 1 / (1 + e^(-k * (x - mid))). `mid` defaults to 0.5.
 */
export function logistic(mid = 0.5, k = 10): UtilityCurve {
  return (x) => {
    const t = clamp01(x);
    return 1 / (1 + Math.exp(-k * (t - mid)));
  };
}

/** Built-in curve registry, keyed by name, for convenience/serialization. */
export const curves = {
  linear,
  quadratic,
  inverse,
  logistic,
} as const;

export type CurveName = keyof typeof curves;

// --- Scoring -------------------------------------------------------------

/**
 * Score a single option against `ctx`.
 *
 * Each consideration produces weight = curve(clamp01(input(ctx))); the option score is the
 * product (or min) of those weights, clamped to [0,1]. An option with no considerations
 * scores 0 (it expresses no preference and should never be selected over a real option).
 */
export function scoreOption(
  opt: UtilityOption,
  ctx: unknown,
  blend: BlendMode = 'product',
): number {
  if (opt.considerations.length === 0) return 0;

  let score: number;
  if (blend === 'min') {
    score = 1;
    for (const c of opt.considerations) {
      const w = c.curve(clamp01(c.input(ctx)));
      if (w < score) score = w;
    }
  } else {
    score = 1;
    for (const c of opt.considerations) {
      score *= c.curve(clamp01(c.input(ctx)));
    }
  }
  return clamp01(score);
}

/**
 * Choose the highest-scoring option. Ties resolve to the first maximum (stable, deterministic).
 * Returns null only if `options` is empty.
 */
export function chooseBest(
  options: UtilityOption[],
  ctx: unknown,
  blend: BlendMode = 'product',
): UtilityOption | null {
  let best: UtilityOption | null = null;
  let bestScore = -1;
  for (const opt of options) {
    const s = scoreOption(opt, ctx, blend);
    // Strict > so the first max wins on ties.
    if (s > bestScore) {
      bestScore = s;
      best = opt;
    }
  }
  return best;
}
