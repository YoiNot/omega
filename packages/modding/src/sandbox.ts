/**
 * @omega/modding — sandboxing: apply a manifest in isolation and verify it only
 * touches what it declared.
 *
 * `sandboxMod` deep-clones the target world, applies the manifest to the clone,
 * and diffs clone-before against clone-after. Every actual change is checked
 * against the manifest's own declaration:
 *   - `allowedComponents`            — component stores rules may modify.
 *   - `allowedContentComponents`     — component stores content may add.
 *   - `allowedEntities` (optional)   — entity ids rules may modify.
 * `@everywhere` on any of the three permits everything. A change to a component
 * or entity outside the declared allow-list is reported as a deterministic
 * violation. The whole check is pure: no clock, no randomness, and the reported
 * `changes`/`violations` are emitted in a stable order so the same manifest +
 * same world always yields the same sandbox verdict.
 */

import type { World } from '@omega/engine-core';
import { World as CoreWorld } from '@omega/engine-core';
import { snapshotWorld } from '@omega/save';
import type { ModManifest } from './types.js';
import { applyMod } from './apply.js';
import { canonicalStringify } from './canon.js';
import { validateModManifest } from './validate.js';

/** Sentinel meaning "no restriction": all components / entities are permitted. */
export const EVERYWHERE = '@everywhere' as const;
export type Everywhere = typeof EVERYWHERE;

/** A manifest plus its sandbox declaration (what it is allowed to touch). */
export interface SandboxModManifest extends ModManifest {
  /** Component stores rules may modify, or `@everywhere`. */
  readonly allowedComponents: readonly string[] | Everywhere;
  /** Component stores content patches may add, or `@everywhere`. */
  readonly allowedContentComponents: readonly string[] | Everywhere;
  /** Entity ids rules may modify, or `@everywhere`. Omit to restrict to none. */
  readonly allowedEntities?: readonly number[] | Everywhere;
}

/** One concrete change observed between the isolated world before/after apply. */
export interface SandboxChange {
  /** `'modify'` = existing entity's component value changed; `'add'` = new entity. */
  readonly kind: 'modify' | 'add';
  /** The component store the change landed in. */
  readonly component: string;
  /** The entity id affected. */
  readonly entity: number;
}

/** The deterministic verdict of {@link sandboxMod}. */
export interface SandboxResult {
  /** Manifest passed structural validation. */
  readonly valid: boolean;
  /** Validation errors (only populated when `valid` is false). */
  readonly validationErrors: ReadonlyArray<{ readonly code: string; readonly path: string; readonly message: string }>;
  /** Every actual change, deterministically ordered by (component, entity). */
  readonly changes: readonly SandboxChange[];
  /** Undeclared-change messages, deterministically ordered. */
  readonly violations: readonly string[];
  /** `valid && violations.length === 0`. */
  readonly safe: boolean;
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Build a deep-cloned world containing exactly `storeNames` from `world`. */
function cloneWorld(world: World, storeNames: string[]): World {
  const snap = snapshotWorld(world, storeNames);
  const clone = new CoreWorld();
  for (const ent of snap.entities) {
    const id = clone.createEntity();
    for (const [name, value] of Object.entries(ent.components)) {
      clone.addComponent(name, id, deepClone(value) as object);
    }
  }
  return clone;
}

/** Collect (component -> entityId -> canonical value) from a snapshot. */
function indexSnapshot(snap: ReturnType<typeof snapshotWorld>): Map<string, Map<number, string>> {
  const out = new Map<string, Map<number, string>>();
  for (const ent of snap.entities) {
    for (const [name, value] of Object.entries(ent.components)) {
      let m = out.get(name);
      if (!m) {
        m = new Map<number, string>();
        out.set(name, m);
      }
      m.set(ent.id, canonicalStringify(value));
    }
  }
  return out;
}

/** Is `name` permitted by an allow-list (which may be `@everywhere`)? */
function isAllowed(name: string, allow: readonly string[] | Everywhere | undefined): boolean {
  if (allow === undefined) return false;
  if (allow === EVERYWHERE) return true;
  return (allow as readonly string[]).includes(name);
}

function isEntityAllowed(entity: number, allow: readonly number[] | Everywhere | undefined): boolean {
  if (allow === undefined) return false;
  if (allow === EVERYWHERE) return true;
  return (allow as readonly number[]).includes(entity);
}

/**
 * Apply `manifest` to an isolated clone of `world` and verify it only changed
 * declared components/entities. Returns a deterministic verdict.
 *
 * Pure w.r.t. `world`: the input world is never mutated (we clone first). The
 * result's `changes` and `violations` arrays are emitted in a stable order so
 * callers (and the ModdingPanel "safe to apply?" oracle) get byte-identical
 * verdicts for identical inputs.
 */
export function sandboxMod(world: World, manifest: SandboxModManifest): SandboxResult {
  // 1. Structural validity first — an invalid manifest can't be sandboxed safely.
  const vresult = validateModManifest(manifest);
  if (!vresult.valid || !vresult.manifest) {
    return {
      valid: false,
      validationErrors: vresult.errors,
      changes: [],
      violations: [],
      safe: false,
    };
  }

  const violations: string[] = [];

  // 2. Static allow-list conformance: every component the manifest even
  //    *mentions* must be within the declared allow-list.
  const allowedComponents = manifest.allowedComponents;
  const allowedContent = manifest.allowedContentComponents;

  for (const rule of manifest.rules) {
    if (!isAllowed(rule.component, allowedComponents)) {
      violations.push(
        `rule "${rule.id}" modifies undeclared component "${rule.component}" (not in allowedComponents)`,
      );
    }
  }
  const contentComponentNames = new Set<string>();
  for (const patch of manifest.content) {
    for (const name of Object.keys(patch.components)) {
      contentComponentNames.add(name);
      if (!isAllowed(name, allowedContent)) {
        violations.push(
          `content patch adds undeclared component "${name}" (not in allowedContentComponents)`,
        );
      }
    }
  }

  // 3. Dynamic isolation: clone, apply, diff.
  const touched = new Set<string>();
  for (const r of manifest.rules) touched.add(r.component);
  for (const name of contentComponentNames) touched.add(name);
  const storeNames = [...touched];

  const before = indexSnapshot(snapshotWorld(world, storeNames));
  const clone = cloneWorld(world, storeNames);
  applyMod(clone, manifest);
  const after = indexSnapshot(snapshotWorld(clone, storeNames));

  const changes: SandboxChange[] = [];
  const sortedComponents = [...new Set([...before.keys(), ...after.keys()])].sort();

  for (const component of sortedComponents) {
    const beforeMap = before.get(component);
    const afterMap = after.get(component);
    const ids = new Set<number>([
      ...(beforeMap ? [...beforeMap.keys()] : []),
      ...(afterMap ? [...afterMap.keys()] : []),
    ]);
    for (const entity of [...ids].sort((a, b) => a - b)) {
      const had = beforeMap?.has(entity);
      const has = afterMap?.has(entity);
      if (had && has) {
        if (beforeMap!.get(entity) !== afterMap!.get(entity)) {
          changes.push({ kind: 'modify', component, entity });
          // A modify on an undeclared component is already flagged statically;
          // here we additionally enforce the entity-level allow-list.
          if (!isEntityAllowed(entity, manifest.allowedEntities)) {
            violations.push(
              `rule modifies undeclared entity ${entity} in component "${component}" (not in allowedEntities)`,
            );
          }
        }
      } else if (!had && has) {
        changes.push({ kind: 'add', component, entity });
        // 'add' (content) component membership is already flagged statically.
      }
      // (removal can never occur under applyMod; ignore.)
    }
  }

  return {
    valid: true,
    validationErrors: [],
    changes,
    violations,
    safe: violations.length === 0,
  };
}
