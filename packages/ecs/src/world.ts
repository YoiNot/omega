/**
 * @omega/ecs — the World, tying storage + archetype + query + scheduler together.
 *
 * This is the single façade users interact with. It is framework-free and has no
 * nondeterministic inputs: entity ids are allocated deterministically, queries
 * iterate in ascending-id order, and systems run in stable priority order.
 *
 * Example:
 *   const Position = defineComponent<{ x: number; y: number }>('position');
 *   const world = new World();
 *   const e = world.createEntity();
 *   world.addComponent(e, Position, { x: 0, y: 0 });
 *   world.query(Position).each((id, pos) => { ... });
 *   world.registerSystem((w, dt) => { ... }, 0);
 *   world.tick(1 / 60);
 */

import {
  type ComponentDef,
  type EntityId,
  ComponentStore,
  defineComponent,
} from './storage.js';
import { EntityRegistry } from './archetype.js';
import { Query, type QueryTuple, type QueryCallback } from './query.js';
import { SystemScheduler, type SystemFn } from './scheduler.js';

export { defineComponent };
export type { ComponentDef, EntityId, QueryTuple, QueryCallback };

/** The ECS world: owns entities, components, queries, and the system scheduler. */
export class World {
  private readonly _registry = new EntityRegistry();
  private readonly _scheduler = new SystemScheduler();
  /** Total number of ticks executed. */
  tickCount = 0;

  /** Allocate a new entity id. */
  createEntity(): EntityId {
    return this._registry.createEntity();
  }

  isAlive(id: EntityId): boolean {
    return this._registry.isAlive(id);
  }

  /** Destroy an entity and drop all its components. */
  destroyEntity(id: EntityId): void {
    this._registry.destroyEntity(id);
  }

  /**
   * Add (or replace) a component on an entity. Returns the stored instance.
   * The entity is moved into the matching archetype automatically.
   */
  addComponent<C>(
    entity: EntityId,
    type: ComponentDef<C>,
    component: C,
  ): C {
    this._registry.attach(entity, type);
    return this._registry.setComponent(type, entity, component);
  }

  /** Update an existing component's value (must already be attached). */
  setComponent<C>(
    entity: EntityId,
    type: ComponentDef<C>,
    component: C,
  ): C {
    return this._registry.setComponent(type, entity, component);
  }

  getComponent<C>(entity: EntityId, type: ComponentDef<C>): C | undefined {
    return this._registry.getComponent(type, entity);
  }

  hasComponent<C>(entity: EntityId, type: ComponentDef<C>): boolean {
    return this._registry.hasComponent(type, entity);
  }

  /** Remove a component, moving the entity into a smaller-signature archetype. */
  removeComponent<C>(entity: EntityId, type: ComponentDef<C>): boolean {
    const ok = this._registry.hasComponent(type, entity);
    if (!ok) return false;
    this._registry.detach(entity, type);
    return true;
  }

  /**
   * Build (or reuse) a query over the given component types. Entities are
   * iterated in ascending-id order.
   */
  query<C extends ComponentDef<unknown>[]>(
    ...types: C
  ): Query<C> {
    return new Query(this._registry, ...types);
  }

  /** Register a system with the given priority (lower runs first). */
  registerSystem(fn: SystemFn, priority = 0, name = ''): void {
    this._scheduler.register(fn, priority, name);
  }

  /** Run all systems once for `dt` seconds, in deterministic order. */
  tick(dt: number): void {
    this._scheduler.run(this, dt);
    this.tickCount++;
  }

  /** Number of live entities. */
  get entityCount(): number {
    return this._registry.count;
  }

  /** All live entities, ascending-id order. */
  entities(): EntityId[] {
    return this._registry.allEntities();
  }

  /** Reset the world to an empty state. */
  clear(): void {
    this._registry.clear();
    this._scheduler.clear();
    this.tickCount = 0;
  }
}

// Re-export the storage pieces for advanced users / tests.
export { ComponentStore };
export type { ComponentValue } from './query.js';
