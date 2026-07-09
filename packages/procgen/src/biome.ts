/**
 * @omega/procgen — deterministic biome classification.
 *
 * `classify` maps a single world sample (normalized coordinates + height +
 * moisture) to a biome label. It is a pure function with no RNG, so the same
 * inputs always yield the same biome — suitable for classifying scatter points
 * after they have been placed.
 *
 * The biome ids intentionally reuse @omega/world-gen's `Biome` so that scatter
 * output lines up with world-gen heightmaps.
 */

import { clamp01 } from '@omega/engine-math';
import { Biome, type BiomeId } from '@omega/world-gen';

export { Biome };
export type { BiomeId };

/** Metadata for each biome, used to drive scatter decisions downstream. */
export interface BiomeInfo {
  id: BiomeId;
  name: string;
  /** Whether this biome supports vegetation scatter (trees/grass). */
  vegetated: boolean;
}

/** Small biome table. Keys are the @omega/world-gen `Biome` ids. */
export const BIOME_TABLE: Record<BiomeId, BiomeInfo> = {
  [Biome.Ocean]: { id: Biome.Ocean, name: 'ocean', vegetated: false },
  [Biome.Beach]: { id: Biome.Beach, name: 'beach', vegetated: false },
  [Biome.Grassland]: { id: Biome.Grassland, name: 'grassland', vegetated: true },
  [Biome.Forest]: { id: Biome.Forest, name: 'forest', vegetated: true },
  [Biome.Desert]: { id: Biome.Desert, name: 'desert', vegetated: false },
  [Biome.Mountain]: { id: Biome.Mountain, name: 'mountain', vegetated: false },
  [Biome.Snow]: { id: Biome.Snow, name: 'snow', vegetated: false },
};

/**
 * Classify a world sample into a biome.
 *
 * Assumes normalized inputs:
 *  - `height`   in [0, 1]  (elevation)
 *  - `moisture` in [0, 1]
 *  - `x`, `y`   in [0, 1]  (normalized world coords; `y` is latitude,
 *                 `x` is longitude, both used for a deterministic climate
 *                 ripple so the bands are not perfectly axis-aligned)
 *
 * Pure and deterministic — no RNG, no clock.
 */
export function classify(
  x: number,
  y: number,
  height: number,
  moisture: number,
): BiomeId {
  const h = clamp01(height);
  const m = clamp01(moisture);
  // Latitude: y=0 warm equator, y=1 cold pole, with a small longitudinal ripple.
  const temp = clamp01(1 - y + 0.06 * Math.sin(x * Math.PI * 2));
  // Longitudinal wetness ripple (pure function of x), small amplitude.
  const wet = clamp01(m + 0.05 * Math.sin(x * Math.PI * 2 + 1.3));

  if (h < 0.3) return Biome.Ocean;
  if (h < 0.35) return Biome.Beach;
  if (h > 0.85) return temp < 0.35 ? Biome.Snow : Biome.Mountain;
  if (temp < 0.2) return Biome.Snow;
  if (wet < 0.3) return Biome.Desert;
  if (wet > 0.62) return Biome.Forest;
  return Biome.Grassland;
}
