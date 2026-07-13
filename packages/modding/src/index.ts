/**
 * @omega/modding — deterministic, data-driven world modding.
 *
 * Build a {@link ModManifest} (rules that overlay/replace components + content
 * that adds entities), then apply it with {@link applyMod}. Serialize/load it
 * with {@link saveModManifest}/{@link loadModManifest} for byte-stable,
 * reproducible mods. No clock, no randomness — same manifest + same world =
 * same result.
 */

export type {
  ModManifest,
  RulePatch,
  RuleStrategy,
  ContentPatch,
  ModdableWorld,
} from './types.js';
export { canonicalStringify, canonicalize } from './canon.js';
export { sortRules, applyMod } from './apply.js';
export {
  saveModManifest,
  loadModManifest,
  manifestToCanonicalString,
} from './serialize.js';
export {
  validateModManifest,
  assertValidModManifest,
  type ValidationError,
  type ValidationResult,
} from './validate.js';
export {
  Marketplace,
  loadLocalCatalog,
  type ModCatalog,
  type MarketplaceEntry,
  type MarketplaceListing,
} from './marketplace.js';
export {
  sandboxMod,
  EVERYWHERE,
  type SandboxModManifest,
  type SandboxChange,
  type SandboxResult,
  type Everywhere,
} from './sandbox.js';
