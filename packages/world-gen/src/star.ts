/**
 * @omega/world-gen — star system generator.
 *
 * Produces a deterministic {@link StarSystem}: a star (spectral class chosen
 * from a seeded distribution) and 1–12 planets placed on Titius–Bode-ish,
 * strictly increasing orbital radii. See docs/adr/0001-determinism.md.
 */

import { Rng } from '@omega/engine-core';
import { makePlanetName, Planet, PlanetGenerator } from './planet.js';

/** Spectral classes with rough temperature bands and relative occurrence weights. */
export interface SpectralClassInfo {
  code: string;
  /** Approximate effective temperature (K). */
  tempK: number;
  /** Relative weight in the stellar population. */
  weight: number;
}

export const SPECTRAL_CLASSES: SpectralClassInfo[] = [
  { code: 'O', tempK: 35000, weight: 1 },
  { code: 'B', tempK: 20000, weight: 3 },
  { code: 'A', tempK: 9000, weight: 8 },
  { code: 'F', tempK: 7000, weight: 16 },
  { code: 'G', tempK: 5700, weight: 24 },
  { code: 'K', tempK: 4500, weight: 30 },
  { code: 'M', tempK: 3200, weight: 50 },
];

/** Pick a spectral class via weighted sampling from a seeded Rng. */
export function pickSpectralClass(rng: Rng): SpectralClassInfo {
  const total = SPECTRAL_CLASSES.reduce((a, c) => a + c.weight, 0);
  let r = rng.nextRange(0, total);
  for (const c of SPECTRAL_CLASSES) {
    r -= c.weight;
    if (r <= 0) return c;
  }
  return SPECTRAL_CLASSES[SPECTRAL_CLASSES.length - 1]!;
}

export interface StarSystem {
  /** Stable per-galaxy index label, e.g. 'SYS-0042'. */
  id: string;
  seed: number | bigint | string;
  starName: string;
  spectralClass: string;
  /** Effective temperature in Kelvin of the primary star. */
  tempK: number;
  planets: Planet[];
  /** Strictly increasing orbital radii (AU), one per planet, innermost first. */
  orbitalRadii: number[];
}

export interface StarSystemOptions {
  index?: number;
  name?: string;
}

/**
 * Generate a star system deterministically from `seed`.
 *
 * - Planet count is seeded in [1, 12].
 * - Orbital radii follow a Titius–Bode progression `a0 * r^(k)` with seeded
 *   jitter, guaranteeing strictly increasing, positive values.
 */
export class StarSystemGenerator {
  private readonly seed: number | bigint | string;
  private readonly index: number;
  private readonly nameOverride?: string;

  constructor(seed: number | bigint | string, opts: StarSystemOptions = {}) {
    this.seed = seed;
    this.index = opts.index ?? 0;
    this.nameOverride = opts.name;
  }

  generate(): StarSystem {
    const rng = new Rng(`star:${this.seed}`);
    const starName = this.nameOverride ?? makePlanetName(rng);
    const star = pickSpectralClass(rng);

    const count = rng.nextInt(1, 12);

    // Titius–Bode-ish progression.
    const a0 = rng.nextRange(0.3, 0.6); // AU for innermost orbit
    const ratio = rng.nextRange(1.4, 1.8); // geometric growth factor
    const radii: number[] = [];
    let prev = 0;
    for (let i = 0; i < count; i++) {
      const base = a0 * Math.pow(ratio, i);
      // Deterministic jitter, always keeps strictly increasing.
      const jitter = rng.nextRange(0.9, 1.1);
      let r = base * jitter;
      if (r <= prev) r = prev + 0.05;
      radii.push(r);
      prev = r;
    }

    const planets: Planet[] = radii.map((_, i) => {
      const pseed = `planet-${i}:${this.seed}`;
      const pg = new PlanetGenerator(pseed, { index: i });
      const planet = pg.generate();
      planet.seed = pseed;
      return planet;
    });

    const id = `SYS-${String(this.index + 1).padStart(4, '0')}`;

    return {
      id,
      seed: this.seed,
      starName,
      spectralClass: star.code,
      tempK: star.tempK,
      planets,
      orbitalRadii: radii,
    };
  }
}
