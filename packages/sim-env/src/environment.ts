/**
 * @omega/sim-env — deterministic environment fields.
 *
 * A grid of coupled scalar fields (temperature / humidity / pressure) advanced
 * every fixed simulation tick by a deterministic diffusion + advection step that
 * is driven by the procgen terrain heightfield (used as a static relief that
 * warps wind and cools with elevation).
 *
 * Determinism contract (see docs/adr/0001-determinism.md):
 *   - The only source of entropy is the engine-core {@link Rng}, seeded from the
 *     caller-supplied seed. No clock, no ambient `Math.random`.
 *   - Advection velocity is derived analytically from the heightfield (a static
 *     mass-conserving wind field), so it is a pure function of terrain + tick.
 *   - The update is an explicit, order-deterministic stencil over a flat grid;
 *     two fields started from the same seed + terrain + tick sequence are
 *     bit-identical.
 *
 * Built on:
 *   - @omega/engine-core  (Rng, World, SystemStage)
 *   - @omega/engine-math  (clamp01, lerp, smoothstep)
 *   - @omega/world-gen     (TerrainGenerator — heightfield/biome input)
 */

import { Rng } from '@omega/engine-core';
import { clamp01, lerp, smoothstep } from '@omega/engine-math';
import { TerrainGenerator, BIOME_NAMES } from '@omega/world-gen';

/** Stable component name under which the live environment field lives in the ECS. */
export const COMP_ENV_FIELD = 'EnvField';

export interface EnvFieldOptions {
  /** RNG seed selecting initial perturbation + a stable wind bias. */
  seed: number | bigint | string;
  /** Diffusion coefficient per second for each field (0..0.5 for stability). */
  diffusion?: number;
  /** Advection strength (cells/sec scale) — how strongly wind transports fields. */
  advection?: number;
  /** Mean annual pressure at sea level in [0,1]. */
  pressureSeaLevel?: number;
  /** Lapse-rate cooling of temperature with elevation (per unit elevation in [0,1]). */
  lapseRate?: number;
  /** Per-cell delta applied every second toward the terrain-coupled equilibrium. */
  relaxation?: number;
}

export interface EnvField {
  n: number;
  /** Tick index this field snapshot corresponds to. */
  tick: number;
  temperature: Float32Array;
  humidity: Float32Array;
  pressure: Float32Array;
  /** Static per-cell wind velocity (x, y) in cells/sec, derived from terrain. */
  windX: Float32Array;
  windY: Float32Array;
  /** Normalized elevation [0,1] per cell (coupling source). */
  elevation: Float32Array;
  /** Normalized is-land mask (1 land, 0 ocean) per cell. */
  isLand: Uint8Array;
  /** Equilibrium targets the fields relax toward (terrain-coupled climate). */
  eqTemperature: Float32Array;
  eqHumidity: Float32Array;
  eqPressure: Float32Array;
}

/** Build the static wind field as a mass-preserving rotation of the terrain gradient. */
function buildWind(elevation: Float32Array, n: number): { windX: Float32Array; windY: Float32Array } {
  const windX = new Float32Array(n * n);
  const windY = new Float32Array(n * n);
  // Rotated (divergence-free) gradient → a swirling, terrain-following wind.
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const i = y * n + x;
      const xl = elevation[y * n + Math.max(0, x - 1)]!;
      const xr = elevation[y * n + Math.min(n - 1, x + 1)]!;
      const yt = elevation[Math.max(0, y - 1) * n + x]!;
      const yb = elevation[Math.min(n - 1, y + 1) * n + x]!;
      const gx = (xr - xl) * 0.5;
      const gy = (yb - yt) * 0.5;
      // 90° rotation of the gradient → divergence-free wind.
      windX[i] = -gy;
      windY[i] = gx;
    }
  }
  return { windX, windY };
}

/**
 * Build the terrain-coupled equilibrium field (the climate the dynamics relax to).
 * Pure function of elevation + a stable seed bias → deterministic.
 */
function buildEquilibrium(
  elevation: Float32Array,
  isLand: Uint8Array,
  n: number,
  seed: number | bigint | string,
  pressureSeaLevel: number,
  lapseRate: number,
): { eqTemperature: Float32Array; eqHumidity: Float32Array; eqPressure: Float32Array } {
  const params = new Rng(`env-equil:${seed}`);
  const tempBias = params.nextRange(-0.1, 0.1);
  const humBias = params.nextRange(-0.1, 0.1);
  const pressBias = params.nextRange(-0.05, 0.05);

  const eqTemperature = new Float32Array(n * n);
  const eqHumidity = new Float32Array(n * n);
  const eqPressure = new Float32Array(n * n);

  for (let y = 0; y < n; y++) {
    const lat = y / (n - 1); // 0 = top (north), 1 = bottom (south)
    const latWarmth = 1 - smoothstep(0, 1, Math.abs(lat - 0.5) * 2); // warm at center
    for (let x = 0; x < n; x++) {
      const i = y * n + x;
      const e = elevation[i]!;
      const land = isLand[i]! === 1;
      // Temperature: warm equator + elevation cooling (lapse rate).
      let t = clamp01(latWarmth * 0.8 + tempBias - (land ? e * lapseRate : 0));
      // Humidity: oceans humid, land drier with elevation.
      let h = land ? clamp01(0.45 + humBias - e * 0.4) : 1;
      // Pressure: gentle inverse of elevation + seed bias.
      let p = clamp01(pressureSeaLevel - e * 0.2 + pressBias);
      eqTemperature[i] = t;
      eqHumidity[i] = h;
      eqPressure[i] = p;
    }
  }
  return { eqTemperature, eqHumidity, eqPressure };
}

/** Validate + normalize a heightfield element. */
function isLandCell(e: number): boolean {
  return e > 0.3; // matches TerrainGenerator mid-elevation land band roughly
}

/**
 * Initialize an {@link EnvField} from a procgen terrain (heightfield). Seeds the
 * initial state as a small deterministic perturbation around the equilibrium so
 * the field has something to advect/diffuse. Fully deterministic in (seed, terrain).
 */
export function createEnvField(
  terrain: { width: number; height: number; heights: Float32Array },
  opts: EnvFieldOptions,
): EnvField {
  const n = terrain.width; // assume square grid (world-gen Terrain is NxN)
  if (terrain.height !== n) {
    throw new Error(`createEnvField: expected square grid, got ${terrain.width}x${terrain.height}`);
  }
  const elevation = new Float32Array(n * n);
  const isLand = new Uint8Array(n * n);
  for (let i = 0; i < n * n; i++) {
    elevation[i] = clamp01(terrain.heights[i]!);
    isLand[i] = isLandCell(terrain.heights[i]!) ? 1 : 0;
  }

  const diffusion = opts.diffusion ?? 0.12;
  const advection = opts.advection ?? 0.6;
  const pressureSeaLevel = opts.pressureSeaLevel ?? 0.8;
  const lapseRate = opts.lapseRate ?? 0.45;

  const { windX, windY } = buildWind(elevation, n);
  const { eqTemperature, eqHumidity, eqPressure } = buildEquilibrium(
    elevation, isLand, n, opts.seed, pressureSeaLevel, lapseRate,
  );

  const rng = new Rng(`env-init:${opts.seed}`);
  const temperature = new Float32Array(n * n);
  const humidity = new Float32Array(n * n);
  const pressure = new Float32Array(n * n);
  // Deterministic initial perturbation: +/- a stable amplitude around equilibrium.
  for (let i = 0; i < n * n; i++) {
    temperature[i] = clamp01(eqTemperature[i]! + (rng.nextF64() - 0.5) * diffusion);
    humidity[i] = clamp01(eqHumidity[i]! + (rng.nextF64() - 0.5) * diffusion);
    pressure[i] = clamp01(eqPressure[i]! + (rng.nextF64() - 0.5) * diffusion * 0.5);
  }

  return {
    n, tick: 0,
    temperature, humidity, pressure,
    windX: windX.map((v) => v * advection),
    windY: windY.map((v) => v * advection),
    elevation, isLand,
    eqTemperature, eqHumidity, eqPressure,
  };
}

/**
 * Advance the environment field by one fixed timestep `dt` (seconds).
 *
 * Per cell, in a deterministic order (row-major):
 *   1. Diffuse each scalar to its 4-neighborhood (explicit Laplacian).
 *   2. Advect each scalar along the static wind field (semi-Lagrangian backtrace).
 *   3. Relax toward the terrain-coupled equilibrium (climate pull).
 *
 * The previous state is read-only; a scratch buffer holds the next state, then
 * the two are swapped. This keeps the update a pure function of the current
 * field + dt, so identical inputs → identical outputs.
 */
export function stepEnvField(field: EnvField, dt: number, opts?: EnvFieldOptions): void {
  const n = field.n;
  const { temperature, humidity, pressure, windX, windY, eqTemperature, eqHumidity, eqPressure } = field;
  const diffusion = opts?.diffusion ?? 0.12;
  const relaxation = opts?.relaxation ?? 0.05;

  const nextT = new Float32Array(n * n);
  const nextH = new Float32Array(n * n);
  const nextP = new Float32Array(n * n);

  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const i = y * n + x;
      // --- Diffusion (4-neighbor Laplacian) ---
      const tl = temperature[Math.max(0, y - 1) * n + x]!;
      const tr = temperature[Math.min(n - 1, y + 1) * n + x]!;
      const tlt = temperature[y * n + Math.max(0, x - 1)]!;
      const trt = temperature[y * n + Math.min(n - 1, x + 1)]!;
      const diffT = (tl + tr + tlt + trt - 4 * temperature[i]!) * diffusion;

      const hl = humidity[Math.max(0, y - 1) * n + x]!;
      const hr = humidity[Math.min(n - 1, y + 1) * n + x]!;
      const hlt = humidity[y * n + Math.max(0, x - 1)]!;
      const hrt = humidity[y * n + Math.min(n - 1, x + 1)]!;
      const diffH = (hl + hr + hlt + hrt - 4 * humidity[i]!) * diffusion;

      const pl = pressure[Math.max(0, y - 1) * n + x]!;
      const pr = pressure[Math.min(n - 1, y + 1) * n + x]!;
      const plt = pressure[y * n + Math.max(0, x - 1)]!;
      const prt = pressure[y * n + Math.min(n - 1, x + 1)]!;
      const diffP = (pl + pr + plt + prt - 4 * pressure[i]!) * diffusion;

      // --- Advection (semi-Lagrangian backtrace along static wind) ---
      const sx = x - windX[i]! * dt;
      const sy = y - windY[i]! * dt;
      const advT = sampleBilinear(temperature, n, sx, sy);
      const advH = sampleBilinear(humidity, n, sx, sy);
      const advP = sampleBilinear(pressure, n, sx, sy);

      // --- Relaxation toward terrain-coupled equilibrium ---
      nextT[i] = clamp01(lerp(advT + diffT, eqTemperature[i]!, relaxation));
      nextH[i] = clamp01(lerp(advH + diffH, eqHumidity[i]!, relaxation));
      nextP[i] = clamp01(lerp(advP + diffP, eqPressure[i]!, relaxation));
    }
  }

  field.temperature = nextT;
  field.humidity = nextH;
  field.pressure = nextP;
  field.tick++;
}

/** Bilinear sample of a field at fractional grid coords (clamped to edges). */
function sampleBilinear(field: Float32Array, n: number, fx: number, fy: number): number {
  const cx = clamp01(fx / (n - 1)) * (n - 1);
  const cy = clamp01(fy / (n - 1)) * (n - 1);
  const x0 = Math.floor(cx);
  const y0 = Math.floor(cy);
  const x1 = Math.min(n - 1, x0 + 1);
  const y1 = Math.min(n - 1, y0 + 1);
  const tx = cx - x0;
  const ty = cy - y0;
  const a = field[y0 * n + x0]!;
  const b = field[y0 * n + x1]!;
  const c = field[y1 * n + x0]!;
  const d = field[y1 * n + x1]!;
  return lerp(lerp(a, b, tx), lerp(c, d, tx), ty);
}

/**
 * Convenience: build a terrain from a seed (delegates to @omega/world-gen) and
 * create the coupled environment field in one call.
 */
export function createEnvFieldFromSeed(
  seed: number | bigint | string,
  size: number,
  opts: EnvFieldOptions,
): EnvField {
  const terrain = new TerrainGenerator(seed, { size }).generate();
  return createEnvField(terrain, opts);
}

/** Human-readable per-cell climate summary (used by tests + debug). */
export function describeCell(field: EnvField, x: number, y: number): string {
  const i = y * field.n + x;
  const biome = field.isLand[i] ? 'land' : 'ocean';
  return `${biome} T=${field.temperature[i]!.toFixed(3)} H=${field.humidity[i]!.toFixed(3)} P=${field.pressure[i]!.toFixed(3)}`;
}

export { BIOME_NAMES };
