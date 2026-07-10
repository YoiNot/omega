import { describe, it, expect } from 'vitest';
import { World } from '@omega/ecs';
import { Vec3 } from '@omega/engine-math';
import './components.js';
import { Renderable, Transform } from './components.js';
import { extractDrawList, drawOrder } from './drawlist.js';

/** Build a deterministic world with N renderables at known ids/offsets. */
function buildWorld(n: number): World {
  const world = new World();
  for (let i = 0; i < n; i++) {
    const e = world.createEntity();
    world.addComponent(
      e,
      Renderable,
      { meshId: `m${i}`, color: [i * 10, 20, 30, 255] },
    );
    world.addComponent(
      e,
      Transform,
      { pos: new Vec3(i, 0, 0), rot: new Vec3(0, 0, 0), scale: new Vec3(1, 1, 1) },
    );
  }
  return world;
}

function serialize(items: ReturnType<typeof extractDrawList>) {
  return items.map((d) => ({
    entity: d.entity,
    meshId: d.meshId,
    color: d.color,
    transform: Array.from(d.transform.m),
  }));
}

describe('extractDrawList determinism', () => {
  it('two runs over the same world are byte-identical and id-ordered', () => {
    const world = buildWorld(4);
    const a = serialize(extractDrawList(world));
    const b = serialize(extractDrawList(world));
    expect(a).toEqual(b);
    // ascending entity id order
    const ids = a.map((x) => x.entity);
    expect(ids).toEqual([...ids].sort((x, y) => x - y));
  });

  it('excludes entities with visible === false', () => {
    const world = buildWorld(3);
    // hide entity 1
    world.addComponent(world.entities()[1], Renderable, {
      meshId: 'hidden',
      color: [1, 2, 3, 255],
      visible: false,
    });
    const items = extractDrawList(world);
    expect(items.map((d) => d.entity)).toEqual([0, 2]);
    expect(drawOrder(world)).toEqual(['m0', 'm2']);
  });

  it('defaults to identity transform when no Transform component is present', () => {
    const world = new World();
    const e = world.createEntity();
    world.addComponent(e, Renderable, { meshId: 'solo', color: [9, 9, 9, 255] });
    const items = extractDrawList(world);
    expect(items).toHaveLength(1);
    const m = items[0].transform.m;
    // identity matrix
    const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    expect(Array.from(m)).toEqual(identity);
  });

  it('composes position into the model matrix', () => {
    const world = new World();
    const e = world.createEntity();
    world.addComponent(e, Renderable, { meshId: 'p', color: [1, 1, 1, 255] });
    world.addComponent(e, Transform, { pos: new Vec3(2, 3, 4) });
    const items = extractDrawList(world);
    expect(Array.from(items[0].transform.m).slice(12, 15)).toEqual([2, 3, 4]);
  });
});
