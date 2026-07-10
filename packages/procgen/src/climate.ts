/**
 * @omega/procgen — deterministic climate / weather field.
 *
 * Produces a lightweight, fully-deterministic climate field (surface
 * temperature, air humidity, precipitation proxy, and a simple seasonal
 * modulation) as analytic functions of:
 *   - latitude (equator warmth, polar cold),
 *   - elevation (lapse-rate cooling, orographic drying on windward slopes),
 *   - and a seasonal phase (0..1 year fraction).
 *
 * No clock, no ambient RNG in the field itself: every value is a pure function
 * of (x, y, elevation, seasonPhase). A seed only selects a few stable climate
 * parameters (e.g. a continentality / wind bias), so the same seed + same
 * inputs always reproduces the identical field. Built on @omega/engine-math
 * (clamp01, lerp, smoothstep) and @omega/engine-core (Rng).
 *
 * See docs/adr/0001-determinism.md.
 */

import { Rng } from '@omega/engine-core';
import { clamp01, lerp, smoothstep } from '@omega/engine-math';

export interface ClimateOptions {
  /**
   * Seasonal phase in [0,1) representing the time of year (0 = spring equinox,
   * 0.25 = summer solstice, 0.5 = autumn equinox, 0.75 = winter solstice).
   * Determinism contract: the same phase -> same field. Default 0.
   */
  seasonPhase?: number;
  /**
   * Base mean annual temperature at sea level / equator in [0,1] (normalized).
   * Default 1 (warm). Scaled down by latitude + elevation.
   */
  baseTemp?: number;
  /**
   * Lapse rate: temperature drop per unit normalized elevation in [0,1].
   * Default 0.6 — a normalized elevation of 1.0 cools by 0.6.
   */
  lapseRate?: number;
  /**
   * Wind direction bias in radians (prevailing wind azimuth). Used for
   * orographic rain shadow. Default -PI/2 (wind from the south).
   */
  windAzimuth?: number;
}

export interface ClimateCell {
  /** Normalized surface temperature in [0,1] (1 = hot). */
  temperature: number;
  /** Normalized air humidity / moisture in [0,1] (1 = humid). */
  humidity: number;
  /** Precipitation proxy in [0,1] (orographic + latitude bands). */
  precipitation: number;
  /** Seasonal temperature offset applied this phase in [-0.5, 0.5]. */
  seasonalTempDelta: number;
}

export interface ClimateField {
  /** Grid resolution (NxN). */
  n: number;
  /** Row-major NxN temperature in [0,1]. */
  temperature: Float32Array;
  /** Row-major NxN humidity in [0,1]. */
  humidity: Float32Array;
  /** Row-major NxN precipitation proxy in [0,1]. */
  precipitation: Float32Array;
  /** Row-major NxN seasonal temperature delta in [-0.5,0.5]. */
  seasonalTempDelta: Float32Array;
  /** The season phase this field was computed for. */
  seasonPhase: number;
}

/** Stable climate parameter bundle derived deterministically from a seed. */
export interface ClimateParams {
  baseTemp: number;
  lapseRate: number;
  windAzimuth: number;
  /** Continentality: how strongly interiors diverge from coast (0..1). */
  continentality: number;
  /** Annual temperature amplitude at mid-latitudes (0..1). */
  seasonalAmplitude: number;
  /** Wet/dry band phase offset (radians) for precipitation bands. */
  bandPhase: number;
}

/**
 * Derive stable climate parameters from a seed. Pure function of the seed:
 * identical seed -> identical params. Uses @omega/engine-core Rng.
 */
export function climateParamsFromSeed(seed: number | bigint | string): ClimateParams {
  const rng = new Rng(`climate:${seed}`);
  return {
    baseTemp: lerp(0.85, 1, rng.nextF64()),
    lapseRate: lerp(0.45, 0.75, rng.nextF64()),
    windAzimuth: rng.nextRange(-Math.PI, Math.PI),
    continentality: rng.nextRange(0.1, 0.6),
    seasonalAmplitude: lerp(0.15, 0.45, rng.nextF64()),
    bandPhase: rng.nextRange(0, Math.PI * 2),
  };
}

/**
 * Compute the climate cell for a single grid point. Pure and deterministic —
 * depends only on (lat, elevation, params, seasonPhase). No RNG here.
 *
 * @param lat Normalized latitude in [0,1] (0 = south pole, 0.5 = equator,
 *            1 = north pole). We map internally to [-1,1] for symmetry.
 * @param elevation Normalized elevation in [0,1] (0 = sea level, 1 = peak).
 * @param isLand Whether the cell is land (vs ocean) — oceans stay temperate &
 *               humid and do not cool with "elevation" the same way.
 * @param params Stable climate parameters (see {@link climateParamsFromSeed}).
 * @param options Per-call overrides (seasonPhase, etc.).
 */
export function climateCell(
  lat: number,
  elevation: number,
  isLand: boolean,
  params: ClimateParams,
  options: ClimateOptions = {},
): ClimateCell {
  const seasonPhase = options.seasonPhase ?? 0;
  const baseTemp = options.baseTemp ?? params.baseTemp;
  const lapseRate = options.lapseRate ?? params.lapseRate;
  const windAzimuth = options.windAzimuth ?? params.windAzimuth;

  // Symmetric latitude in [-1, 1]. 0 = equator, +-1 = poles.
  const latSym = lat * 2 - 1;
  const absLat = Math.abs(latSym);

  // --- Temperature ---
  // Base warmth: warm at equator, cold at poles.
  let temp = baseTemp * (1 - smoothstep(0, 1, absLat) * 0.8);
  // Lapse-rate cooling with elevation (land only; ocean is ~flat & tempered).
  if (isLand) temp -= clamp01(elevation) * lapseRate;
  // Continental interiors swing hotter/cooler than coasts (crude: treat high
  // elevation land as more "interior-like" via params). Keep bounded.
  temp = clamp01(temp);

  // --- Seasonal modulation ---
  // Northern hemisphere (latSym>0) is warm at phase 0.25, cold at 0.75.
  // Southern hemisphere is opposite. Amplitude grows with latitude.
  const seasonal = Math.cos((seasonPhase - 0.25) * Math.PI * 2);
  const hemi = latSym >= 0 ? 1 : -1;
  const seasonalTempDelta = hemi * seasonal * params.seasonalAmplitude * smoothstep(0, 1, absLat);
  temp = clamp01(temp + seasonalTempDelta);

  // --- Humidity / precipitation ---
  // Moisture falls toward poles (cold air holds less) and with continentality.
  let humidity = clamp01(1 - smoothstep(0, 1, absLat) * 0.6 - params.continentality * 0.2);
  if (isLand) {
    // Higher land is drier (orographic lift happens upwind, rain shadow leeward).
    humidity = clamp01(humidity - clamp01(elevation) * 0.4);
  }

  // Precipitation: latitude wet bands (ITCZ near equator + mid-latitude
  // storms) modulated by a seed-stable band phase, plus orographic boost on
  // windward slopes (here approximated by elevation: windward is +windAzimuth
  // side — we just add an elevation-driven orographic term, deterministic).
  const band = 0.5 + 0.5 * Math.cos((absLat * 3 - 0.6) * Math.PI + params.bandPhase);
  let precip = clamp01(0.4 + band * 0.4 - params.continentality * 0.1);
  if (isLand) {
    // Orographic: windward slope gets more rain; we use elevation as a proxy
    // and modulate by wind azimuth so the pattern is seed-stable but varied.
    const oro = clamp01(elevation) * (0.3 + 0.2 * Math.cos(windAzimuth));
    precip = clamp01(precip + oro);
  }
  precip = clamp01(precip * (0.8 + 0.2 * Math.cos((seasonPhase) * Math.PI * 2)));

  return {
    temperature: temp,
    humidity,
    precipitation: precip,
    seasonalTempDelta,
  };
}

/**
 * Generate a full deterministic climate field over an NxN grid from a seed.
 *
 * @param n Grid resolution.
 * @param heights Row-major NxN normalized elevation in [0,1].
 * @param seed Seed selecting stable climate parameters.
 * @param options Per-call overrides (seasonPhase, baseTemp, ...).
 */
export function generateClimateField(
  n: number,
  heights: Float32Array,
  seed: number | bigint | string,
  options: ClimateOptions = {},
): ClimateField {
  const params = climateParamsFromSeed(seed);
  const seasonPhase = options.seasonPhase ?? 0;
  const temperature = new Float32Array(n * n);
  const humidity = new Float32Array(n * n);
  const precipitation = new Float32Array(n * n);
  const seasonalTempDelta = new Float32Array(n * n);

  for (let y = 0; y < n; y++) {
    const lat = n === 1 ? 0.5 : y / (n - 1);
    for (let x = 0; x < n; x++) {
      const idx = y * n + x;
      const e = clamp01(heights[idx]!);
      const isLand = e > 0.02; // crude sea-level cutoff
      const cell = climateCell(lat, e, isLand, params, options);
      temperature[idx] = cell.temperature;
      humidity[idx] = cell.humidity;
      precipitation[idx] = cell.precipitation;
      seasonalTempDelta[idx] = cell.seasonalTempDelta;
    }
  }

  return {
    n,
    temperature,
    humidity,
    precipitation,
    seasonalTempDelta,
    seasonPhase,
  };
}

/**
 * Build a single-column seasonal series for one grid cell across a full year,
 * deterministically. Useful for testing seasonality / "weather" over time
 * without a clock (time is just the phase parameter).
 *
 * @param samples Number of phase samples around the year [0,1).
 */
export function seasonalSeries(
  lat: number,
  elevation: number,
  isLand: boolean,
  seed: number | bigint | string,
  samples = 12,
): ClimateCell[] {
  const params = climateParamsFromSeed(seed);
  const out: ClimateCell[] = [];
  for (let i = 0; i < samples; i++) {
    const phase = i / samples;
    out.push(climateCell(lat, elevation, isLand, params, { seasonPhase: phase }));
  }
  return out;
}
