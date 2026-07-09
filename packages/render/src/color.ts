import { clamp, clamp01, lerp } from '@omega/engine-math';

/** RGBA color as 4 values in [0, 255]. */
export type RGBA = [number, number, number, number];

interface ColorStop {
  t: number;      // position in [0,1]
  color: RGBA;    // [r,g,b,a]
}

/**
 * Maps a normalized height in [0,1] to an RGBA color using a list of ordered
 * stops via linear interpolation. Also exposes a discrete biome palette.
 */
export class ColorGradient {
  private stops: ColorStop[];

  constructor(stops?: ColorStop[]) {
    // deep water -> shallow -> sand -> grass -> rock -> snow
    this.stops = stops ?? [
      { t: 0.0, color: [10, 30, 90, 255] },   // deep water
      { t: 0.35, color: [40, 110, 180, 255] }, // shallow water
      { t: 0.42, color: [225, 205, 140, 255] }, // sand
      { t: 0.6, color: [70, 150, 60, 255] },   // grass
      { t: 0.8, color: [120, 110, 100, 255] }, // rock
      { t: 1.0, color: [250, 250, 255, 255] }, // snow
    ];
  }

  /**
   * Sample the gradient at normalized height `t` (clamped to [0,1]).
   * Returns a fresh RGBA tuple with integer channels in [0,255].
   */
  sample(t: number): RGBA {
    const x = clamp01(t);
    const s = this.stops;
    if (x <= s[0].t) return [...s[0].color] as RGBA;
    const last = s[s.length - 1];
    if (x >= last.t) return [...last.color] as RGBA;

    for (let i = 0; i < s.length - 1; i++) {
      const a = s[i];
      const b = s[i + 1];
      if (x >= a.t && x <= b.t) {
        const span = b.t - a.t;
        const f = span > 0 ? (x - a.t) / span : 0;
        return [
          Math.round(lerp(a.color[0], b.color[0], f)),
          Math.round(lerp(a.color[1], b.color[1], f)),
          Math.round(lerp(a.color[2], b.color[2], f)),
          Math.round(lerp(a.color[3], b.color[3], f)),
        ];
      }
    }
    return [...last.color] as RGBA;
  }

  /** Discrete biome palette keyed by integer biome id. */
  biomeColor(biomeId: number): RGBA {
    const biome: Record<number, RGBA> = {
      0: [10, 30, 90, 255],     // water
      1: [225, 205, 140, 255],  // beach/sand
      2: [70, 150, 60, 255],    // grass
      3: [120, 110, 100, 255],  // rock
      4: [250, 250, 255, 255],  // snow
      5: [60, 140, 200, 255],   // shallow
    };
    return biome[biomeId] ?? [255, 0, 255, 255] as RGBA; // magenta = unknown
  }

  /** Expose the raw stops (read-only use). */
  getStops(): readonly ColorStop[] {
    return this.stops;
  }
}

/** Clamp helper re-export for convenience in tests. */
export function clampByte(v: number): number {
  return Math.round(clamp(v, 0, 255));
}
