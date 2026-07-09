/**
 * @omega/ecs — entity lifecycle + archetype grouping.
 *
 * An `Archetype` groups every entity that currently has the exact same set of
 * component types. Queries over a fixed component signature only need to scan
 * the matching archetypes (typically one), which keeps iteration cheap.
 *
 * Entity ids are allocated from a monotonic counter; destroyed ids are returned
 * to a FIFO free-list queue so reuse is deterministic (oldest-freed id is
 * reused first). Entity lists inside each archetype are kept sorted by id.
 *
 * Determinism: no Math.random / Date.now. All ordering is by entity id.
 */

import {
  type ComponentDef,
  type EntityId,
  ComponentStore,
} from './storage.js';

/** Stable string key for a set of component ids (sorted ascending). */
function signatureKey(types: readonly ComponentDef<unknown>[]): string {
  return [...types].map((t) => t.id).sort((a, b) => a - b).join(',');
}

/**
 * A group of entities sharing an identical component signature. Entity ids are
 * kept in ascending order so iteration is deterministic.
 */
export class Archetype {
  readonly types: readonly ComponentDef<unknown>[];
  readonly typeIds: readonly number[];
  /** Ascending-id sorted entity ids in this archetype. */
  readonly entities: EntityId[] = [];

  constructor(types: readonly ComponentDef<unknown>[]) {
    const sorted = [...types].sort((a, b) => a.id - b.id);
    this.types = sorted;
    this.typeIds = sorted.map((t) => t.id);
  }

  /** True if this archetype contains every required component id. */
  containsAll(requiredIds: readonly number[]): boolean {
    for (const r of requiredIds) {
      if (!this.typeIds.includes(r)) return false;
    }
    return true;
  }

  /** Insert `entity`, preserving ascending-id order. */
  add(entity: EntityId): void {
    const i = this._insertionIndex(entity);
    this.entities.splice(i, 0, entity);
  }

  /** Remove `entity` (if present). Returns true when it was removed. */
  remove(entity: EntityId): boolean {
    const i = this.entities.indexOf(entity);
    if (i === -1) return false;
    this.entities.splice(i, 1);
    return true;
  }

  private _insertionIndex(entity: EntityId): number {
    // Binary search for the first slot whose value >= entity.
    let lo = 0;
    let hi = this.entities.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.entities[mid] < entity) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }
}

/**
 * Owns the entity namespace (allocation + free-list queue) and the mapping from
 * entity -> current archetype. Component *values* live in the `ComponentStore`;
 * this registry only tracks which entities have which component *types* so it
 * can move entities between archetypes as components are attached/detached.
 */
export class EntityRegistry {
  private readonly _store = new ComponentStore();
  private readonly _archetypes = new Map<string, Archetype>();
  // Empty archetype: entities with no components.
  private readonly _empty: Archetype;

  private readonly _alive = new Set<EntityId>();
  private readonly _entityTypes = new Map<EntityId, Set<ComponentDef<unknown>>>();
  private readonly _entityArchetype = new Map<EntityId, Archetype>();

  // Free-list as a FIFO queue (head index avoids O(n) shift).
  private _nextId = 0;
  private readonly _freeQueue: EntityId[] = [];
  private _freeHead = 0;

  constructor() {
    this._empty = new Archetype([]);
    this._archetypes.set(signatureKey([]), this._empty);
  }

  // --- entity allocation -------------------------------------------------

  /** Allocate a new entity id, reusing the oldest-freed id when available. */
  createEntity(): EntityId {
    let id: EntityId;
    if (this._freeHead < this._freeQueue.length) {
      id = this._freeQueue[this._freeHead++];
    } else {
      id = this._nextId++;
    }
    this._alive.add(id);
    this._entityTypes.set(id, new Set());
    this._entityArchetype.set(id, this._empty);
    this._empty.add(id);
    return id;
  }

  isAlive(id: EntityId): boolean {
    return this._alive.has(id);
  }

  /** Destroy an entity, dropping all its components, and free its id. */
  destroyEntity(id: EntityId): void {
    if (!this._alive.delete(id)) return;
    const types = this._entityTypes.get(id);
    if (types) {
      for (const t of types) this._store.remove(t, id);
    }
    const arch = this._entityArchetype.get(id);
    arch?.remove(id);
    this._entityTypes.delete(id);
    this._entityArchetype.delete(id);
    this._freeQueue.push(id);
  }

  get count(): number {
    return this._alive.size;
  }

  // --- component attach / detach ----------------------------------------

  /**
   * Attach `type` to `entity`. Moves the entity to the archetype matching its
   * new component signature. The component value itself is stored separately via
   * `setComponent`. Returns the resulting archetype.
   */
  attach(id: EntityId, type: ComponentDef<unknown>): Archetype {
    const set = this._entityTypes.get(id);
    if (!set) throw new Error(`attach: unknown entity ${id}`);
    if (set.has(type)) return this._entityArchetype.get(id)!;
    set.add(type);
    return this._move(id);
  }

  /** Detach `type` from `entity`, moving it to the smaller signature archetype. */
  detach(id: EntityId, type: ComponentDef<unknown>): Archetype {
    const set = this._entityTypes.get(id);
    if (!set) throw new Error(`detach: unknown entity ${id}`);
    if (!set.has(type)) return this._entityArchetype.get(id)!;
    set.delete(type);
    return this._move(id);
  }

  private _move(id: EntityId): Archetype {
    const set = this._entityTypes.get(id)!;
    const key = signatureKey([...set]);
    let next = this._archetypes.get(key);
    if (!next) {
      next = new Archetype([...set]);
      this._archetypes.set(key, next);
    }
    const prev = this._entityArchetype.get(id);
    if (prev !== next) {
      prev?.remove(id);
      next.add(id);
      this._entityArchetype.set(id, next);
    }
    return next;
  }

  // --- component value storage (delegates to ComponentStore) ------------

  setComponent<C>(type: ComponentDef<C>, id: EntityId, component: C): C {
    return this._store.add(type, id, component);
  }

  getComponent<C>(type: ComponentDef<C>, id: EntityId): C | undefined {
    return this._store.get(type, id);
  }

  hasComponent<C>(type: ComponentDef<C>, id: EntityId): boolean {
    return this._entityTypes.get(id)?.has(type) ?? false;
  }

  // --- queries -----------------------------------------------------------

  /**
   * Entity ids that have ALL of the given component types, in ascending-id
   * order. Implemented by unioning every archetype that is a superset of the
   * required signature (an entity belongs to exactly one archetype), then
   * sorting by id.
   */
  entitiesWithAll(types: readonly ComponentDef<unknown>[]): EntityId[] {
    const requiredIds = types.map((t) => t.id);
    if (requiredIds.length === 0) return this.allEntities();
    const out: EntityId[] = [];
    for (const arch of this._archetypes.values()) {
      if (arch.containsAll(requiredIds)) {
        for (const e of arch.entities) out.push(e);
      }
    }
    out.sort((a, b) => a - b);
    return out;
  }

  /** All live entities, ascending-id order. */
  allEntities(): EntityId[] {
    return [...this._alive].sort((a, b) => a - b);
  }

  /** The archetype an entity currently belongs to (undefined if not alive). */
  archetypeOf(id: EntityId): Archetype | undefined {
    return this._entityArchetype.get(id);
  }

  clear(): void {
    this._store.clear();
    this._archetypes.clear();
    this._archetypes.set(signatureKey([]), this._empty);
    this._empty.entities.length = 0;
    this._alive.clear();
    this._entityTypes.clear();
    this._entityArchetype.clear();
    this._nextId = 0;
    this._freeQueue.length = 0;
    this._freeHead = 0;
  }
}
