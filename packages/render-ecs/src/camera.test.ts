import { describe, it, expect } from 'vitest';
import { World } from '@omega/ecs';
import { Vec3, Mat4 } from '@omega/engine-math';
import { Camera } from '@omega/render';
import { Renderable, Transform } from './components.js';
import { extractDrawList, modelMatrix, projectModel } from './drawlist.js';

describe('camera + transform projection', () => {
  it('model matrix translation is composed into world space', () => {
    const world = new World();
    const e = world.createEntity();
    world.addComponent(e, Renderable, { meshId: 'c', color: [1, 1, 1, 255] });
    world.addComponent(e, Transform, { pos: new Vec3(1, 2, 3) });

    const items = extractDrawList(world);
    // translation column of the model matrix
    expect(Array.from(items[0].transform.m).slice(12, 15)).toEqual([1, 2, 3]);
  });

  it('rotating a transform bakes into the model matrix (no translation change)', () => {
    const t = {
      pos: new Vec3(4, 0, 0),
      rot: new Vec3(0, Math.PI / 2, 0),
      scale: new Vec3(1, 1, 1),
    };
    const m = modelMatrix(t);
    expect(Array.from(m.m).slice(12, 15)).toEqual([4, 0, 0]);
    // rotation about Y by 90deg: x-axis maps to -z direction => m[8] ≈ -1
    expect(m.m[8]).toBeCloseTo(-1, 5);
    expect(m.m[0]).toBeCloseTo(0, 5);
  });

  it('projectModel multiplies viewProjection * model', () => {
    const world = new World();
    const e = world.createEntity();
    world.addComponent(e, Renderable, { meshId: 'p', color: [1, 1, 1, 255] });
    world.addComponent(e, Transform, { pos: new Vec3(0, 0, -3) });

    const camera = new Camera();
    const items = extractDrawList(world, camera);
    const expected = new Mat4();
    Mat4.multiply(expected, camera.getViewProjection(), modelMatrix({ pos: new Vec3(0, 0, -3) }));
    expect(Array.from(items[0].transform.m)).toEqual(Array.from(expected.m));
  });

  it('projectModel yields a different matrix than world-space model when camera moves', () => {
    const camA = new Camera();
    const camB = new Camera();
    camB.setPosition(new Vec3(0, 0, 20));

    const model = modelMatrix({ pos: new Vec3(2, 0, 0) });
    const pa = projectModel(model, camA);
    const pb = projectModel(model, camB);
    expect(Array.from(pa.m)).not.toEqual(Array.from(pb.m));
  });
});
