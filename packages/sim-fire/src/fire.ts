/**
 * @omega/sim-fire — deterministic cellular fire spread.
 *
 * A seeded cellular automaton over a vegetation/fuel grid. Each cell is in one
 * of four states (UNBURNED, BURNING, BURNT, WET/nonflammable). Fire spreads to
 * neighbors based on a deterministic ignition probability that depends on:
 *   - local fuel load (vegetation density),
 *   - the coupled environment field (temperature raises, humidity/rain lowers
 *     ignition chance; wind biases spread direction),
 *   - a fixed wind field (shared with @omega/sim-env so fire follows the same
 *     terrain-driven wind).
 *
 * Determinism contract (see docs/adr/0001-determinism.md):
 *   - The ONLY entropy is the engine-core {@link Rng}, advanced in a fixed,
 *     order-deterministic (row-major) sequence each tick. No clock, no
 *     `Math.random`.
 *   - Identical seed + identical initial fuel + identical environment → identical
 *     burn sequence tick-for-tick.
 *
 * Built on:
 *   - @omega/engine-core (Rng, World, SystemStage)
 *   - @omega/engine-math (clamp01, lerp)
 *   - @omega/sim-env (EnvField — read-only coupling)
 */

import { Rng } from '@omega/engine-core';
import { clamp01 } from '@omega/engine-math';
import type { EnvField } from '@omega/sim-env';

/** Cell states for the fire automaton. */
export const FireState = {
  /** Vegetation present, not yet burned. */
  Unburned: 0,
  /** Actively burning this tick. */
  Burning: 1,
  /** Already consumed — cannot burn again. */
  Burnt: 2,
  /** Non-flammable (water / bare rock) — never ignites. */
  Wet: 3,
} as const;

export type FireStateId = (typeof FireState)[keyof typeof FireState];

export const COMP_FIRE_FIELD = 'FireField';

export interface FireFieldOptions {
  seed: number | bigint | string;
  /** Grid resolution (NxN). Should match the environment field. */
  gridSize: number;
  /** Base per-tick ignition probability for a burning neighbor (0..1). */
  baseSpread?: number;
  /** Temperature above which ignition is strongly favored (normalized [0,1]). */
  tempIgnitionThreshold?: number;
  /** Humidity above which ignition is suppressed (normalized [0,1]). */
  humiditySuppression?: number;
  /** How many ticks a cell burns before turning to Burnt. */
  burnDuration?: number;
  /** Wind influence on directional spread bias (0..1). */
  windInfluence?: number;
  /** Mean vegetation fuel load (0..1) used to seed the fuel grid. */
  fuelMean?: number;
}

export interface FireField {
  n: number;
  tick: number;
  /** Current fire state per cell. */
  state: Uint8Array;
  /** Remaining fuel (vegetation) per cell in [0,1]. */
  fuel: Float32Array;
  /** Remaining burn ticks for currently-burning cells. */
  burnTimer: Uint8Array;
  /** Count of currently-burning cells (cheap live metric). */
  burningCount: number;
  /** Cumulative cells that have burned at least once. */
  totalBurnt: number;
  /** Static wind field shared with the environment (cells/sec). */
  windX: Float32Array;
  windY: Float32Array;
}

/** 8-neighborhood offsets (row-major, y-down). */
const NEIGHBORS: ReadonlyArray<readonly [number, number]> = [
  [-1, 0], [1, 0], [0, -1], [0, 1],   // cardinal
  [-1, -1], [-1, 1], [1, -1], [1, 1], // diagonal
];

/**
 * Seed the fuel grid deterministically from a seed + a terrain land mask.
 * Land cells get vegetation fuel; non-land (ocean/mountain rock) become Wet.
 */
export function createFireField(
  opts: FireFieldOptions,
  landMask?: Uint8Array,
): FireField {
  const n = opts.gridSize;
  const rng = new Rng(`fire-fuel:${opts.seed}`);
  const fuelMean = opts.fuelMean ?? 0.6;

  const state = new Uint8Array(n * n);
  const fuel = new Float32Array(n * n);
  const burnTimer = new Uint8Array(n * n);

  for (let i = 0; i < n * n; i++) {
    const isLand = landMask ? landMask[i] === 1 : true;
    if (!isLand) {
      state[i] = FireState.Wet;
      fuel[i] = 0;
    } else {
      // Deterministic fuel: mean +/- a stable jitter, clamped.
      const f = clamp01(fuelMean + (rng.nextF64() - 0.5) * 0.4);
      fuel[i] = f;
      state[i] = f < 0.08 ? FireState.Wet : FireState.Unburned;
    }
  }

  // Wind field is a static, terrain-independent swirl seeded deterministically.
  const wrng = new Rng(`fire-wind:${opts.seed}`);
  const windX = new Float32Array(n * n);
  const windY = new Float32Array(n * n);
  const angle = wrng.nextRange(0, Math.PI * 2);
  const strength = 0.5;
  for (let i = 0; i < n * n; i++) {
    // A smooth, deterministic prevailing wind with a little spatial variation.
    const phase = (i % n) * 0.3 + Math.floor(i / n) * 0.2;
    windX[i] = Math.cos(angle + phase) * strength;
    windY[i] = Math.sin(angle + phase) * strength;
  }

  return {
    n, tick: 0,
    state, fuel, burnTimer,
    burningCount: 0, totalBurnt: 0,
    windX, windY,
  };
}

/** Ignite a single cell (deterministic — caller decides which). Returns true if it caught. */
export function ignite(
  field: FireField,
  x: number,
  y: number,
  burnDuration = 3,
): boolean {
  const i = y * field.n + x;
  if (field.state[i] !== FireState.Unburned) return false;
  if (field.fuel[i]! <= 0) return false;
  field.state[i] = FireState.Burning;
  field.burnTimer[i] = burnDuration;
  field.burningCount++;
  return true;
}

/**
 * Advance the fire automaton by one fixed tick. Order-deterministic (row-major):
 * first compute the next-state for every cell from the CURRENT state (read-only),
 * then commit. Ignition probability for a cell is a pure function of its current
 * neighbors + the coupled environment + the static wind, compared against the
 * next deterministic RNG draw.
 */
export function stepFireField(
  field: FireField,
  dt: number,
  opts: FireFieldOptions,
  env?: EnvField,
): void {
  const n = field.n;
  // baseSpread is a per-second ignition *rate*; scale by the fixed dt so the
  // probability per tick is frame-rate independent yet deterministic.
  const baseSpread = (opts.baseSpread ?? 0.25) * dt * 30; // ~0.25 at 30Hz baseline
  const tempThreshold = opts.tempIgnitionThreshold ?? 0.6;
  const humiditySupp = opts.humiditySuppression ?? 0.5;
  const burnDuration = opts.burnDuration ?? 3;
  const windInfluence = opts.windInfluence ?? 0.8;

  const rng = new Rng(`fire-step:${opts.seed}:${field.tick}`);

  const nextState = field.state.slice();
  const nextBurn = field.burnTimer.slice();
  let burning = 0;
  let newlyBurnt = 0;

  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const i = y * n + x;
      const s = field.state[i]!;

      if (s === FireState.Burning) {
        // Consume fuel; decrement burn timer; when spent → Burnt.
        const remain = field.burnTimer[i]! - 1;
        if (remain <= 0) {
          nextState[i] = FireState.Burnt;
          nextBurn[i] = 0;
          newlyBurnt++;
        } else {
          nextBurn[i] = remain;
          burning++;
        }
        continue;
      }

      if (s !== FireState.Unburned) continue; // Burnt / Wet never ignite.

      // Count burning neighbors with a wind-biased weight.
      let ignitionPressure = 0;
      for (const [dy, dx] of NEIGHBORS) {
        const ny = y + dy;
        const nx = x + dx;
        if (nx < 0 || nx >= n || ny < 0 || ny >= n) continue;
        const ni = ny * n + nx;
        if (field.state[ni] !== FireState.Burning) continue;
        // Base contribution from this burning neighbor.
        let w = 0.5; // diagonal weight
        if (dx === 0 || dy === 0) w = 1; // cardinal stronger
        // Wind bias: if wind blows FROM the neighbor TOWARD this cell, boost.
        const wx = field.windX[i]!;
        const wy = field.windY[i]!;
        const towardX = x - nx; // direction from neighbor to this cell
        const towardY = y - ny;
        const dirLen = Math.hypot(towardX, towardY) || 1;
        const align = (wx * towardX + wy * towardY) / dirLen; // -1..1
        w *= 1 + windInfluence * align;
        ignitionPressure += Math.max(0, w);
      }

      if (ignitionPressure <= 0) continue;

      // Environment coupling: temperature raises, humidity lowers chance.
      let p = baseSpread * ignitionPressure;
      if (env) {
        const t = env.temperature[i]!;
        const h = env.humidity[i]!;
        if (t > tempThreshold) p *= 1 + (t - tempThreshold) * 2;
        if (h > humiditySupp) p *= 1 - (h - humiditySupp);
        p = clamp01(p);
      }
      // Fuel load scales probability.
      p *= clamp01(field.fuel[i]! + 0.2);

      // Deterministic draw: identical seed+structure → identical outcome.
      const roll = rng.nextF64();
      if (roll < p) {
        nextState[i] = FireState.Burning;
        nextBurn[i] = burnDuration;
        burning++;
      }
    }
  }

  field.state = nextState;
  field.burnTimer = nextBurn;
  field.burningCount = burning;
  field.totalBurnt += newlyBurnt;
  field.tick++;
}
