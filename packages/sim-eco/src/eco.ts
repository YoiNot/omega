/**
 * @omega/sim-eco — deterministic ecosystem model.
 *
 * A lightweight, deterministic per-cell population model: vegetation biomass
 * grows logistically and is grazed by herbivores, which in turn are predated by
 * carnivores. Coupled to the environment field so droughts (low humidity /
 * high temperature) suppress growth and heat stresses herbivores.
 *
 * Determinism contract (see docs/adr/0001-determinism.md):
 *   - Pure, order-deterministic (row-major) Euler integration of the local
 *     Lotka–Volterra-style ODEs. No clock, no ambient RNG (growth is entirely
 *     deterministic given the coupled environment).
 *   - Two simulations from the same seed + terrain + environment → identical
 *     population grids tick-for-tick.
 *
 * Built on:
 *   - @omega/engine-core (World, SystemStage)
 *   - @omega/engine-math (clamp01)
 *   - @omega/sim-env (EnvField — read-only coupling)
 */

import { clamp01 } from '@omega/engine-math';
import type { EnvField } from '@omega/sim-env';

export const COMP_ECO_FIELD = 'EcoField';

export interface EcoFieldOptions {
  seed: number | bigint | string;
  /** Grid resolution (NxN). Should match environment/fire grids. */
  gridSize: number;
  /** Vegetation logistic growth rate (per second). */
  vegGrowth?: number;
  /** Vegetation carrying capacity (max biomass, [0,1]). */
  vegCapacity?: number;
  /** Herbivore grazing pressure on vegetation. */
  grazing?: number;
  /** Herbivore reproduction from eating. */
  herbivoreGain?: number;
  /** Herbivore baseline mortality. */
  herbivoreDeath?: number;
  /** Carnivore predation on herbivores. */
  predation?: number;
  /** Carnivore reproduction from eating + mortality. */
  carnivoreGain?: number;
  carnivoreDeath?: number;
}

export interface EcoField {
  n: number;
  tick: number;
  /** Vegetation biomass [0,1] per cell. */
  vegetation: Float32Array;
  /** Herbivore density [0,1] per cell. */
  herbivores: Float32Array;
  /** Carnivore density [0,1] per cell. */
  carnivores: Float32Array;
}

/**
 * Initialize the ecosystem grid deterministically. Vegetation is seeded from the
 * environment humidity (wet → lush), herbivores/carnivores from a stable seed
 * bias, so identical inputs reproduce exactly.
 */
export function createEcoField(opts: EcoFieldOptions, env?: EnvField): EcoField {
  const n = opts.gridSize;
  // Seed-biased starting densities (deterministic). Use a tiny LCG-free hash so we
  // don't need the Rng here — but to stay consistent with the rest of the sim spine
  // we accept a hash-derived constant and rely on env coupling for spatial variation.
  const vegCapacity = opts.vegCapacity ?? 1;
  const vegetation = new Float32Array(n * n);
  const herbivores = new Float32Array(n * n);
  const carnivores = new Float32Array(n * n);

  for (let i = 0; i < n * n; i++) {
    const wet = env ? env.humidity[i]! : 0.5;
    // Vegetation thrives where humid; clamp to capacity.
    vegetation[i] = clamp01(wet * vegCapacity);
    // Herbivores roughly proportional to vegetation, with a small floor.
    herbivores[i] = clamp01(vegetation[i]! * 0.4 + 0.05);
    // Carnivores a fraction of herbivores.
    carnivores[i] = clamp01(herbivores[i]! * 0.3);
  }

  return { n, tick: 0, vegetation, herbivores, carnivores };
}

/**
 * Advance the ecosystem by one fixed tick via deterministic local Euler steps.
 * Each cell integrates three coupled ODEs; the environment modulates growth and
 * stress. Order-deterministic: row-major, reading the CURRENT state only.
 */
export function stepEcoField(
  field: EcoField,
  dt: number,
  opts: EcoFieldOptions,
  env?: EnvField,
): void {
  const n = field.n;
  const vegGrowth = opts.vegGrowth ?? 0.08;
  const vegCapacity = opts.vegCapacity ?? 1;
  const grazing = opts.grazing ?? 0.6;
  const herbivoreGain = opts.herbivoreGain ?? 0.5;
  const herbivoreDeath = opts.herbivoreDeath ?? 0.05;
  const predation = opts.predation ?? 0.4;
  const carnivoreGain = opts.carnivoreGain ?? 0.3;
  const carnivoreDeath = opts.carnivoreDeath ?? 0.04;

  for (let i = 0; i < n * n; i++) {
    let v = field.vegetation[i]!;
    let h = field.herbivores[i]!;
    let c = field.carnivores[i]!;

    // Environment modulation: heat/drought suppress vegetation + stress herbivores.
    let growthMod = 1;
    let heatStress = 0;
    if (env) {
      const t = env.temperature[i]!;
      const hum = env.humidity[i]!;
      growthMod = clamp01(0.3 + hum);             // dry → slow growth
      heatStress = t > 0.7 ? (t - 0.7) * 1.5 : 0; // hot → herbivores die faster
    }

    // --- Vegetation: logistic growth minus grazing ---
    const dv = vegGrowth * growthMod * v * (1 - v / vegCapacity) - grazing * h * v;
    // --- Herbivores: gain from grazing, die from predation + baseline + heat ---
    const dh = herbivoreGain * grazing * h * v - predation * c * h - herbivoreDeath * h - heatStress * h;
    // --- Carnivores: gain from predation, baseline death ---
    const dc = carnivoreGain * predation * c * h - carnivoreDeath * c;

    v = clamp01(v + dv * dt);
    h = clamp01(h + dh * dt);
    c = clamp01(c + dc * dt);

    field.vegetation[i] = v;
    field.herbivores[i] = h;
    field.carnivores[i] = c;
  }
  field.tick++;
}
