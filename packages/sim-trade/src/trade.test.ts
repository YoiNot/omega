import { describe, it, expect } from 'vitest';
import {
  createEconomyField,
  stepEconomyField,
  storageIndex,
  type EconomyOptions,
} from '@omega/sim-econ';
import {
  stepTradeMarket,
  applyTradesToEconomy,
  type TradeField,
  type TradeOptions,
} from './trade.js';
import { World, SystemStage } from '@omega/engine-core';
import { Simulation } from '@omega/sim';
import { registerEcosystemField } from '@omega/sim-eco';
import { registerEconomyField } from '@omega/sim-econ';
import { registerTradeMarket, getTradeField } from './register.js';

function makeEco(n: number, fill = 0.6) {
  return {
    n, tick: 0,
    vegetation: new Float32Array(n * n).fill(fill),
    herbivores: new Float32Array(n * n).fill(0.3),
    carnivores: new Float32Array(n * n).fill(0.1),
  } as any;
}

function tradeSnapshot(t: TradeField): unknown {
  return {
    prices: Array.from(t.price).map((x) => Math.round(x * 1e6)),
    flows: t.flows.map((f) => ({
      from: f.from, to: f.to, good: f.good,
      qty: Math.round(f.qty * 1e6), price: Math.round(f.price * 1e6), pathSteps: f.pathSteps,
    })),
    net: Array.from(t.netTrade).map((x) => Math.round(x * 1e6)),
  };
}

describe('TradeMarket determinism', () => {
  it('same world -> identical prices + flows tick-for-tick', () => {
    const n = 8;
    const eco = makeEco(n);
    const opts: EconomyOptions = { seed: 'trade-A', gridSize: n };
    const a = createEconomyField(opts, eco);
    const b = createEconomyField(opts, eco);
    const tradeOpts: TradeOptions = { priceReference: 10, maxRange: 4 };

    let ta: TradeField | undefined;
    let tb: TradeField | undefined;
    for (let t = 0; t < 25; t++) {
      stepEconomyField(a, 1 / 30, eco, opts);
      stepEconomyField(b, 1 / 30, eco, opts);
      ta = stepTradeMarket(a, tradeOpts, ta);
      tb = stepTradeMarket(b, tradeOpts, tb);
      expect(ta.tick).toBe(tb.tick);
      expect(tradeSnapshot(ta)).toEqual(tradeSnapshot(tb));
    }
  });

  it('identical prices with multiple sellers -> tie-break by region index (stable)', () => {
    // Construct a controlled economy: two seller cells with same price, one buyer.
    const n = 4;
    const f = createEconomyField({ seed: 'tie', gridSize: n }, makeEco(n, 0));
    // Keep the grid fully passable (every cell has a little stock) so routes exist.
    f.storage.fill(0.5);
    f.demand.fill(0.1);
    // Cells 0 and 1 are identical surplus sellers (highest storage, low demand).
    f.storage[storageIndex(0, 0)] = 9;
    f.storage[storageIndex(1, 0)] = 9;
    f.demand[0] = 0;
    f.demand[1] = 0;
    // Cell 15 is the buyer (empty warehouse, high demand).
    f.storage[storageIndex(15, 0)] = 0;
    f.demand[15] = 1;

    const t = stepTradeMarket(f, { priceReference: 10 }, undefined);
    // Buyer at 15 should pull from the LOWEST-index seller first (region 0), then 1.
    const foodFlows = t.flows.filter((fl) => fl.good === 0 && fl.to === 15);
    expect(foodFlows.length).toBeGreaterThan(0);
    expect(foodFlows[0]!.from).toBe(0);
    if (foodFlows.length > 1) expect(foodFlows[1]!.from).toBe(1);
  });

  it('unreachable target produces no flow (buyer isolated by void cells)', () => {
    const n = 4;
    const f = createEconomyField({ seed: 'unreach', gridSize: n }, makeEco(n, 0));
    f.storage.fill(0);
    f.demand.fill(0);
    f.storage[storageIndex(0, 0)] = 9; // seller
    f.storage[storageIndex(15, 0)] = 0; // buyer warehouse empty
    f.demand[15] = 1; // but it has demand -> passable as a node
    // Surround the buyer (cell 15, at corner (3,3)) with void cells (no storage, no demand)
    // so the only path to it is blocked from the seller at cell 0. With a 4x4 grid and
    // maxRange, seller(0)->buyer(15) is Chebyshev distance 3 (>2), so it is filtered out.
    const t = stepTradeMarket(f, { priceReference: 10, maxRange: 2 }, undefined);
    expect(t.flows.length).toBe(0);
  });

  it('settling flows into economy is deterministic and conserves total storage', () => {
    const n = 6;
    const eco = makeEco(n);
    const opts: EconomyOptions = { seed: 'settle', gridSize: n };
    const f = createEconomyField(opts, eco);
    for (let t = 0; t < 10; t++) stepEconomyField(f, 1 / 30, eco, opts);
    const before = Array.from(f.storage);
    const totalBefore = before.reduce((s, x) => s + x, 0);

    const t = stepTradeMarket(f, { priceReference: 10, maxRange: 3 }, undefined);
    applyTradesToEconomy(f, t, 10);
    const after = Array.from(f.storage);
    const totalAfter = after.reduce((s, x) => s + x, 0);

    // Trades move goods between cells: total (unclamped) conserved. Some clamp at capacity,
    // so assert each cell within [0,10] and totals close (allow tiny clamp slack).
    for (let i = 0; i < after.length; i++) {
      expect(after[i]!).toBeGreaterThanOrEqual(0);
      expect(after[i]!).toBeLessThanOrEqual(10);
    }
    expect(Math.abs(totalAfter - totalBefore)).toBeLessThan(1e-3);
  });
});

describe('TradeMarket ECS integration', () => {
  it('runs under @omega/sim loop (eco -> trade) deterministically', () => {
    function build(w: World) {
      registerEcosystemField(w, { seed: 'trade-loop', gridSize: 8, stage: SystemStage.Update, order: 7 });
      registerEconomyField(w, { seed: 'trade-loop', gridSize: 8, stage: SystemStage.Update, order: 8 });
      registerTradeMarket(w, { seed: 'trade-loop', stage: SystemStage.Update, order: 9 });
    }
    const simA = new Simulation(new World());
    build(simA.world);
    simA.pause();
    for (let i = 0; i < 30; i++) simA.step();
    const ta = getTradeField(simA.world)!;

    const simB = new Simulation(new World());
    build(simB.world);
    simB.pause();
    for (let i = 0; i < 30; i++) simB.step();
    const tb = getTradeField(simB.world)!;

    expect(tradeSnapshot(ta)).toEqual(tradeSnapshot(tb));
  });
});
