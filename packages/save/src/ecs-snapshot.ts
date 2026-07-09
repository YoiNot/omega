import type { World } from '@omega/engine-core';

export interface EntitySnapshot {
  id: number;
  components: Record<string, unknown>;
}

export interface WorldSnapshot {
  entities: EntitySnapshot[];
}

/**
 * Capture a JSON-able snapshot of a World.
 *
 * `componentNames` MUST list every component type you want persisted — the ECS
 * exposes stores by name, and only the named stores are read. Component values
 * are captured by reference (they must be JSON-serializable for the save file).
 * Entities that have at least one of the named components are included.
 */
export function snapshotWorld(world: World, componentNames: string[]): WorldSnapshot {
  const byEntity = new Map<number, Record<string, unknown>>();
  for (const name of componentNames) {
    const store = world.store(name);
    for (const id of store.keys()) {
      const comp = world.getComponent(name, id);
      if (comp === undefined) continue;
      let bag = byEntity.get(id);
      if (!bag) {
        bag = {};
        byEntity.set(id, bag);
      }
      bag[name] = comp;
    }
  }
  const ids = [...byEntity.keys()].sort((a, b) => a - b);
  return {
    entities: ids.map((id) => ({ id, components: byEntity.get(id)! })),
  };
}

/**
 * Clear `world` and rebuild entities/components from a snapshot using only the
 * public engine-core API. Entity ids are freshly allocated (component data and
 * entity count are preserved; original ids are not guaranteed since snapshots
 * carry no cross-entity references).
 */
export function restoreWorld(world: World, snap: WorldSnapshot): void {
  world.clear();
  for (const ent of snap.entities) {
    const id = world.createEntity();
    for (const [name, value] of Object.entries(ent.components)) {
      world.addComponent(name, id, value as object);
    }
  }
}
