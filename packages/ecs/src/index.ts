/**
 * @omega/ecs — deterministic entity-component-system core.
 *
 * Re-exports the public surface: component definitions, storage primitives,
 * archetype-based entity lifecycle, deterministic queries, the system
 * scheduler, and the `World` façade. Framework-free; no nondeterministic
 * inputs in core logic.
 */

export {
  defineComponent,
  SparseSet,
  ComponentStore,
  type ComponentDef,
  type EntityId,
} from './storage.js';

export {
  Archetype,
  EntityRegistry,
} from './archetype.js';

export {
  Query,
  type QueryTuple,
  type QueryCallback,
  type ComponentValue,
} from './query.js';

export {
  SystemScheduler,
  type SystemFn,
} from './scheduler.js';

export {
  World,
  type ComponentValue as QueryComponentValue,
} from './world.js';
