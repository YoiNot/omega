/**
 * @omega/ai — ECS adapter bridging GOAP/utility AI to @omega/engine-core.
 *
 * A `Brain` is a component you attach to an entity. It names which GOAP actions and utility
 * options the entity can consider, plus the goal it is currently pursuing. `think` reads the
 * entity's numeric component values into a flat `WorldState` (by feature name), runs the
 * planner or utility selector, and emits an `'agent:decision'` event over the world's
 * `EventBus` carrying `{ entityId, action }`.
 *
 * Component mapping (generic & documented):
 *   The brain declares `sensors: string[]` — the names of numeric components to read. For
 *   each name, `think` looks up that component on the entity and copies EVERY numeric field
 *   of that component into the world state using the key `ComponentName.Field`. This keeps
 *   the mapping explicit and collision-free (e.g. a `Position` component with {x,y,z}
 *   contributes `Position.x`, `Position.y`, `Position.z`). A GOAP `WorldState` key therefore
 *   looks like `"Position.x"` etc. Entries of type number are copied; non-number fields are
 *   skipped. Absent components contribute nothing (treated as 0 by the GOAP helpers).
 *
 * The output action name for utility AI is the chosen option name; for GOAP it is the first
 * action in the returned plan. If no plan/option is found, the event carries `action: null`.
 */

import { World, EventBus } from '@omega/engine-core';
import { GoapAction, GoapPlanner, WorldState } from './goap.js';
import { UtilityOption, chooseBest } from './utility.js';

/** What mode a brain reasons in. */
export type BrainMode = 'goap' | 'utility';

/** A brain component attached to an entity via `world.addComponent('Brain', id, {...})`. */
export interface Brain {
  mode: BrainMode;
  /** Names of numeric components whose fields become world-state features. */
  sensors: string[];
  /** GOAP actions this agent may perform (used when mode === 'goap'). */
  actions: GoapAction[];
  /** Utility options this agent may pick (used when mode === 'utility'). */
  options: UtilityOption[];
  /** Current goal world state (used when mode === 'goap'). */
  goal: WorldState;
  /** Cached last decision, for inspection/testing. */
  lastDecision?: string | null;
}

/** Event payload emitted on the world EventBus under `'agent:decision'`. */
export interface AgentDecisionEvent {
  entityId: number;
  action: string | null;
  mode: BrainMode;
}

/** Events understood by `think`'s EventBus. */
export interface AgentEvents extends Record<string, unknown> {
  'agent:decision': AgentDecisionEvent;
}

/** Read an entity's sensor components into a flat numeric WorldState. */
export function readWorldState(world: World, entityId: number, sensors: string[]): WorldState {
  const state: WorldState = {};
  for (const compName of sensors) {
    const comp = world.getComponent<Record<string, unknown>>(compName, entityId);
    if (!comp) continue;
    for (const field in comp) {
      const v = comp[field];
      if (typeof v === 'number' && Number.isFinite(v)) {
        state[`${compName}.${field}`] = v;
      }
    }
  }
  return state;
}

/**
 * Run one reasoning step for an entity with a `Brain` component.
 *
 * - mode 'goap': read sensors -> plan from current state to brain.goal -> emit first action.
 * - mode 'utility': read sensors -> chooseBest(options) -> emit chosen option name.
 *
 * Emits `'agent:decision'` with { entityId, action, mode }. Returns the action name (or null).
 */
export function think(
  world: World,
  entityId: number,
  bus: EventBus<AgentEvents>,
  planner: GoapPlanner = new GoapPlanner(),
): string | null {
  const brain = world.getComponent<Brain>('Brain', entityId);
  if (!brain) throw new Error(`think: entity ${entityId} has no Brain component`);

  const state = readWorldState(world, entityId, brain.sensors);
  let action: string | null = null;

  if (brain.mode === 'goap') {
    const plan = planner.plan(state, brain.goal, brain.actions);
    action = plan && plan.length > 0 ? plan[0].name : null;
  } else {
    const chosen = chooseBest(brain.options, state);
    action = chosen ? chosen.name : null;
  }

  brain.lastDecision = action;
  bus.emit('agent:decision', { entityId, action, mode: brain.mode });
  return action;
}
