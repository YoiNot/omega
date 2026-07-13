/**
 * @omega/sim-trade — ECS integration.
 *
 * Registers the trade market system on the @omega/sim fixed-timestep loop
 * (engine-core World + Scheduler + SystemStage). It reads the coupled
 * @omega/sim-econ field (COMP_ECON_FIELD) each tick, runs the deterministic
 * market, and (optionally) settles flows back into storage. The live TradeField
 * is stored as a singleton component (COMP_TRADE_FIELD) on entity 0.
 */

import { World, SystemStage } from '@omega/engine-core';
import {
  COMP_ECON_FIELD,
  getEconomyField,
  type EconomyField,
} from '@omega/sim-econ';
import {
  COMP_TRADE_FIELD,
  stepTradeMarket,
  applyTradesToEconomy,
  type TradeField,
  type TradeOptions,
} from './trade.js';

export interface RegisterTradeOptions extends TradeOptions {
  stage?: SystemStage;
  order?: number;
  /** Settle flows into economy storage after each market step. Default true. */
  settle?: boolean;
  /** Storage capacity passed to applyTradesToEconomy. Default 10. */
  storageCapacity?: number;
}

/** Register the trade system; returns the live field handle (economy read each tick). */
export function registerTradeMarket(world: World, opts: RegisterTradeOptions): void {
  const settle = opts.settle ?? true;
  const cap = opts.storageCapacity ?? 10;
  let trade: TradeField | undefined;

  world.registerSystem(opts.stage ?? SystemStage.Update, opts.order ?? 9, 'trade-step', (w) => {
    const econ = w.getComponent<EconomyField>(COMP_ECON_FIELD, 0);
    if (!econ) return;
    trade = stepTradeMarket(econ, opts, trade);
    w.addComponent<TradeField>(COMP_TRADE_FIELD, 0, trade);
    if (settle) applyTradesToEconomy(econ, trade, cap);
  });
}

/** Read the live trade field from a world (or undefined). */
export function getTradeField(world: World): TradeField | undefined {
  return world.getComponent<TradeField>(COMP_TRADE_FIELD, 0);
}

export { getEconomyField };
