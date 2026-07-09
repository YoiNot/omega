/**
 * @omega/ecs — deterministic queries.
 *
 * A `Query` selects every entity that has ALL of a given set of component types
 * and iterates them in ascending-id order. Component values are fetched lazily
 * per entity from the registry.
 *
 * Determinism: iteration order is a pure function of entity ids; we never rely
 * on Map/Set insertion order, only on an explicit id sort.
 */

import { type ComponentDef, type EntityId } from './storage.js';
import { EntityRegistry } from './archetype.js';

/** Extract the value type carried by a `ComponentDef`. */
export type ComponentValue<D> = D extends ComponentDef<infer C> ? C : never;

/** A tuple of component value types, aligned 1:1 with the query's component list. */
export type QueryTuple<C extends ComponentDef<unknown>[]> = {
  [K in keyof C]: ComponentValue<C[K]>;
};

/** Callback invoked for each matched entity: (entityId, ...components). */
export type QueryCallback<C extends ComponentDef<unknown>[]> = (
  entity: EntityId,
  ...components: QueryTuple<C>
) => void;

/** A reusable query over a fixed set of component types. */
export class Query<C extends ComponentDef<unknown>[]> {
  private readonly _types: C;

  constructor(
    private readonly _registry: EntityRegistry,
    ...types: C
  ) {
    this._types = types;
  }

  /** Entity ids that have all required components, ascending-id order. */
  entities(): EntityId[] {
    return this._registry.entitiesWithAll(this._types);
  }

  /**
   * Iterate matched entities in deterministic ascending-id order, invoking
   * `fn(entity, ...components)` with the components in the same order as the
   * query's type list.
   */
  each(fn: QueryCallback<C>): void {
    for (const id of this.entities()) {
      const components = this._types.map((t) =>
        this._registry.getComponent(t, id),
      ) as QueryTuple<C>;
      fn(id, ...components);
    }
  }

  /** Number of matched entities. */
  get size(): number {
    return this.entities().length;
  }
}
