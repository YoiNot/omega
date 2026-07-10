/**
 * @omega/reflect — lightweight deterministic type registry for ECS components.
 *
 * The job system needs to ship *which* component a parallel task operates on
 * from the main thread to a Web Worker. Because a class instance cannot be
 * structured-cloned across the worker boundary, we instead ship a stable,
 * deterministic integer `typeId` + human `name`. This module owns the
 * name <-> id mapping and is the single source of truth for it.
 *
 * Determinism contract:
 *  - The same `name` always resolves to the same `typeId` within a process.
 *  - `typeId`s are assigned in first-registration order, starting at 0.
 *  - No Math.random / Date.now / RNG anywhere — registration is pure.
 *  - `register` is idempotent: re-registering a known name returns the existing
 *    id and never renumbers existing types.
 */

import type { ComponentDef } from '@omega/ecs';

/** A registered component type: stable id + name. Plain data (clone-safe). */
export interface TypeInfo {
  /** Stable numeric id (first-registration order, starts at 0). */
  readonly id: number;
  /** Human-readable stable name. */
  readonly name: string;
}

/**
 * A component "type token" the registry hands back. Carries both the stable
 * id and the name. Has no opaque class instance, so it survives structuredClone
 * (we actually only ever ship `id` + `name` across the worker boundary).
 */
export interface ComponentType<T = unknown> {
  readonly id: number;
  readonly name: string;
  /** Phantom type position for consumers; never set at runtime. */
  readonly __type?: T;
}

/**
 * Deterministic type registry: name <-> id, plus a convenience `define()` that
 * returns a clone-safe `ComponentType` token (no class instance).
 */
export class TypeRegistry {
  private readonly _byName = new Map<string, TypeInfo>();
  private readonly _byId = new Map<number, TypeInfo>();
  private _nextId = 0;

  /**
   * Register (or look up) a type by name. Returns the stable `TypeInfo`.
   * Idempotent: a known name returns its existing id unchanged.
   */
  register(name: string): TypeInfo {
    const existing = this._byName.get(name);
    if (existing) return existing;
    const info: TypeInfo = { id: this._nextId++, name };
    this._byName.set(name, info);
    this._byId.set(info.id, info);
    return info;
  }

  /**
   * Register a type and return a clone-safe `ComponentType` token (id + name).
   * The token is plain data, so it can be posted to a worker.
   */
  define<T = unknown>(name: string): ComponentType<T> {
    const info = this.register(name);
    return { id: info.id, name: info.name };
  }

  /** Look up a type's info by name, or undefined if never registered. */
  byName(name: string): TypeInfo | undefined {
    return this._byName.get(name);
  }

  /** Look up a type's info by id, or undefined if the id is unknown. */
  byId(id: number): TypeInfo | undefined {
    return this._byId.get(id);
  }

  /** Round-trip: name -> id -> name. Returns undefined if the id is unknown. */
  nameOf(id: number): string | undefined {
    return this._byId.get(id)?.name;
  }

  /** Round-trip: id -> name -> id. Returns undefined if the name is unknown. */
  idOf(name: string): number | undefined {
    return this._byName.get(name)?.id;
  }

  /** Total number of registered types. */
  get size(): number {
    return this._byName.size;
  }

  /** All registered type infos (in ascending id order). */
  all(): readonly TypeInfo[] {
    return [...this._byId.values()].sort((a, b) => a.id - b.id);
  }

  /** Reset to empty. Primarily for tests. */
  clear(): void {
    this._byName.clear();
    this._byId.clear();
    this._nextId = 0;
  }
}

/** A process-global default registry, mirroring how `@omega/ecs` defines components. */
export const defaultRegistry = new TypeRegistry();

/**
 * Convenience: define a component type in the default registry. Returns a
 * clone-safe token (id + name) — suitable for shipping to a worker.
 */
export function defineType<T = unknown>(name: string): ComponentType<T> {
  return defaultRegistry.define<T>(name);
}

/**
 * Adapt a `@omega/ecs` `ComponentDef` (`{ id, name }`) into a `ComponentType`
 * token usable by the job system. Because `@omega/ecs` already assigns stable
 * ids globally, we preserve that id rather than re-registering.
 */
export function fromComponentDef<T>(def: ComponentDef<T>): ComponentType<T> {
  return { id: def.id, name: def.name };
}

/** Branded namespace for export convenience. */
export const reflect = {
  TypeRegistry,
  defineType,
  fromComponentDef,
  defaultRegistry,
};
