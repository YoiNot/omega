/**
 * @omega/sim-econ — deterministic regional resource economy.
 *
 * A per-cell (per-"region") resource balance model. Each region holds storage
 * of a fixed set of goods (food / wood / fiber) and derives PRODUCTION directly
 * from the coupled @omega/sim-eco ecosystem cell (vegetation + herbivores) while
 * CONSUMPTION is driven by a per-region demand (population pressure). Storage
 * accumulates the net balance each fixed tick, clamped to a per-good capacity.
 *
 * Determinism contract (see docs/adr/0001-determinism.md):
 *   - The only entropy source is the engine-core {@link Rng}, used ONCE at field
 *     creation to lay out the initial storage + demand spatially. No clock, no
 *     ambient `Math.random` in the stepping core.
 *   - Given the same seed + same ecosystem field, `stepEconomyField` reproduces
 *     the storage grid tick-for-tick (the step is a pure function of the current
 *     eco cell + demand + params).
 *
 * Built on:
 *   - @omega/engine-core (Rng)
 *   - @omega/engine-math (clamp, clamp01)
 *   - @omega/sim-eco      (EcoField — read-only production coupling)
 */

import { Rng } from '@omega/engine-core';
import { clamp, clamp01 } from '@omega/engine-math';
import type { EcoField } from '@omega/sim-eco';

/** The goods traded/produced by the economy. Closed, ordered set. */
export type GoodKey = 'food' | 'wood' | 'fiber';

export const DEFAULT_GOODS: readonly GoodKey[] = ['food', 'wood', 'fiber'];

export const COMP_ECON_FIELD = 'EconField';

export interface EconomyOptions {
  seed: number | bigint | string;
  /** Grid resolution (NxN). Should match eco/env/fire grids. */
  gridSize: number;
  /** Goods present in the economy. Default ['food','wood','fiber']. */
  goods?: readonly GoodKey[];

  // --- Production rates (per eco-cell state per second) ---
  /** Food harvested from vegetation biomass. */
  foodVegRate?: number;
  /** Food from herbivores (livestock/foraging). */
  foodHerbRate?: number;
  /** Wood from mature vegetation (forestry). */
  woodRate?: number;
  /** Fiber (cloth/hide) from vegetation. */
  fiberVegRate?: number;
  /** Fiber from herbivores (wool/hide). */
  fiberHerbRate?: number;

  // --- Consumption per demand unit per second ---
  foodConsume?: number;
  woodConsume?: number;
  fiberConsume?: number;

  /** Per-good storage capacity (hard clamp). Default 10. */
  storageCapacity?: number;
  /** Population pressure base; demand[i] scales this by local herbivores. */
  demandBase?: number;
}

export interface EconomyField {
  n: number;
  tick: number;
  goods: readonly GoodKey[];
  /** Storage per cell per good. Length n*n*G, index = cell*n*n? NO: idx = cell*G + g. */
  storage: Float32Array;
  /** Per-cell population pressure (consumption driver). Length n*n. */
  demand: Float32Array;
  /** Per-cell per-good consumption target (last step). Length n*n*G. */
  demandByGood: Float32Array;
  /** Per-cell per-good net production (last step, after clamp). Length n*n*G. */
  netProduction: Float32Array;
}

/** Map a (cell, goodIndex) pair to its flat storage index. */
export function storageIndex(cell: number, g: number): number {
  return cell * 3 + g; // G is fixed at 3 (DEFAULT_GOODS)
}

/** Create the economy field deterministically from a seed (+ optional eco for spatial demand). */
export function createEconomyField(opts: EconomyOptions, eco?: EcoField): EconomyField {
  const n = opts.gridSize;
  const goods = opts.goods ?? DEFAULT_GOODS;
  if (goods.length !== DEFAULT_GOODS.length) {
    throw new Error('sim-econ: only the default 3-good set (food/wood/fiber) is supported');
  }
  const G = goods.length;
  const capacity = opts.storageCapacity ?? 10;
  const demandBase = opts.demandBase ?? 1;

  const storage = new Float32Array(n * n * G);
  const demand = new Float32Array(n * n);
  const demandByGood = new Float32Array(n * n * G);
  const netProduction = new Float32Array(n * n * G);

  // Seed initial storage deterministically (spatial variation from the seed).
  const rng = new Rng(`econ-init:${opts.seed}`);
  for (let i = 0; i < n * n; i++) {
    // Demand follows local herbivores (settlements cluster on grazing land).
    const h = eco ? eco.herbivores[i]! : 0.5;
    demand[i] = clamp01(demandBase * (0.3 + 0.7 * h));
    for (let g = 0; g < G; g++) {
      storage[storageIndex(i, g)] = rng.nextF64() * capacity * 0.3;
    }
  }

  return { n, tick: 0, goods, storage, demand, demandByGood, netProduction };
}

/**
 * Advance the economy by one fixed tick. Pure/order-deterministic (row-major);
 * reads the CURRENT eco cell only. Updates storage (clamped to capacity), and
 * records per-cell demand and net production for the trade layer to consume.
 */
export function stepEconomyField(
  field: EconomyField,
  dt: number,
  eco: EcoField | undefined,
  opts: EconomyOptions,
): void {
  const n = field.n;
  const G = field.goods.length;
  const capacity = opts.storageCapacity ?? 10;

  const foodVegRate = opts.foodVegRate ?? 0.05;
  const foodHerbRate = opts.foodHerbRate ?? 0.03;
  const woodRate = opts.woodRate ?? 0.02;
  const fiberVegRate = opts.fiberVegRate ?? 0.01;
  const fiberHerbRate = opts.fiberHerbRate ?? 0.02;
  const foodConsume = opts.foodConsume ?? 0.04;
  const woodConsume = opts.woodConsume ?? 0.01;
  const fiberConsume = opts.fiberConsume ?? 0.015;

  for (let i = 0; i < n * n; i++) {
    const v = eco ? eco.vegetation[i]! : 0;
    const h = eco ? eco.herbivores[i]! : 0;

    // Production from the coupled ecosystem cell.
    const prodFood = foodVegRate * v + foodHerbRate * h;
    const prodWood = woodRate * v;
    const prodFiber = fiberVegRate * v + fiberHerbRate * h;

    const d = field.demand[i]!;
    const consFood = foodConsume * d;
    const consWood = woodConsume * d;
    const consFiber = fiberConsume * d;

    const prod = [prodFood, prodWood, prodFiber];
    const cons = [consFood, consWood, consFiber];

    for (let g = 0; g < G; g++) {
      const net = prod[g]! - cons[g]!;
      const idx = storageIndex(i, g);
      const before = field.storage[idx]!;
      const after = clamp(before + net * dt, 0, capacity);
      field.storage[idx] = after;
      field.demandByGood[idx] = cons[g]!;
      // Net actually realized this step (post clamp).
      field.netProduction[idx] = (after - before) / dt;
    }
  }
  field.tick++;
}
