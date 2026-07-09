/**
 * @omega/world-gen — planet generator.
 *
 * Produces a deterministic {@link Planet} from a seed: a procedurally-named
 * world with a radius, average temperature, and a biome-weight distribution
 * derived from a small seeded terrain sample. See docs/adr/0001-determinism.md.
 */

import { Rng } from '@omega/engine-core';
import { clamp } from '@omega/engine-math';
import { BIOME_NAMES, BIOME_COUNT, TerrainGenerator } from './terrain.js';

/** Number of distinct biomes (re-exported for convenience). */
export { BIOME_COUNT } from './terrain.js';

/** Syllable tables used to assemble procedural planet names. */
const NAME_PREFIXES = [
  'Zor', 'Vel', 'Kep', 'Ar', 'Thal', 'Nyx', 'Ori', 'Quel', 'Vor', 'Lyr',
  'Xan', 'Bre', 'Cal', 'Dun', 'Esh', 'Fen', 'Gor', 'Halin', 'Ith', 'Jor',
];
const NAME_MIDDLES = [
  'a', 'e', 'i', 'o', 'u', 'ae', 'io', 'yn', 'ar', 'el', 'or', 'an', 'ix', 'um',
];
const NAME_SUFFIXES = [
  'is', 'os', 'ar', 'ex', 'ix', 'or', 'us', 'ath', 'une', 'ara', 'ion', 'eth',
  ' Prime', ' II', ' III', ' Major', ' Minor', ' B', ' C',
];

/** Generate a non-empty procedural name from a seeded Rng. */
export function makePlanetName(rng: Rng): string {
  const prefix = rng.pick(NAME_PREFIXES);
  const syllables = rng.nextInt(1, 2);
  let mid = '';
  for (let i = 0; i < syllables; i++) mid += rng.pick(NAME_MIDDLES);
  const suffix = rng.pick(NAME_SUFFIXES);
  return (prefix + mid + suffix).trim();
}

export interface Planet {
  /** Stable per-system index label, e.g. 'PLN-0003'. */
  id: string;
  seed: number | bigint | string;
  name: string;
  radiusKm: number;
  /** Normalized relative weight per biome id (sums to ~1). */
  biomeWeights: number[];
  avgTempC: number;
}

export interface PlanetOptions {
  /** Index used to build the stable `id` (e.g. position in a system). */
  index?: number;
  /** Override the generated name (mostly for tests). */
  name?: string;
}

/**
 * Generate a single planet deterministically from `seed`.
 *
 * Radius scales with a seeded value; temperature is seeded in a plausible
 * range; biome weights come from a small seeded terrain sample so the planet's
 * overall character (icy, arid, verdant, oceanic) is reproducible.
 */
export class PlanetGenerator {
  private readonly seed: number | bigint | string;
  private readonly index: number;
  private readonly nameOverride?: string;

  constructor(seed: number | bigint | string, opts: PlanetOptions = {}) {
    this.seed = seed;
    this.index = opts.index ?? 0;
    this.nameOverride = opts.name;
  }

  generate(): Planet {
    const rng = new Rng(`planet:${this.seed}`);
    const name = this.nameOverride ?? makePlanetName(rng);

    // Radius: 1,000 – 80,000 km (gas giants and terrestrial alike).
    const radiusKm = Math.round(rng.nextRange(1000, 80000));

    // Average surface temperature: -200C .. +120C.
    const avgTempC = Math.round(rng.nextRange(-200, 120));

    // Biome weights from a small seeded terrain sample.
    const size = 24;
    const terrain = new TerrainGenerator(`planet-biome:${this.seed}`, {
      size,
      octaves: 3,
      frequency: 3,
    }).generate();
    const weights = new Array<number>(BIOME_COUNT).fill(0);
    for (let i = 0; i < terrain.biomeIds.length; i++) {
      weights[terrain.biomeIds[i]!]! += 1;
    }
    const total = weights.reduce((a, b) => a + b, 0) || 1;
    const biomeWeights = weights.map((w) => clamp(w / total, 0, 1));

    const id = `PLN-${String(this.index + 1).padStart(4, '0')}`;

    return {
      id,
      seed: this.seed,
      name,
      radiusKm,
      biomeWeights,
      avgTempC,
    };
  }
}

/** Human-readable label for a biome id (re-export for consumers). */
export function biomeName(id: number): string {
  return BIOME_NAMES[id] ?? 'unknown';
}
