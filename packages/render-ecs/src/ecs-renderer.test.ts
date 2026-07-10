import { describe, it, expect } from 'vitest';
import { World } from '@omega/ecs';
import { Vec3 } from '@omega/engine-math';
import { Camera, ColorGradient } from '@omega/render';
import type { MeshData, Renderer, RGBA } from '@omega/render';
import { Renderable, Transform } from './components.js';
import { EcsRenderer } from './ecs-renderer.js';

/** Records each renderer.render call so the sequence is assertable in Node. */
class RecordingRenderer implements Renderer {
  calls: string[] = [];
  renders: { positions: number[]; color: RGBA; viewProj: number[]; meshIdKey: string }[] = [];

  render(mesh: MeshData, camera: Camera, gradient: ColorGradient): void {
    this.calls.push('render');
    this.renders.push({
      positions: Array.from(mesh.positions),
      color: gradient.getStops()[0].color,
      viewProj: Array.from(camera.getViewProjection().m),
      meshIdKey: `${mesh.vertexCount}/${mesh.indexCount}`,
    });
  }
  resize(): void {
    this.calls.push('resize');
  }
  dispose(): void {
    this.calls.push('dispose');
  }
}

function mesh(_id: string): MeshData {
  return {
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    indices: new Uint32Array([0, 1, 2]),
    vertexCount: 3,
    indexCount: 3,
  };
}

function buildWorld(): World {
  const world = new World();
  for (let i = 0; i < 3; i++) {
    const e = world.createEntity();
    world.addComponent(e, Renderable, {
      meshId: `m${i}`,
      color: [i * 10, 10, 10, 255] as RGBA,
    });
    world.addComponent(e, Transform, { pos: new Vec3(i * 5, 0, 0) });
  }
  return world;
}

function signature(r: RecordingRenderer): string {
  return r.renders
    .map((x) => `${x.meshIdKey}|${x.color.join(',')}|${x.positions.join(',')}`)
    .join('\n');
}

describe('EcsRenderer', () => {
  it('renders one call per visible, mesh-resolved item in id order', () => {
    const world = buildWorld();
    const renderer = new RecordingRenderer();
    const ecs = new EcsRenderer(world, renderer, new Camera());
    ecs.setMesh('m0', mesh('m0'));
    ecs.setMesh('m1', mesh('m1'));
    ecs.setMesh('m2', mesh('m2'));
    ecs.render();

    expect(renderer.renders).toHaveLength(3);
    // ids 0,1,2 -> positions start at 0, 5, 10 (translation baked world-space)
    expect(renderer.renders[0].positions.slice(0, 3)).toEqual([0, 0, 0]);
    expect(renderer.renders[1].positions.slice(0, 3)).toEqual([5, 0, 0]);
    expect(renderer.renders[2].positions.slice(0, 3)).toEqual([10, 0, 0]);
  });

  it('identical worlds produce identical draw-call sequences', () => {
    const r1 = new RecordingRenderer();
    const e1 = new EcsRenderer(buildWorld(), r1, new Camera());
    e1.setMesh('m0', mesh('m0'));
    e1.setMesh('m1', mesh('m1'));
    e1.setMesh('m2', mesh('m2'));
    e1.render();

    const r2 = new RecordingRenderer();
    const e2 = new EcsRenderer(buildWorld(), r2, new Camera());
    e2.setMesh('m0', mesh('m0'));
    e2.setMesh('m1', mesh('m1'));
    e2.setMesh('m2', mesh('m2'));
    e2.render();

    expect(signature(r1)).toEqual(signature(r2));
  });

  it('moving the camera changes only the projected view matrix, not world-space vertices', () => {
    const make = () => {
      const r = new RecordingRenderer();
      const cam = new Camera();
      const ecs = new EcsRenderer(buildWorld(), r, cam);
      ecs.setMesh('m0', mesh('m0'));
      ecs.setMesh('m1', mesh('m1'));
      ecs.setMesh('m2', mesh('m2'));
      return { r, cam, ecs };
    };

    const a = make();
    a.ecs.render();
    const worldPosA = a.r.renders.map((x) => x.positions.join(','));
    const viewA = a.r.renders.map((x) => x.viewProj.join(','));

    const b = make();
    // same world, move the camera
    b.cam.setPosition(new Vec3(0, 0, 12));
    b.ecs.render();
    const worldPosB = b.r.renders.map((x) => x.positions.join(','));
    const viewB = b.r.renders.map((x) => x.viewProj.join(','));

    // world-space baked vertices are camera-independent
    expect(worldPosB).toEqual(worldPosA);
    // but the projected view matrix changed
    expect(viewB).not.toEqual(viewA);
  });
});
