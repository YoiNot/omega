/**
 * @omega/sim-trade — deterministic inter-region trade.
 *
 * A market between economy regions (one region == one eco/econ cell). Each tick:
 *   1. PRICES are set per cell per good from local supply/demand — storage acts
 *      as supply, the economy's per-cell demand as demand. Higher demand or
 *      lower storage -> higher price. Deterministic, pure function of state.
 *   2. ORDERS: every region emits a surplus (sell) or deficit (buy) quantity per
 *      good, derived deterministically from (storage - demand*reference).
 *   3. MATCHING: for each good, sell orders (cheapest first) are matched against
 *      buy orders (highest bid first). TIES on price are broken DETERMINISTICALLY
 *      by ascending region index (then good index), so identical worlds always
 *      match the same way — no RNG, no insertion-order dependence.
 *   4. FLOW: each matched trade moves `qty` of a good along the nav-core shortest
 *      path (A*) between the two cells; the path length sets a transport cost that
 *      is subtracted from the spread. If shipping would cost more than the spread,
 *      the trade is cancelled. Flows are recorded for inspection. The economy
 *      storage is settled by {@link applyTradesToEconomy} (also deterministic).
 *
 * Determinism contract (see docs/adr/0001-determinism.md):
 *   - Given the same economy field + grid, `stepTradeMarket` reproduces identical
 *     prices, orders, matches, and flows tick-for-tick. The optional `Rng` is used
 *     ONLY for a seeded demand shock applied per tick when `demandShock > 0`; with
 *     no shock (or no seed) and identical inputs the result is bit-identical.
 *     Tie-breaks are structural (index order), never random.
 *
 * Built on:
 *   - @omega/engine-core (Rng — optional seeded shocks only)
 *   - @omega/engine-math (clamp, clamp01)
 *   - @omega/sim-econ    (EconomyField — supply/demand source)
 *   - @omega/nav-core    (findPath on a BooleanGrid for routes)
 */

import { Rng } from '@omega/engine-core';
import { clamp, clamp01 } from '@omega/engine-math';
import { Vec2 } from '@omega/engine-math';
import { findPath, BooleanGrid, type Grid } from '@omega/nav-core';
import {
  storageIndex,
  type EconomyField,
} from '@omega/sim-econ';

export const COMP_TRADE_FIELD = 'TradeField';

export interface TradeOptions {
  seed?: number | bigint | string;
  /**
   * Logistic price steepness: price = clamp01(0.5 + k*(demand - supplyShare)).
   * Higher k -> sharper price response. Default 4.
   */
  priceSharpness?: number;
  /** Reference storage at which supplyShare ~ 0.5. Default = storageCapacity (10). */
  priceReference?: number;
  /** Max Chebyshev distance a region will trade over (before path-cost check). */
  maxRange?: number;
  /**
   * Fraction of the price spread kept as transport cost per path step. If the
   * cost would exceed the spread, the trade is cancelled (no flow). Default 0.02.
   */
  transportCostPerStep?: number;
  /** If > 0, apply a per-tick seeded demand shock of this relative amplitude. */
  demandShock?: number;
}

export interface TradeOrder {
  /** Region (cell) index. */
  region: number;
  /** Index into EconomyField.goods. */
  good: number;
  /** Positive => surplus (sell). For buy orders this is the deficit magnitude. */
  qty: number;
  price: number;
}

export interface TradeFlow {
  from: number; // seller region
  to: number; // buyer region
  good: number;
  qty: number;
  price: number;
  /** Number of grid steps on the route (0 if same cell). */
  pathSteps: number;
}

export interface TradeField {
  n: number;
  tick: number;
  /** Per-cell per-good price [0,1]. Length n*n*G. */
  price: Float32Array;
  /** Flat list of orders produced this tick. */
  orders: TradeOrder[];
  /** Flat list of realized flows this tick. */
  flows: TradeFlow[];
  /** Per-cell per-good net trade delta this tick (sell+ / buy-). Length n*n*G. */
  netTrade: Float32Array;
}

function gCount(field: EconomyField): number {
  return field.goods.length;
}

/** Build the navigation grid: a cell is blocked only if it is a dead "void" — no
 * storage of any good AND no demand (nobody produces, nobody consumes there, so
 * no route should pass through it). A buyer with an empty warehouse but live
 * demand stays passable; a seller stays passable. */
function buildGrid(field: EconomyField): Grid {
  const n = field.n;
  const G = gCount(field);
  const blocked = new Uint8Array(n * n);
  for (let i = 0; i < n * n; i++) {
    let total = 0;
    for (let g = 0; g < G; g++) total += field.storage[storageIndex(i, g)]!;
    blocked[i] = total <= 0 && field.demand[i]! <= 0 ? 1 : 0;
  }
  return new BooleanGrid(n, n, blocked);
}

/** Compute per-cell per-good prices from supply/demand. Deterministic, pure. */
function computePrices(field: EconomyField, opts: TradeOptions): Float32Array {
  const n = field.n;
  const G = gCount(field);
  const k = opts.priceSharpness ?? 4;
  const ref = opts.priceReference ?? 10;
  const prices = new Float32Array(n * n * G);
  for (let i = 0; i < n * n; i++) {
    const d = field.demand[i]!;
    for (let g = 0; g < G; g++) {
      const supply = clamp01(field.storage[storageIndex(i, g)]! / ref);
      // demand pulls price up; supply pulls it down. Anchor 0.5 at parity.
      prices[i * G + g] = clamp01(0.5 + k * (d - supply));
    }
  }
  return prices;
}

/** Optional deterministic demand shock (seeded by tick). Mutates the field's demand array. */
function applyDemandShock(field: EconomyField, opts: TradeOptions): void {
  const amp = opts.demandShock ?? 0;
  if (amp <= 0 || !opts.seed) return;
  const rng = new Rng(`trade-shock:${opts.seed}:${field.tick}`);
  for (let i = 0; i < field.n * field.n; i++) {
    const s = 1 + (rng.nextF64() - 0.5) * 2 * amp;
    field.demand[i] = clamp01(field.demand[i]! * s);
  }
}

/** Surplus per (cell, good): >0 means seller, <0 means buyer. Reference-scaled. */
function surplusOf(field: EconomyField, region: number, good: number, ref: number): number {
  const stock = field.storage[storageIndex(region, good)]!;
  const d = field.demand[region]!;
  return stock - d * ref * 0.5;
}

/**
 * Advance the trade market by one tick. Pure given (field, opts, prev). Returns a
 * new TradeField; does NOT mutate economy storage (call {@link applyTradesToEconomy}
 * to settle). Deterministic: identical inputs -> identical prices/orders/flows.
 */
export function stepTradeMarket(
  field: EconomyField,
  opts: TradeOptions,
  prev?: TradeField,
): TradeField {
  applyDemandShock(field, opts);
  const n = field.n;
  const G = gCount(field);
  const ref = opts.priceReference ?? 10;
  const transportCostPerStep = opts.transportCostPerStep ?? 0.02;
  const maxRange = opts.maxRange ?? 4;

  const price = computePrices(field, opts);

  // --- Build orders: trade a fraction of each cell's imbalance per good. ---
  const sellsByGood: TradeOrder[][] = Array.from({ length: G }, () => []);
  const buysByGood: TradeOrder[][] = Array.from({ length: G }, () => []);
  const orders: TradeOrder[] = [];

  for (let i = 0; i < n * n; i++) {
    for (let g = 0; g < G; g++) {
      const surplus = surplusOf(field, i, g, ref);
      const qty = Math.abs(surplus) * 0.5;
      if (qty < 1e-6) continue;
      const p = price[i * G + g]!;
      const order: TradeOrder = { region: i, good: g, qty, price: p };
      orders.push(order);
      if (surplus > 0) sellsByGood[g]!.push(order);
      else buysByGood[g]!.push(order);
    }
  }

  // Deterministic ordering per good.
  for (let g = 0; g < G; g++) {
    // Sells cheapest first; tie-break by ascending region index.
    sellsByGood[g]!.sort((a, b) => a.price - b.price || a.region - b.region);
    // Buys highest bid first; tie-break by ascending region index.
    buysByGood[g]!.sort((a, b) => b.price - a.price || a.region - b.region);
  }

  const grid = buildGrid(field);
  const flows: TradeFlow[] = [];
  const netTrade = new Float32Array(n * n * G);

  for (let g = 0; g < G; g++) {
    const sells = sellsByGood[g]!;
    const buys = buysByGood[g]!;
    let si = 0;
    let bi = 0;
    while (si < sells.length && bi < buys.length) {
      const s = sells[si]!;
      const b = buys[bi]!;
      const spread = b.price - s.price;
      if (spread <= 0) {
        // No profitable spread: advance both (this pair cannot clear).
        si++;
        bi++;
        continue;
      }

      // Route cost via nav-core A* (4-neighbour). Same cell -> 0 steps.
      let pathSteps = 0;
      if (s.region !== b.region) {
        const sx = s.region % n;
        const sy = Math.floor(s.region / n);
        const bx = b.region % n;
        const by = Math.floor(b.region / n);
        // Deterministic pre-filter: don't ship beyond maxRange (Chebyshev).
        const cheb = Math.max(Math.abs(sx - bx), Math.abs(sy - by));
        if (cheb > maxRange) {
          bi++;
          continue;
        }
        const path = findPath(grid, new Vec2(sx, sy), new Vec2(bx, by));
        if (!path) {
          // Unreachable: try the next buyer for this seller.
          bi++;
          continue;
        }
        pathSteps = Math.max(0, path.length - 1);
      }
      const transportCost = pathSteps * transportCostPerStep;
      if (transportCost >= spread) {
        // Not worth shipping: try the next buyer (a closer one may exist).
        bi++;
        continue;
      }

      const qty = Math.min(s.qty, b.qty);
      const realizedPrice = s.price + transportCost;
      flows.push({ from: s.region, to: b.region, good: g, qty, price: realizedPrice, pathSteps });
      netTrade[s.region * G + g] += qty;
      netTrade[b.region * G + g] -= qty;

      s.qty -= qty;
      b.qty -= qty;
      if (s.qty <= 1e-9) si++;
      if (b.qty <= 1e-9) bi++;
    }
  }

  return {
    n,
    tick: (prev?.tick ?? 0) + 1,
    price,
    orders,
    flows,
    netTrade,
  };
}

/**
 * Deterministically settle a TradeField's flows into the economy storage.
 * Seller loses `qty`, buyer gains `qty` (clamped to capacity). Mutates `field`.
 */
export function applyTradesToEconomy(field: EconomyField, trade: TradeField, capacity = 10): void {
  const G = gCount(field);
  for (const fl of trade.flows) {
    const sellIdx = fl.from * G + fl.good;
    const buyIdx = fl.to * G + fl.good;
    field.storage[sellIdx] = clamp(field.storage[sellIdx]! - fl.qty, 0, capacity);
    field.storage[buyIdx] = clamp(field.storage[buyIdx]! + fl.qty, 0, capacity);
  }
}
