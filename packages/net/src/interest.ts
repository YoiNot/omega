/**
 * @omega/net — deterministic interest management.
 *
 * Given each client's observer position + view radius, and a list of entities
 * with positions + radii, compute the set of entities relevant to that client.
 * An entity is relevant when the (Euclidean) distance from the observer to the
 * entity centre is within `observerRadius + entityRadius`.
 *
 * Determinism: pure geometry. No clocks, no RNG, no hash maps with
 * nondeterministic iteration. Output is always an ascending-id `Set<number>`,
 * so identical inputs produce a byte-for-byte identical relevance set across
 * peers and runs. The higher-level `InterestManager` iterates clients and
 * entities in ascending-id order for the same guarantee on the multi-client map.
 */

/** A 2D point. */
export interface Vec2 {
  readonly x: number;
  readonly y: number;
}

/** An entity as seen by the interest pass: id + position + relevance radius. */
export interface EntityView extends Vec2 {
  readonly id: number;
  /** Relevance radius of this entity (added to the observer's view radius). */
  readonly radius: number;
}

/**
 * Compute the set of entity ids relevant to an observer at `(ox, oy)` with
 * view `radius`. An entity is relevant iff `dist(observer, entity) <= radius +
 * entity.radius`. The returned set is sorted ascending by id.
 */
export function computeRelevant(
  ox: number,
  oy: number,
  radius: number,
  entities: readonly EntityView[],
): Set<number> {
  const out = new Set<number>();
  for (const e of entities) {
    if (!isRelevant(ox, oy, radius, e)) continue;
    out.add(e.id);
  }
  return out;
}

/** Pure predicate used by {@link computeRelevant}. */
export function isRelevant(ox: number, oy: number, radius: number, e: EntityView): boolean {
  const dx = e.x - ox;
  const dy = e.y - oy;
  const reach = radius + e.radius;
  return dx * dx + dy * dy <= reach * reach;
}

/** Per-client observer state. */
export interface Observer {
  readonly x: number;
  readonly y: number;
  readonly radius: number;
}

/**
 * Stateful, deterministic interest manager. Tracks each client's observer state
 * and recomputes, on demand, the full `Map<clientId, Set<entityId>>` of
 * relevance over a shared entity list. Iteration is always ascending-id for
 * both clients and entities, so the produced map is a pure function of the
 * registered observers and the entity list.
 */
export class InterestManager {
  private readonly observers = new Map<number, Observer>();

  /** Register or update a client's observer state. */
  setObserver(clientId: number, observer: Observer): void {
    this.observers.set(clientId, observer);
  }

  /** Drop a client (e.g. on disconnect). */
  removeObserver(clientId: number): void {
    this.observers.delete(clientId);
  }

  get observerCount(): number {
    return this.observers.size;
  }

  /**
   * Recompute relevance for every registered observer against `entities`.
   * Returns a map keyed by client id (ascending iteration order) whose values
   * are ascending-id entity-id sets. Clients observe themselves iff they map to
   * an entity id via `observerEntityId`; self-observation is off by default.
   */
  compute(entities: readonly EntityView[]): Map<number, Set<number>> {
    const result = new Map<number, Set<number>>();
    const clientIds = [...this.observers.keys()].sort((a, b) => a - b);
    for (const cid of clientIds) {
      const obs = this.observers.get(cid)!;
      result.set(cid, computeRelevant(obs.x, obs.y, obs.radius, entities));
    }
    return result;
  }

  /** Relevance for a single client (sorted ascending set). */
  forClient(clientId: number, entities: readonly EntityView[]): Set<number> | undefined {
    const obs = this.observers.get(clientId);
    if (!obs) return undefined;
    return computeRelevant(obs.x, obs.y, obs.radius, entities);
  }
}
