/**
 * @omega/engine-core — Entity Component System.
 *
 * Structure-of-arrays ECS (see docs/adr/0002-ecs-design.md). Entities are integer ids;
 * each component type lives in its own dense store keyed by entity id. Iteration is by
 * ascending id so behavior is deterministic regardless of insertion order.
 */

export type EntityId = number;

let _nextTypeId = 0;
const typeRegistry = new Map<string, number>();

/** Register a component type and get a stable numeric id (used internally by World). */
export function registerComponentType(name: string): number {
  let id = typeRegistry.get(name);
  if (id === undefined) {
    id = _nextTypeId++;
    typeRegistry.set(name, id);
  }
  return id;
}

/** A dense column of one component type, keyed by entity id. */
export class ComponentStore<C extends object> {
  readonly name: string;
  private readonly data = new Map<EntityId, C>();
  private readonly ids: EntityId[] = [];
  private dirty = false;

  constructor(name: string) {
    this.name = name;
    registerComponentType(name);
  }

  get size(): number { return this.data.size; }

  add(id: EntityId, component: C): C {
    if (!this.data.has(id)) { this.ids.push(id); this.dirty = true; }
    this.data.set(id, component);
    return component;
  }

  get(id: EntityId): C | undefined { return this.data.get(id); }

  has(id: EntityId): boolean { return this.data.has(id); }

  remove(id: EntityId): boolean {
    if (this.data.delete(id)) {
      const i = this.ids.indexOf(id);
      if (i >= 0) this.ids.splice(i, 1);
      this.dirty = true;
      return true;
    }
    return false;
  }

  /** Ascending-id sorted entity ids that have this component. */
  keys(): EntityId[] {
    if (this.dirty) { this.ids.sort((a, b) => a - b); this.dirty = false; }
    return this.ids;
  }

  /** Iterate (id, component) pairs in ascending-id order. */
  forEach(fn: (id: EntityId, c: C) => void): void {
    for (const id of this.keys()) fn(id, this.data.get(id)!);
  }

  clear(): void { this.data.clear(); this.ids.length = 0; this.dirty = true; }
}

export interface ComponentFactory<C extends object> {
  (id: EntityId): C;
}

/** Function component systems receive the world each tick. */
export type SystemFn = (world: World, dt: number, tick: number) => void;

export class System {
  constructor(
    public readonly name: string,
    public readonly stage: SystemStage,
    public readonly order: number,
    public readonly fn: SystemFn,
  ) {}
}

export enum SystemStage {
  PreUpdate = 0,
  Update = 1,
  PostUpdate = 2,
  Render = 3,
  Save = 4,
}

export interface QueryResult<C extends object[]> {
  ids: EntityId[];
  /** Get the tuple of components for entity id. */
  get(id: EntityId): C;
}

/** The ECS world: owns entities, component stores, and the system scheduler. */
export class World {
  private allocCounter = 0;
  private freeList: EntityId[] = [];
  private alive = new Set<EntityId>();
  private stores = new Map<string, ComponentStore<object>>();
  private systems: System[] = [];
  private systemsSorted: System[] | null = null;
  tick = 0;

  /** Allocate a new entity id (reuses freed ids). */
  createEntity(): EntityId {
    let id: EntityId;
    if (this.freeList.length > 0) id = this.freeList.pop()!;
    else id = this.allocCounter++;
    this.alive.add(id);
    return id;
  }

  isAlive(id: EntityId): boolean { return this.alive.has(id); }

  /** Destroy an entity and remove all its components. */
  destroyEntity(id: EntityId): void {
    if (!this.alive.delete(id)) return;
    for (const store of this.stores.values()) store.remove(id);
    this.freeList.push(id);
  }

  /** Get (creating if absent) the component store for a named type. */
  store<C extends object>(name: string): ComponentStore<C> {
    let s = this.stores.get(name);
    if (!s) { s = new ComponentStore<C>(name); this.stores.set(name, s); }
    return s as ComponentStore<C>;
  }

  /** Add (or replace) a component instance. */
  addComponent<C extends object>(name: string, id: EntityId, component: C): C {
    return this.store<C>(name).add(id, component);
  }

  /** Add a component produced by a factory for a freshly created entity. */
  spawn<C extends object>(name: string, factory: ComponentFactory<C>): EntityId {
    const id = this.createEntity();
    this.store<C>(name).add(id, factory(id));
    return id;
  }

  getComponent<C extends object>(name: string, id: EntityId): C | undefined {
    return this.store<C>(name).get(id);
  }

  hasComponent(name: string, id: EntityId): boolean {
    return this.store(name).has(id);
  }

  removeComponent(name: string, id: EntityId): boolean {
    return this.store(name).remove(id);
  }

  /** Query entities that have ALL of the given component names. */
  query(...names: string[]): QueryResult<object[]> {
    const stores = names.map((n) => this.store(n));
    // Smallest store drives iteration (cheapest).
    let driver = stores[0];
    for (const s of stores) if (s.size < driver.size) driver = s;
    const ids: EntityId[] = [];
    for (const id of driver.keys()) {
      let ok = true;
      for (const s of stores) { if (!s.has(id)) { ok = false; break; } }
      if (ok) ids.push(id);
    }
    return {
      ids,
      get: (id: EntityId) => stores.map((s) => s.get(id)!),
    };
  }

  registerSystem(stage: SystemStage, order: number, name: string, fn: SystemFn): System {
    const sys = new System(name, stage, order, fn);
    this.systems.push(sys);
    this.systemsSorted = null;
    return sys;
  }

  private sortedSystems(): System[] {
    if (!this.systemsSorted) {
      this.systemsSorted = [...this.systems].sort((a, b) =>
        a.stage !== b.stage ? a.stage - b.stage : a.order - b.order,
      );
    }
    return this.systemsSorted;
  }

  /** Advance all systems by dt seconds (one simulation step). */
  step(dt: number): void {
    for (const sys of this.sortedSystems()) sys.fn(this, dt, this.tick);
    this.tick++;
  }

  /** Run only systems of a single stage (used by the renderer/integration tests). */
  runStage(stage: SystemStage, dt: number): void {
    for (const sys of this.sortedSystems()) if (sys.stage === stage) sys.fn(this, dt, this.tick);
  }

  count(): number { return this.alive.size; }

  systemCount(): number { return this.systems.length; }

  clear(): void {
    this.alive.clear();
    this.freeList.length = 0;
    this.allocCounter = 0;
    this.stores.clear();
    this.tick = 0;
  }
}
