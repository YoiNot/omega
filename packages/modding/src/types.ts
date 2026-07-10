/**
 * @omega/modding — types for deterministic, data-driven world modding.
 *
 * A mod is a {@link ModManifest}: a list of {@link RulePatch}es (which overlay
 * or replace existing component values) and {@link ContentPatch}es (which add
 * new entities). Applying a manifest to a world is a pure, deterministic
 * operation — no clock, no randomness — so the same manifest always yields the
 * same world, and a serialized manifest is byte-stable.
 */

import type { World } from '@omega/engine-core';

/** How a rule's `value` is combined with the existing component instance. */
export type RuleStrategy =
  /** Replace the whole component instance with `value`. */
  | 'replace'
  /** Shallow-merge `value` over a clone of the existing instance. */
  | 'merge';

/**
 * A single rule patch: targets every entity that currently has `component`
 * and overlays/replaces its value with `value`.
 */
export interface RulePatch {
  /** Stable, unique rule id — used as the deterministic tie-breaker for order. */
  readonly id: string;
  /** Component store name, e.g. `'PhysicsBody'`. */
  readonly component: string;
  /** How `value` is applied to the existing component instance. */
  readonly strategy: RuleStrategy;
  /** The value (whole replacement, or the merged-over subset for `'merge'`). */
  readonly value: Record<string, unknown>;
  /**
   * Optional explicit priority. Lower runs first. When two rules share a
   * priority, they are ordered by `id`. Defaults to 0.
   */
  readonly priority?: number;
}

/** A single content patch: add one entity carrying the given components. */
export interface ContentPatch {
  /** Component store name -> initial component value. */
  readonly components: Record<string, Record<string, unknown>>;
}

/** The complete, data-driven description of a mod. */
export interface ModManifest {
  readonly id: string;
  readonly version: string;
  /** Rule patches applied first, in deterministic (priority, id) order. */
  readonly rules: RulePatch[];
  /** Content patches applied after the rule patches. */
  readonly content: ContentPatch[];
}

/** The engine-core world type this package operates on (the Sim world). */
export type ModdableWorld = World;
