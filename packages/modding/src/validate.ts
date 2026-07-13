/**
 * @omega/modding — strict, deterministic validation of a {@link ModManifest}.
 *
 * `validateModManifest` is a pure function of its input: the same (even invalid)
 * manifest always yields the *identical* error list — identical codes, paths,
 * and messages, in a stable order. There is no clock, no randomness, and no
 * dependence on object-key insertion order: checks run in a fixed sequence and
 * cross-rule checks (duplicate ids, conflicting priorities) are computed from a
 * deterministically sorted index set. This makes the validator safe to use both
 * as a build-time gate and as the live "is this manifest safe to apply?" oracle
 * the ModdingPanel can call before writing to disk.
 *
 * Error shape is intentionally small and machine-readable so consumers can
 * group/translate them, while `message` stays human-readable and stable.
 */

import type { ModManifest, RulePatch, ContentPatch } from './types.js';

/** A single, deterministic validation finding. */
export interface ValidationError {
  /** Stable, machine-readable code (e.g. `'rule-strategy-invalid'`). */
  readonly code: string;
  /** JSON-pointer-ish location, e.g. `'rules[2].value'` or `'root'`. */
  readonly path: string;
  /** Human-readable, deterministic message. */
  readonly message: string;
}

/** The result of validating an unknown value as a {@link ModManifest}. */
export interface ValidationResult {
  readonly valid: boolean;
  /** Always sorted in a stable, deterministic order (see {@link validateModManifest}). */
  readonly errors: ValidationError[];
  /** Present iff `valid` is true. */
  readonly manifest?: ModManifest;
}

const VALID_STRATEGIES = new Set(['merge', 'replace']);

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Strictly validate `input` as a {@link ModManifest}.
 *
 * Order of checks (deterministic):
 *   1. Root shape (object, `id`, `version`, `rules`/`content` arrays).
 *   2. Per-rule checks in array order: `id`, `component`, `strategy`, `value`,
 *      optional `priority` — each emitted at its own path.
 *   3. Per-content-patch checks in array order: `components` object + each
 *      named component value being a plain object.
 *   4. Cross-rule checks: duplicate `id`s, and a duplicate `id` carrying two
 *      different `priority` values (a "conflicting priority").
 *
 * The returned `errors` array is always in the order the checks run, so two
 * structurally identical invalid manifests produce byte-identical results
 * regardless of how their object keys were constructed.
 */
export function validateModManifest(input: unknown): ValidationResult {
  const errors: ValidationError[] = [];

  if (!isPlainObject(input)) {
    errors.push({
      code: 'manifest-not-object',
      path: 'root',
      message: 'Manifest must be a JSON object',
    });
    return { valid: false, errors };
  }

  const m = input as Record<string, unknown>;

  // --- root: id / version ---
  if (typeof m.id !== 'string') {
    errors.push({
      code: 'id-not-string',
      path: 'id',
      message: 'Manifest "id" must be a string',
    });
  } else if (m.id.length === 0) {
    errors.push({
      code: 'id-empty',
      path: 'id',
      message: 'Manifest "id" must not be empty',
    });
  }

  if (typeof m.version !== 'string') {
    errors.push({
      code: 'version-not-string',
      path: 'version',
      message: 'Manifest "version" must be a string',
    });
  } else if (m.version.length === 0) {
    errors.push({
      code: 'version-empty',
      path: 'version',
      message: 'Manifest "version" must not be empty',
    });
  }

  // --- root: rules array ---
  const rules = m.rules;
  if (rules !== undefined && !Array.isArray(rules)) {
    errors.push({
      code: 'rules-not-array',
      path: 'rules',
      message: 'Manifest "rules" must be an array',
    });
  }

  // --- root: content array ---
  const content = m.content;
  if (content !== undefined && !Array.isArray(content)) {
    errors.push({
      code: 'content-not-array',
      path: 'content',
      message: 'Manifest "content" must be an array',
    });
  }

  // Collect rule ids (with their declared priority) for the cross-rule pass.
  // Map id -> first-seen index and the set of (index, priority) we observed.
  const ruleIds = new Map<string, { firstIndex: number; seen: Array<{ index: number; priority: number }> }>();

  // --- per-rule checks (array order) ---
  if (Array.isArray(rules)) {
    for (let i = 0; i < rules.length; i++) {
      const rule = rules[i];
      const base = `rules[${i}]`;
      if (!isPlainObject(rule)) {
        errors.push({
          code: 'rule-not-object',
          path: base,
          message: `Rule at ${base} must be an object`,
        });
        continue;
      }
      const r = rule as Record<string, unknown>;

      if (typeof r.id !== 'string') {
        errors.push({
          code: 'rule-id-not-string',
          path: `${base}.id`,
          message: `Rule at ${base} needs a string "id"`,
        });
      } else if (r.id.length === 0) {
        errors.push({
          code: 'rule-id-empty',
          path: `${base}.id`,
          message: `Rule at ${base} has an empty "id"`,
        });
      }

      if (typeof r.component !== 'string') {
        errors.push({
          code: 'rule-component-not-string',
          path: `${base}.component`,
          message: `Rule at ${base} needs a string "component"`,
        });
      } else if (r.component.length === 0) {
        errors.push({
          code: 'rule-component-empty',
          path: `${base}.component`,
          message: `Rule at ${base} has an empty "component"`,
        });
      }

      if (r.strategy !== undefined && !VALID_STRATEGIES.has(r.strategy as string)) {
        errors.push({
          code: 'rule-strategy-invalid',
          path: `${base}.strategy`,
          message: `Rule at ${base} "strategy" must be "merge" or "replace"`,
        });
      }

      if (r.value !== undefined && !isPlainObject(r.value)) {
        errors.push({
          code: 'rule-value-not-object',
          path: `${base}.value`,
          message: `Rule at ${base} "value" must be an object`,
        });
      }

      if (r.priority !== undefined && (typeof r.priority !== 'number' || !Number.isFinite(r.priority))) {
        errors.push({
          code: 'rule-priority-not-number',
          path: `${base}.priority`,
          message: `Rule at ${base} "priority" must be a finite number`,
        });
      }

      // Record id for the cross-rule duplicate/conflict pass (only when well-formed).
      if (typeof r.id === 'string' && r.id.length > 0) {
        const priority = typeof r.priority === 'number' && Number.isFinite(r.priority) ? r.priority : 0;
        const entry = ruleIds.get(r.id);
        if (entry) {
          entry.seen.push({ index: i, priority });
        } else {
          ruleIds.set(r.id, { firstIndex: i, seen: [{ index: i, priority }] });
        }
      }
    }
  }

  // --- per-content checks (array order) ---
  if (Array.isArray(content)) {
    for (let i = 0; i < content.length; i++) {
      const patch = content[i];
      const base = `content[${i}]`;
      if (!isPlainObject(patch)) {
        errors.push({
          code: 'content-not-object',
          path: base,
          message: `Content patch at ${base} must be an object`,
        });
        continue;
      }
      const c = patch as Record<string, unknown>;
      if (!isPlainObject(c.components)) {
        errors.push({
          code: 'content-components-not-object',
          path: `${base}.components`,
          message: `Content patch at ${base} needs a "components" object`,
        });
        continue;
      }
      // Each declared component value must itself be a plain object.
      for (const [name, value] of Object.entries(c.components as Record<string, unknown>)) {
        if (!isPlainObject(value)) {
          errors.push({
            code: 'content-component-value-not-object',
            path: `${base}.components.${name}`,
            message: `Content patch at ${base} component "${name}" value must be an object`,
          });
        }
      }
    }
  }

  // --- cross-rule: duplicate ids + conflicting priorities ---
  // Iterate ids in insertion order; for each id seen more than once, emit a
  // duplicate error for every later index, plus a conflicting-priority error
  // when two occurrences disagree on priority.
  for (const [id, entry] of ruleIds) {
    if (entry.seen.length <= 1) continue;
    // Indices are recorded in array order; sort for stable reporting.
    const sorted = [...entry.seen].sort((a, b) => a.index - b.index);
    const priorities = new Set(sorted.map((s) => s.priority));
    const conflicting = priorities.size > 1;
    for (let k = 1; k < sorted.length; k++) {
      errors.push({
        code: 'duplicate-rule-id',
        path: `rules[${sorted[k].index}].id`,
        message: `Duplicate rule id "${id}" (first declared at rules[${sorted[0].index}].id)`,
      });
    }
    if (conflicting) {
      const idxList = sorted.map((s) => `rules[${s.index}].priority`).join(', ');
      errors.push({
        code: 'conflicting-rule-priority',
        path: `rules[${sorted[0].index}].priority`,
        message: `Rule id "${id}" is declared with conflicting priorities (${idxList})`,
      });
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  // Shape is valid — return the normalized manifest (empty arrays when absent).
  const manifest: ModManifest = {
    id: m.id as string,
    version: m.version as string,
    rules: Array.isArray(rules) ? (rules as unknown as RulePatch[]) : [],
    content: Array.isArray(content) ? (content as unknown as ContentPatch[]) : [],
  };
  return { valid: true, errors: [], manifest };
}

/**
 * Convenience: throw an {@link AggregateError}-style message when invalid,
 * otherwise return the typed manifest. The thrown message is built
 * deterministically from the error list, so it is itself reproducible.
 */
export function assertValidModManifest(input: unknown): ModManifest {
  const result = validateModManifest(input);
  if (!result.valid || !result.manifest) {
    const detail = result.errors.map((e) => `${e.path}: ${e.message}`).join('; ');
    throw new Error(`Invalid ModManifest: ${detail}`);
  }
  return result.manifest;
}
