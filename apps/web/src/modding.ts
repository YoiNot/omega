/**
 * apps/web — deterministic modding glue for the live demo.
 *
 * Thin adapter between the browser UI and @omega/modding. It applies a
 * {@link ModManifest} to the demo's running engine-core world (the same world
 * the time-core scheduler steps), and exposes byte-stable file I/O via
 * `loadModManifest`/`saveModManifest` (no clock, no randomness — identical
 * manifest + identical world ⇒ identical result).
 *
 * The applied world is `demo.coreWorld`, the engine-core `World` the physics
 * simulation reads every fixed step. A rule patch that edits `PhysicsBody`
 * (e.g. raising `restitution`) therefore changes the next simulation step
 * deterministically — the same input always yields the same trajectory.
 *
 * Every helper here is a pure function of its arguments so it can be exercised
 * headlessly (no DOM) in the vitest suite.
 */

import type { ModManifest, RulePatch, ContentPatch, ModCatalog, MarketplaceListing } from '@omega/modding';
import {
  applyMod,
  saveModManifest,
  loadModManifest,
  manifestToCanonicalString,
  validateModManifest,
  Marketplace,
  loadLocalCatalog,
} from '@omega/modding';
import { snapshotWorld } from '@omega/save';
import type { Demo } from './engine';

/** Component stores of the demo's core world we consider observable for mods. */
export const DEMO_CORE_STORES = ['PhysicsBody'] as const;

/**
 * Apply a manifest to the demo's running core world in place.
 *
 * `applyMod` is deterministic (priority/id-ordered rules, then content patches),
 * so the same manifest applied to the same world always yields the same world.
 * The physics simulation picks up the change on the next fixed step via the
 * time-core scheduler — no separate loop is introduced here.
 */
export function applyManifestToDemo(demo: Demo, manifest: ModManifest): void {
  applyMod(demo.coreWorld, manifest);
}

/**
 * Canonical, key-sorted snapshot string of the demo's core world. Two worlds
 * that are logically equal (modulo object construction order) produce identical
 * strings, so this is the determinism oracle used by the headless tests.
 */
export function snapshotDemoCore(demo: Demo): string {
  return JSON.stringify(snapshotWorld(demo.coreWorld, [...DEMO_CORE_STORES]));
}

/**
 * A small, human-readable default manifest that demonstrates both sides of the
 * system: a rule patch that makes every `PhysicsBody` bouncier (merge, so other
 * fields are preserved) and a content patch that appends one new physics body.
 */
export function defaultManifest(): ModManifest {
  return {
    id: 'web-demo-default',
    version: '1.0.0',
    rules: [
      {
        id: 'bouncier',
        component: 'PhysicsBody',
        strategy: 'merge',
        value: { restitution: 0.95 },
      },
    ],
    content: [
      {
        components: {
          PhysicsBody: { mass: 1, restitution: 0.95, position: [20, 12, 20], radius: 0.6 },
        },
      },
    ],
  };
}

/**
 * Parse a ModManifest from JSON text. Throws a descriptive error if the shape
 * is invalid so the UI can surface it instead of silently corrupting state.
 */
export function parseManifestJson(text: string): ModManifest {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new Error(`Invalid manifest JSON: ${(e as Error).message}`);
  }
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('Manifest must be a JSON object');
  }
  const m = raw as Record<string, unknown>;
  if (typeof m.id !== 'string' || typeof m.version !== 'string') {
    throw new Error('Manifest requires string "id" and "version"');
  }
  const rules = Array.isArray(m.rules) ? m.rules : [];
  const content = Array.isArray(m.content) ? m.content : [];
  if (rules.length > 0) {
    for (const r of rules) {
      const rule = r as Partial<RulePatch>;
      if (typeof rule.id !== 'string' || typeof rule.component !== 'string') {
        throw new Error('Each rule needs string "id" and "component"');
      }
      if (rule.strategy !== 'merge' && rule.strategy !== 'replace') {
        throw new Error('Rule "strategy" must be "merge" or "replace"');
      }
      if (typeof rule.value !== 'object' || rule.value === null || Array.isArray(rule.value)) {
        throw new Error('Rule "value" must be an object');
      }
    }
  }
  if (content.length > 0) {
    for (const c of content) {
      const patch = c as Partial<ContentPatch>;
      if (typeof patch.components !== 'object' || patch.components === null || Array.isArray(patch.components)) {
        throw new Error('Each content patch needs a "components" object');
      }
    }
  }
  return { id: m.id, version: m.version, rules, content };
}

/** Pretty-printed JSON text for editing in the textarea. */
export function manifestToJson(manifest: ModManifest): string {
  return JSON.stringify(manifest, null, 2);
}

/** Canonical, key-sorted JSON string (stable, order-independent). */
export function manifestToText(manifest: ModManifest): string {
  return manifestToCanonicalString(manifest);
}

/** Serialize a manifest to deterministic bytes for file download. */
export function saveManifestToBytes(manifest: ModManifest): Uint8Array {
  return saveModManifest(manifest);
}

/** Parse a manifest previously written by {@link saveManifestToBytes}. */
export function loadManifestFromBytes(bytes: Uint8Array): ModManifest {
  return loadModManifest(bytes);
}

/**
 * Strictly validate a manifest object (the same oracle used by the build gate).
 * Returns the deterministic error list; the UI can render `errors` directly.
 */
export function validateManifestObj(input: unknown): { valid: boolean; errors: ReadonlyArray<{ code: string; path: string; message: string }> } {
  return validateModManifest(input);
}

/**
 * Browse a mod catalog deterministically (stable by id/version, never by mtime).
 * Mirrors {@link Marketplace.list} but lives here so the panel imports one module.
 */
export function browseMods(catalog: ModCatalog): MarketplaceListing {
  const marketplace = new Marketplace(catalog);
  return marketplace.list();
}

/** Build a {@link Marketplace} from a JSON catalog blob (local stub, no server). */
export function loadModCatalog(raw: unknown): Marketplace {
  return loadLocalCatalog(raw);
}

// Re-export the public manifest types and the new modding tools so UI code can
// reference them from one module (apps/web import surface stays narrow).
export type { ModManifest, RulePatch, ContentPatch } from '@omega/modding';
export {
  validateModManifest,
  Marketplace,
  loadLocalCatalog,
  sandboxMod,
  EVERYWHERE,
  type ModCatalog,
  type MarketplaceListing,
  type MarketplaceEntry,
  type SandboxModManifest,
  type SandboxResult,
  type SandboxChange,
} from '@omega/modding';
