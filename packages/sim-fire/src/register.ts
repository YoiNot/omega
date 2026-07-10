/**
 * @omega/sim-fire — ECS integration.
 *
 * Registers a deterministic fire-spread system on the @omega/sim fixed-timestep
 * loop (engine-core World + Scheduler + SystemStage). It reads the environment
 * field (registered by @omega/sim-env under COMP_ENV_FIELD) if present, so fire
 * reacts to temperature/humidity/wind, but works standalone too.
 */

import { World, SystemStage } from '@omega/engine-core';
import { COMP_ENV_FIELD, type EnvField } from '@omega/sim-env';
import { COMP_FIRE_FIELD, createFireField, stepFireField, ignite, type FireField, type FireFieldOptions } from './fire.js';

export interface RegisterFireOptions extends FireFieldOptions {
  /** Land mask from terrain (1 = flammable land, 0 = ocean/rock). */
  landMask?: Uint8Array;
  /** Initial ignition cell [x, y]. Default: center. */
  ignition?: [number, number];
  /** SystemStage to run the fire update in. Default Update (after env at order 5). */
  stage?: SystemStage;
  /** Order within the stage. Default 6 (just after env-field). */
  order?: number;
}

/** Register the fire system; returns the live field + an ignite helper bound to it. */
export function registerFireField(world: World, opts: RegisterFireOptions): { field: FireField; ignite: (x: number, y: number) => boolean } {
  const field = createFireField(opts, opts.landMask);

  // Store as singleton component on entity 0.
  world.addComponent<FireField>(COMP_FIRE_FIELD, 0, field);

  const [ix, iy] = opts.ignition ?? [Math.floor(opts.gridSize / 2), Math.floor(opts.gridSize / 2)];
  ignite(field, ix, iy, opts.burnDuration ?? 3);

  world.registerSystem(opts.stage ?? SystemStage.Update, opts.order ?? 6, 'fire-step', (w, dt) => {
    const f = w.getComponent<FireField>(COMP_FIRE_FIELD, 0);
    if (!f) return;
    const env = w.getComponent<EnvField>(COMP_ENV_FIELD, 0);
    stepFireField(f, dt, opts, env);
  });

  return {
    field,
    ignite: (x: number, y: number) => ignite(field, x, y),
  };
}

/** Read the live fire field from a world (or undefined). */
export function getFireField(world: World): FireField | undefined {
  return world.getComponent<FireField>(COMP_FIRE_FIELD, 0);
}
