/**
 * @omega/sim-env — ECS integration.
 *
 * Wires the deterministic environment field into the existing @omega/sim
 * fixed-timestep loop (which is built on @omega/engine-core World + Scheduler +
 * SystemStage). We do NOT reimplement a loop — we register a system that advances
 * the field one fixed step per tick, exactly like @omega/sim/colony.ts does.
 */

import { World, SystemStage } from '@omega/engine-core';
import { TerrainGenerator } from '@omega/world-gen';
import { COMP_ENV_FIELD, createEnvField, stepEnvField, type EnvField, type EnvFieldOptions } from './environment.js';

export interface RegisterEnvOptions extends EnvFieldOptions {
  /** Terrain resolution (NxN). Default 32 — small enough for deterministic CI. */
  gridSize?: number;
  /**
   * If provided, the heightfield comes straight from this terrain (already
   * generated). Otherwise a terrain is generated from `seed` at `gridSize`.
   */
  terrain?: { width: number; height: number; heights: Float32Array };
  /** SystemStage to run the environment update in. Default Update. */
  stage?: SystemStage;
  /** Order within the stage. Default 5 (before agent/fire systems). */
  order?: number;
}

/**
 * Register the environment-field system on a world and return the live field.
 * The field is stored as an ECS singleton component so other systems (fire,
 * ecosystems) can read it via `world.getComponent(COMP_ENV_FIELD, 0)`.
 */
export function registerEnvironmentField(world: World, opts: RegisterEnvOptions): EnvField {
  const gridSize = opts.gridSize ?? 32;
  const terrain = opts.terrain ?? new TerrainGenerator(opts.seed, { size: gridSize }).generate();
  const field = createEnvField(terrain, opts);

  // Store as singleton component on entity 0 (deterministic anchor entity).
  world.addComponent<EnvField>(COMP_ENV_FIELD, 0, field);

  world.registerSystem(opts.stage ?? SystemStage.Update, opts.order ?? 5, 'env-field-step', (w, dt) => {
    const f = w.getComponent<EnvField>(COMP_ENV_FIELD, 0);
    if (!f) return;
    stepEnvField(f, dt, opts);
  });

  return field;
}

/** Read the live environment field from a world (or undefined if not registered). */
export function getEnvField(world: World): EnvField | undefined {
  return world.getComponent<EnvField>(COMP_ENV_FIELD, 0);
}
