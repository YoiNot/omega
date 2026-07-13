/**
 * @omega/sim-econ — ECS integration.
 *
 * Registers the economy system on the @omega/sim fixed-timestep loop (engine-core
 * World + Scheduler + SystemStage), reads the coupled @omega/sim-eco field
 * (COMP_ECO_FIELD) for production, and the economy field lives as a singleton
 * component (COMP_ECON_FIELD) on entity 0 so the trade layer can read it.
 */

import { World, SystemStage } from '@omega/engine-core';
import {
  COMP_ECO_FIELD,
  type EcoField,
} from '@omega/sim-eco';
import {
  COMP_ECON_FIELD,
  createEconomyField,
  stepEconomyField,
  type EconomyField,
  type EconomyOptions,
} from './economy.js';

export interface RegisterEconOptions extends EconomyOptions {
  stage?: SystemStage;
  order?: number;
}

/** Register the economy system; returns the live field. */
export function registerEconomyField(world: World, opts: RegisterEconOptions): EconomyField {
  const eco = world.getComponent<EcoField>(COMP_ECO_FIELD, 0);
  const field = createEconomyField(opts, eco);

  world.addComponent<EconomyField>(COMP_ECON_FIELD, 0, field);

  world.registerSystem(opts.stage ?? SystemStage.Update, opts.order ?? 8, 'econ-step', (w, dt) => {
    const f = w.getComponent<EconomyField>(COMP_ECON_FIELD, 0);
    if (!f) return;
    const e = w.getComponent<EcoField>(COMP_ECO_FIELD, 0);
    stepEconomyField(f, dt, e, opts);
  });

  return field;
}

/** Read the live economy field from a world (or undefined). */
export function getEconomyField(world: World): EconomyField | undefined {
  return world.getComponent<EconomyField>(COMP_ECON_FIELD, 0);
}
