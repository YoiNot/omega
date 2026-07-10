/**
 * @omega/modding — deterministic application of a {@link ModManifest} to a
 * world.
 *
 * `applyMod` is a pure function of `(world, manifest)`: no clock, no
 * randomness, no ambient state. The same inputs always produce the same world,
 * which is the entire point of the package — mods are reproducible data, not
 * code. Order is fully deterministic:
 *   1. Rule patches, sorted by (priority, id).
 *   2. Content patches, in array order.
 */

import type { ModManifest, RulePatch } from './types.js';
import type { World } from '@omega/engine-core';

/**
 * Deterministically order rule patches: ascending by `priority` (default 0),
 * then by `id` as a tie-breaker so two rules at the same priority are stable
 * regardless of the order they appeared in the manifest array.
 */
export function sortRules(rules: readonly RulePatch[]): RulePatch[] {
  return [...rules].sort((a, b) => {
    const pa = a.priority ?? 0;
    const pb = b.priority ?? 0;
    if (pa !== pb) return pa - pb;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/** Shallow-merge `patch` over a clone of `base` (neither is mutated). */
function shallowMerge(
  base: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  return { ...base, ...patch };
}

function applyRule(world: World, rule: RulePatch): void {
  const store = world.store<Record<string, unknown>>(rule.component);
  for (const id of store.keys()) {
    const current = store.get(id);
    if (current === undefined) continue;
    const next =
      rule.strategy === 'replace'
        ? { ...rule.value }
        : shallowMerge(current, rule.value);
    store.add(id, next);
  }
}

function applyContent(world: World, content: ModManifest['content']): void {
  for (const patch of content) {
    const id = world.createEntity();
    for (const [name, value] of Object.entries(patch.components)) {
      world.addComponent(name, id, { ...value });
    }
  }
}

/**
 * Apply a mod manifest to a world, deterministically.
 *
 * Mutates the world in place (rules overlay content values, content patches add
 * new entities). The world's entity ids stay stable: rule patches never create
 * or destroy entities; content patches append new ones. Pure w.r.t. time and
 * randomness.
 */
export function applyMod(world: World, manifest: ModManifest): void {
  for (const rule of sortRules(manifest.rules)) {
    applyRule(world, rule);
  }
  applyContent(world, manifest.content);
}
