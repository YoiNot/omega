/**
 * @omega/world-gen — terrain heightmap + biome classifier.
 *
 * A deterministic heightmap is produced from seeded FBM, then resampled into a
 * moisture/temperature field to classify each cell into one of several biomes.
 * See docs/adr/0001-determinism.md.
 */

import { Rng } from '@omega/engine-core';
import { clamp } from '@omega/engine-math';
import { GradientNoise } from './noise.js';

/** Stable integer ids for biomes. Exposed so consumers / tests can validate ranges. */
export const Biome = {
  Ocean: 0,
  Beach: 1,
  Grassland: 2,
  Forest: 3,
  Desert: 4,
  Mountain: 5,
  Snow: 6,
} as const;

export type BiomeId = (typeof Biome)[keyof typeof Biome];

export const BIOME_NAMES: Record<number, string> = {
  0: 'ocean',
  1: 'beach',
  2: 'grassland',
  3: 'forest',
  4: 'desert',
  5: 'mountain',
  6: 'snow',
};

export const BIOME_COUNT = 7;

export interface TerrainOptions {
  /** Heightmap resolution (NxN). Default 64. */
  size?: number;
  /** FBM octaves for the elevation field. Default 5. */
  octaves?: number;
  /** FBM persistence. Default 0.5. */
  persistence?: number;
  /** FBM lacunarity. Default 2. */
  lacunarity?: number;
  /** Spatial frequency multiplier applied to sample coordinates. Default 4. */
  frequency?: number;
}

export interface Terrain {
  width: number;
  height: number;
  /** Row-major NxN elevation in [minHeight, maxHeight]. */
  heights: Float32Array;
  /** Row-major NxN biome id per cell. */
  biomeIds: Uint8Array;
  /** Row-major NxN normalized moisture in [0, 1]. */
  moisture: Float32Array;
  /** Row-major NxN normalized temperature in [0, 1]. */
  temperature: Float32Array;
  minHeight: number;
  maxHeight: number;
}

/**
 * Generate a deterministic {@link Terrain} from a seed.
 *
 * Height comes from a gradient-noise FBM. Moisture and temperature are
 * independent FBM fields whose global latitude gradient is modulated by the
 * seed, so the world has warm/cold and wet/dry bands. Biomes are classified by
 * height thresholds first (ocean/beach/mountain/snow), then moisture/temperature
 * for the mid elevations.
 */
export class TerrainGenerator {
  private readonly seed: number | bigint | string;
  private readonly size: number;
  private readonly octaves: number;
  private readonly persistence: number;
  private readonly lacunarity: number;
  private readonly frequency: number;

  constructor(seed: number | bigint | string, opts: TerrainOptions = {}) {
    this.seed = seed;
    this.size = Math.max(2, opts.size ?? 64);
    this.octaves = opts.octaves ?? 5;
    this.persistence = opts.persistence ?? 0.5;
    this.lacunarity = opts.lacunarity ?? 2;
    this.frequency = opts.frequency ?? 4;
  }

  generate(): Terrain {
    const n = this.size;
    const heights = new Float32Array(n * n);
    const moisture = new Float32Array(n * n);
    const temperature = new Float32Array(n * n);
    const biomeIds = new Uint8Array(n * n);

    // Three independent seeded noise fields derived from the world seed.
    const elevNoise = new GradientNoise(`terrain-elev:${this.seed}`);
    const moistNoise = new GradientNoise(`terrain-moist:${this.seed}`);
    const tempNoise = new GradientNoise(`terrain-temp:${this.seed}`);

    // Latitude offset so the warm/cold band position varies per seed.
    const rng = new Rng(`terrain-lat:${this.seed}`);
    const tempBias = rng.nextRange(-0.3, 0.3);
    const moistBias = rng.nextRange(-0.2, 0.2);

    let minHeight = Infinity;
    let maxHeight = -Infinity;

    for (let y = 0; y < n; y++) {
      // Latitude in [-1, 1] (poles at the edges).
      const lat = (y / (n - 1)) * 2 - 1;
      for (let x = 0; x < n; x++) {
        const nx = (x / (n - 1)) * this.frequency;
        const ny = (y / (n - 1)) * this.frequency;

        const e = elevNoise.fbm2D(nx, ny, this.octaves, this.persistence, this.lacunarity);
        const m = clamp(
          moistNoise.fbm2D(nx + 11.3, ny - 7.1, this.octaves, this.persistence, this.lacunarity) * 0.5 +
            0.5 +
            moistBias,
          0,
          1,
        );
        // Temperature falls off toward the poles (|lat|) plus noise.
        const t = clamp(
          0.5 * (1 - Math.abs(lat)) +
            tempNoise.fbm2D(nx - 3.7, ny + 5.9, this.octaves, this.persistence, this.lacunarity) * 0.5 +
            0.5 +
            tempBias -
            0.5,
          0,
          1,
        );

        const idx = y * n + x;
        heights[idx] = e;
        moisture[idx] = m;
        temperature[idx] = t;
        // Track range from the *stored* (float32) value so min/max match consumption.
        const stored = heights[idx];
        if (stored < minHeight) minHeight = stored;
        if (stored > maxHeight) maxHeight = stored;
      }
    }

    // Classify biomes from the completed fields.
    for (let i = 0; i < n * n; i++) {
      biomeIds[i] = this.classify(heights[i], moisture[i], temperature[i]);
    }

    // Recompute extents from the *stored* Float32 values so min/max are exactly
    // consistent with what consumers read back (avoids float32/float64 drift).
    minHeight = Infinity;
    maxHeight = -Infinity;
    for (let i = 0; i < heights.length; i++) {
      const h = heights[i]!;
      if (h < minHeight) minHeight = h;
      if (h > maxHeight) maxHeight = h;
    }

    return {
      width: n,
      height: n,
      heights,
      biomeIds,
      moisture,
      temperature,
      minHeight,
      maxHeight,
    };
  }

  private classify(h: number, m: number, t: number): BiomeId {
    // Height thresholds on the [-1, 1] FBM elevation field.
    if (h < -0.35) return Biome.Ocean;
    if (h < -0.25) return Biome.Beach;
    if (h > 0.7) return t < 0.35 ? Biome.Snow : Biome.Mountain;
    // Mid elevations: choose by moisture/temperature.
    if (t < 0.3) return Biome.Snow;
    if (m < 0.3) return Biome.Desert;
    if (m > 0.6 && t > 0.4) return Biome.Forest;
    return Biome.Grassland;
  }
}
