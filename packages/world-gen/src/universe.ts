/**
 * @omega/world-gen — universe generator + stable catalog of object ids.
 *
 * Produces a deterministic {@link Universe} of 1–4 galaxies. The {@link Catalog}
 * resolves stable hierarchical string ids of the form
 * `GLX-0001/SYS-0042/PLN-0007` for any generated object. See docs/adr/0001-determinism.md.
 */

import { Rng } from '@omega/engine-core';
import { Galaxy, GalaxyGenerator } from './galaxy.js';

export interface Universe {
  seed: number | bigint | string;
  galaxies: Galaxy[];
  /** Total number of catalogued objects (galaxies + systems + planets). */
  catalogSize: number;
}

export interface UniverseOptions {
  /** Override galaxy count (clamped to [1, 4]). */
  galaxyCount?: number;
  /** Systems per galaxy (default 64). */
  systemsPerGalaxy?: number;
}

/**
 * Build a stable id path for a nested object. Pass only the segments you have,
 * e.g. `Catalog.path('GLX-0001', 'SYS-0002')` => 'GLX-0001/SYS-0002'.
 */
export class Catalog {
  static join(...parts: string[]): string {
    return parts.filter((p) => p.length > 0).join('/');
  }

  /** Parse a path back into its component id segments. */
  static split(path: string): string[] {
    return path.split('/').filter((p) => p.length > 0);
  }

  /** Galaxy id from its index. */
  static galaxyId(index: number): string {
    return `GLX-${String(index + 1).padStart(4, '0')}`;
  }

  /** System id from its index. */
  static systemId(index: number): string {
    return `SYS-${String(index + 1).padStart(4, '0')}`;
  }

  /** Planet id from its index. */
  static planetId(index: number): string {
    return `PLN-${String(index + 1).padStart(4, '0')}`;
  }
}

/**
 * Generate a universe deterministically from `seed`.
 *
 * The galaxy count is seeded in [1, 4]; each galaxy is generated independently
 * with its own derived seed and a fixed (or overridden) count of star systems.
 */
export class UniverseGenerator {
  private readonly seed: number | bigint | string;
  private readonly galaxyCount: number;
  private readonly systemsPerGalaxy: number;

  constructor(seed: number | bigint | string, opts: UniverseOptions = {}) {
    const n = opts.galaxyCount ?? new Rng(`universe-count:${seed}`).nextInt(1, 4);
    this.seed = seed;
    this.galaxyCount = Math.min(4, Math.max(1, n));
    this.systemsPerGalaxy = Math.max(1, opts.systemsPerGalaxy ?? 64);
  }

  generate(): Universe {
    const galaxies: Galaxy[] = [];
    for (let g = 0; g < this.galaxyCount; g++) {
      const gseed = `galaxy-${g}:${this.seed}`;
      galaxies.push(
        new GalaxyGenerator(gseed, { index: g, systemCount: this.systemsPerGalaxy }).generate(),
      );
    }

    let catalogSize = galaxies.length;
    for (const gal of galaxies) {
      catalogSize += gal.starSystems.length;
      for (const sys of gal.starSystems) catalogSize += sys.planets.length;
    }

    return {
      seed: this.seed,
      galaxies,
      catalogSize,
    };
  }
}
