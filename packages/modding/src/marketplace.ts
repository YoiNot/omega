/**
 * @omega/modding — content marketplace (lightweight, in-memory).
 *
 * A {@link Marketplace} wraps a catalog of {@link ModManifest}s and lets the
 * UI browse them. There is intentionally no server: the default source is a
 * local JSON stub (`loadLocalCatalog` reads a `ModCatalog` blob you supply,
 * e.g. bundled or fetched from disk). The adapter is deterministic — listing
 * always returns the same entries in a stable (id, then version) order, never
 * sorted by load/mtime — so the same catalog yields the same browse view every
 * time, which matches the package's no-clock/no-randomness contract.
 */

import type { ModManifest } from './types.js';
import { validateModManifest } from './validate.js';

/** A catalog is just a named, unordered bag of manifests (the "marketplace files"). */
export interface ModCatalog {
  /** Catalog name, shown in the UI. */
  readonly name: string;
  /** The manifests offered by this catalog (unsorted, may contain invalid ones). */
  readonly manifests: readonly ModManifest[];
}

/** One entry in a {@link MarketplaceListing}: a manifest plus its validation status. */
export interface MarketplaceEntry {
  readonly manifest: ModManifest;
  /** Whether {@link validateModManifest} accepted this manifest. */
  readonly valid: boolean;
  /** Validation error count (handy for UI badges). */
  readonly errorCount: number;
}

/** The deterministic result of browsing a catalog. */
export interface MarketplaceListing {
  readonly catalogName: string;
  /** Stable-sorted list (ascending by id, then by version). */
  readonly entries: readonly MarketplaceEntry[];
}

/**
 * Deterministically order catalog manifests: ascending by `id` (string
 * compare), then by `version` (string compare). Array position in the catalog
 * is intentionally *ignored* so re-ordering the source file never changes the
 * browse order — the sort is purely a function of (id, version).
 */
function stableSort(a: ModManifest, b: ModManifest): number {
  if (a.id !== b.id) return a.id < b.id ? -1 : 1;
  if (a.version !== b.version) return a.version < b.version ? -1 : 1;
  return 0;
}

/**
 * A read-only marketplace over a {@link ModCatalog}.
 *
 * Use {@link loadLocalCatalog} to build one from a JSON blob, or construct it
 * directly with a pre-built catalog. Listing is stable-deterministic.
 */
export class Marketplace {
  private readonly catalog: ModCatalog;

  constructor(catalog: ModCatalog) {
    this.catalog = catalog;
  }

  /** The catalog's display name. */
  get name(): string {
    return this.catalog.name;
  }

  /**
   * List every manifest in the catalog, deterministically sorted by (id,
   * version), with a cheap validation flag per entry. Validation is computed
   * via {@link validateModManifest} so the listing can surface malformed mods
   * without applying them.
   */
  list(): MarketplaceListing {
    const entries: MarketplaceEntry[] = this.catalog.manifests.map((manifest) => {
      const result = validateModManifest(manifest);
      return {
        manifest,
        valid: result.valid,
        errorCount: result.errors.length,
      };
    });
    entries.sort((a, b) => stableSort(a.manifest, b.manifest));
    return { catalogName: this.catalog.name, entries };
  }

  /** Resolve a single manifest by (id, version); `undefined` if not present. */
  get(id: string, version: string): ModManifest | undefined {
    return this.catalog.manifests.find((m) => m.id === id && m.version === version);
  }
}

/**
 * Build a {@link Marketplace} from a JSON catalog blob. `raw` is validated to
 * be an object with a string `name` and a `manifests` array; each element is
 * passed through as a {@link ModManifest} (the per-entry lint happens lazily in
 * {@link Marketplace.list}). Throws a descriptive, deterministic error on a
 * malformed catalog envelope.
 */
export function loadLocalCatalog(raw: unknown): Marketplace {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('Marketplace catalog must be a JSON object');
  }
  const c = raw as Record<string, unknown>;
  if (typeof c.name !== 'string') {
    throw new Error('Marketplace catalog requires a string "name"');
  }
  if (!Array.isArray(c.manifests)) {
    throw new Error('Marketplace catalog requires a "manifests" array');
  }
  const manifests = c.manifests as unknown as ModManifest[];
  return new Marketplace({ name: c.name, manifests });
}
