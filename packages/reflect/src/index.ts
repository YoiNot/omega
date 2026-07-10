/**
 * @omega/reflect — lightweight deterministic type registry for ECS components.
 *
 * The job system ships a stable (id, name) pair instead of a class instance
 * across the worker boundary. This package owns that name <-> id mapping.
 */

export {
  TypeRegistry,
  defaultRegistry,
  defineType,
  fromComponentDef,
  reflect,
} from './registry.js';

export type {
  TypeInfo,
  ComponentType,
} from './registry.js';
