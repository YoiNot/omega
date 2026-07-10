/**
 * @omega/sim-eco — ECS integration.
 *
 * Registers a deterministic ecosystem system on the @omega/sim fixed-timestep
 * loop (engine-core World + Scheduler + SystemStage). Reads the environment
 * field (COMP_ENV_FIELD) if present for climate coupling.
 */

import { World, SystemStage } from '@omega/engine-core';
import { COMP_ENV_FIELD, type EnvField } from '@omega/sim-env';
import { COMP_ECO_FIELD, createEcoField, stepEcoField, type EcoField, type EcoFieldOptions } from './eco.js';

export interface RegisterEcoOptions extends EcoFieldOptions {
  /** SystemStage to run the eco update in. Default Update (after fire at order 6). */
  stage?: SystemStage;
  /** Order within the stage. Default 7. */
  order?: number;
}

/** Register the ecosystem system; returns the live field. */
export function registerEcosystemField(world: World, opts: RegisterEcoOptions): EcoField {
  const env = world.getComponent<EnvField>(COMP_ENV_FIELD, 0);
  const field = createEcoField(opts, env);

  world.addComponent<EcoField>(COMP_ECO_FIELD, 0, field);

  world.registerSystem(opts.stage ?? SystemStage.Update, opts.order ?? 7, 'eco-step', (w, dt) => {
    const f = w.getComponent<EcoField>(COMP_ECO_FIELD, 0);
    if (!f) return;
    const e = w.getComponent<EnvField>(COMP_ENV_FIELD, 0);
    stepEcoField(f, dt, opts, e);
  });

  return field;
}

/** Read the live ecosystem field from a world (or undefined). */
export function getEcoField(world: World): EcoField | undefined {
  return world.getComponent<EcoField>(COMP_ECO_FIELD, 0);
}
