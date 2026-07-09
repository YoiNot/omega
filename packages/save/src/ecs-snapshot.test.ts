import { describe, it, expect } from 'vitest';
import { Rng, World } from '@omega/engine-core';
import { snapshotWorld, restoreWorld } from './ecs-snapshot.js';

interface Position { x: number; y: number }
interface Health { hp: number }

describe('ecs-snapshot', () => {
  it('snapshots and restores a World preserving component data + entity count', () => {
    const rng = new Rng(0x1234n);
    const world = new World();
    for (let i = 0; i < 5; i++) {
      const id = world.createEntity();
      world.addComponent<Position>('Position', id, {
        x: Math.floor(rng.nextF64() * 100),
        y: Math.floor(rng.nextF64() * 100),
      });
      world.addComponent<Health>('Health', id, { hp: Math.floor(rng.nextF64() * 50) + 1 });
    }

    const snap = snapshotWorld(world, ['Position', 'Health']);
    expect(snap.entities.length).toBe(5);

    const fresh = new World();
    restoreWorld(fresh, snap);
    expect(fresh.count()).toBe(5);

    const snap2 = snapshotWorld(fresh, ['Position', 'Health']);
    // Component data deep-equals (ids allocated identically from empty world).
    expect(snap2).toEqual(snap);
  });

  it('only captures the named components', () => {
    const world = new World();
    const id = world.createEntity();
    world.addComponent('Position', id, { x: 1, y: 2 });
    world.addComponent('Velocity', id, { dx: 9 });
    const snap = snapshotWorld(world, ['Position']);
    expect(snap.entities[0].components).toEqual({ Position: { x: 1, y: 2 } });
  });
});
