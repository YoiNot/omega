/**
 * @omega/ecs — component storage.
 *
 * Two layers:
 *  - `SparseSet<T>`: a classic entity -> component sparse set (dense + packed
 *    arrays) with O(1) add/remove/has/get. Iteration follows the dense array,
 *    i.e. insertion order, which is fully deterministic.
 *  - `ComponentStore`: maps a component *type* to a `SparseSet`, so the world can
 *    store one column per component type.
 *
 * Determinism note: no Math.random / Date.now anywhere. Entity iteration order
 * is whatever order entities were inserted; queries re-sort by id on top of this.
 */

/** Opaque entity identifier. Entities are plain integers. */
export type EntityId = number;

/**
 * A registered component type. Carries a stable numeric id + human name and
 * the component value type `C` (used only in typing — no per-instance storage
 * here; values live in the `ComponentStore`).
 */
export class ComponentDef<C = unknown> {
  readonly id: number;
  readonly name: string;
  // Phantom reference to C so the type parameter is used in a value position
  // (keeps the strict unused-parameter check quiet). Invisible to consumers.
  private readonly _sample?: C;

  constructor(id: number, name: string) {
    this.id = id;
    this.name = name;
    void this._sample;
  }
}

let _nextComponentId = 0;
const _idByName = new Map<string, number>();
const _defById = new Map<number, ComponentDef<unknown>>();

/**
 * Register (or look up) a component type by name. Repeated calls with the same
 * name return the same `ComponentDef`, so component identity is stable across
 * the whole process.
 */
export function defineComponent<C = unknown>(name: string): ComponentDef<C> {
  const existing = _idByName.get(name);
  if (existing !== undefined) return _defById.get(existing) as ComponentDef<C>;
  const id = _nextComponentId++;
  const def = new ComponentDef<C>(id, name);
  _idByName.set(name, id);
  _defById.set(id, def as ComponentDef<unknown>);
  return def;
}

/**
 * Sparse set: maps `EntityId -> T`. Backed by a dense id array, a dense value
 * array, and a sparse index array. Add/remove/has/get are O(1).
 *
 * Iteration (`ids` / `values`) follows insertion order. Swap-remove keeps the
 * operation O(1); the moved element keeps its value but may change its slot.
 */
export class SparseSet<T> {
  private readonly _denseIds: EntityId[] = [];
  private readonly _denseValues: T[] = [];
  // sparse[id] = index into the dense arrays, or -1 when absent.
  private readonly _sparse: number[] = [];

  get size(): number {
    return this._denseIds.length;
  }

  /** Insertion-ordered entity ids that currently have a value. */
  get ids(): readonly EntityId[] {
    return this._denseIds;
  }

  /** Insertion-ordered values, aligned 1:1 with `ids`. */
  get values(): readonly T[] {
    return this._denseValues;
  }

  private _sparseAt(id: EntityId): number {
    return id < this._sparse.length ? this._sparse[id] : -1;
  }

  private _ensureSparse(id: EntityId): void {
    while (this._sparse.length <= id) this._sparse.push(-1);
  }

  has(id: EntityId): boolean {
    return this._sparseAt(id) !== -1;
  }

  get(id: EntityId): T | undefined {
    const i = this._sparseAt(id);
    return i === -1 ? undefined : this._denseValues[i];
  }

  /** Add (or overwrite) a value for `id`. Returns the value. */
  add(id: EntityId, value: T): T {
    const i = this._sparseAt(id);
    if (i !== -1) {
      // Already present: update the value in place; position is unchanged so
      // insertion order stays stable.
      this._denseValues[i] = value;
      return value;
    }
    this._ensureSparse(id);
    const idx = this._denseIds.length;
    this._denseIds.push(id);
    this._denseValues.push(value);
    this._sparse[id] = idx;
    return value;
  }

  /** Remove `id` (swap-remove). Returns false if it was absent. */
  remove(id: EntityId): boolean {
    const i = this._sparseAt(id);
    if (i === -1) return false;
    const last = this._denseIds.length - 1;
    const lastId = this._denseIds[last];
    this._denseIds[i] = lastId;
    this._denseValues[i] = this._denseValues[last];
    this._denseIds.pop();
    this._denseValues.pop();
    if (i !== last) this._sparse[lastId] = i;
    this._sparse[id] = -1;
    return true;
  }

  clear(): void {
    this._denseIds.length = 0;
    this._denseValues.length = 0;
    this._sparse.length = 0;
  }
}

/**
 * Stores every component instance of every type for a world. Keyed by component
 * type id -> `SparseSet`. Adding a component that already exists overwrites it.
 */
export class ComponentStore {
  private readonly _sets = new Map<number, SparseSet<unknown>>();

  private _setFor<C>(type: ComponentDef<C>): SparseSet<unknown> {
    let s = this._sets.get(type.id);
    if (!s) {
      s = new SparseSet<unknown>();
      this._sets.set(type.id, s);
    }
    return s;
  }

  add<C>(type: ComponentDef<C>, entity: EntityId, component: C): C {
    this._setFor(type).add(entity, component as unknown);
    return component;
  }

  get<C>(type: ComponentDef<C>, entity: EntityId): C | undefined {
    return this._sets.get(type.id)?.get(entity) as C | undefined;
  }

  has<C>(type: ComponentDef<C>, entity: EntityId): boolean {
    return this._sets.get(type.id)?.has(entity) ?? false;
  }

  /** Remove a single component. Returns false if it was absent. */
  remove<C>(type: ComponentDef<C>, entity: EntityId): boolean {
    const s = this._sets.get(type.id);
    if (!s) return false;
    const ok = s.remove(entity);
    if (s.size === 0) this._sets.delete(type.id);
    return ok;
  }

  /** All entities (insertion order) that currently have `type`. */
  entitiesWith<C>(type: ComponentDef<C>): readonly EntityId[] {
    return this._sets.get(type.id)?.ids ?? [];
  }

  /** Remove every component instance for `entity` across the given types. */
  removeAll(entity: EntityId, types: readonly ComponentDef<unknown>[]): void {
    for (const t of types) this.remove(t, entity);
  }

  clear(): void {
    this._sets.clear();
  }
}
