/**
 * @omega/render — PBR + LOD renderer-path tests.
 *
 * The backend renderers (WebGL2 + WebGPU) now expose `renderPbr` and
 * `renderLod`. These assert the high-level command encodings are produced
 * deterministically (same mesh/material/camera => same recorded calls) and that
 * the LOD dispatch selects a level purely from camera distance (no clock).
 */
import { describe, it, expect } from 'vitest';
import { WebGL2Renderer } from './gl.js';
import { WebGPURenderer, RecordingGPUContext } from './webgpu.js';
import {
  defaultPbrMaterial,
  defaultSun,
  defaultEnvironment,
  selectLodLevel,
  defaultThresholds,
  buildLodMesh,
} from './index.js';
import { HeightfieldMeshBuilder } from './mesh.js';
import { ColorGradient } from './color.js';
import { Camera } from './camera.js';
import { Vec3 } from '@omega/engine-math';

function makeMesh(w = 4, h = 4) {
  const heightmap = new Float32Array(w * h).fill(0);
  return new HeightfieldMeshBuilder(heightmap, w, h, 1).build();
}

function pbrInput() {
  return {
    material: defaultPbrMaterial(),
    sun: defaultSun(),
    environment: defaultEnvironment(),
  };
}

describe('PBR renderer paths', () => {
  it('WebGL2Renderer.renderPbr records a pbr draw + uniform', () => {
    const r = new WebGL2Renderer(null);
    const mesh = makeMesh(4, 4);
    const cam = new Camera(60, 1, 0.1, 1000);
    r.renderPbr(mesh, cam, pbrInput());
    expect(r.calls).toContain('clear');
    expect(r.calls.some((c) => c.startsWith('drawIndexedPbr:'))).toBe(true);
    expect(r.calls.some((c) => c.startsWith('pbrUniform:'))).toBe(true);
  });

  it('WebGL2Renderer throws when cascades < 1 (invalid config)', () => {
    const r = new WebGL2Renderer(null);
    const mesh = makeMesh(4, 4);
    const cam = new Camera();
    const bad = pbrInput();
    bad.sun.shadows = { cascades: 0, lambda: 0.6, texelSize: 1, bias: 0.01 };
    expect(() => r.renderPbr(mesh, cam, bad)).toThrow();
  });

  it('WebGPURenderer.renderPbr records drawIndexedPbr + uniform (record mode)', () => {
    const r = new WebGPURenderer(null);
    const mesh = makeMesh(5, 5);
    const cam = new Camera(60, 1, 0.1, 1000);
    r.renderPbr(mesh, cam, pbrInput());
    expect(r.calls).toContain('renderPbr');
    expect(r.calls).toContain('drawIndexedPbr:vertexCount=25,indexCount=96');
    expect(r.calls.some((c) => c.startsWith('pbrUniform:'))).toBe(true);
    expect(r.lastDraw!.vertexCount).toBe(25);
  });

  it('WebGPU renderPbr with a real GPU context issues buffers + pipeline', () => {
    const gpu = new RecordingGPUContext();
    const r = new WebGPURenderer(gpu);
    const mesh = makeMesh(4, 4);
    const cam = new Camera(60, 1, 0.1, 1000);
    r.renderPbr(mesh, cam, pbrInput());
    expect(gpu.buffers).toBeGreaterThanOrEqual(3);
    expect(gpu.pipelines).toBe(1);
    expect(gpu.calls.some((c) => c.startsWith('device.createRenderPipeline'))).toBe(true);
  });

  it('identical PBR inputs => identical recorded uniform (determinism)', () => {
    const a = new WebGL2Renderer(null);
    const b = new WebGL2Renderer(null);
    const mesh = makeMesh(4, 4);
    const cam = new Camera();
    a.renderPbr(mesh, cam, pbrInput());
    b.renderPbr(mesh, cam, pbrInput());
    const ua = a.calls.find((c) => c.startsWith('pbrUniform:'))!;
    const ub = b.calls.find((c) => c.startsWith('pbrUniform:'))!;
    expect(ua).toEqual(ub);
  });
});

describe('LOD dispatch', () => {
  it('selectLodLevel is monotonic non-decreasing with distance', () => {
    const thresholds = defaultThresholds(3); // 2 levels + coarsest
    let prev = -1;
    for (let d = 0; d <= 200; d += 1) {
      const lvl = selectLodLevel(d, thresholds, 3);
      expect(lvl).toBeGreaterThanOrEqual(prev);
      expect(lvl).toBeLessThan(3);
      prev = lvl;
    }
  });

  it('near distance => level 0 (full detail); far => coarsest', () => {
    const thresholds = defaultThresholds(3);
    expect(selectLodLevel(0, thresholds, 3)).toBe(0);
    expect(selectLodLevel(1e9, thresholds, 3)).toBe(2);
  });

  it('single-level mesh always yields level 0', () => {
    expect(selectLodLevel(99999, [], 1)).toBe(0);
  });

  it('renderLod selects the same level for the same camera distance', () => {
    const fine = makeMesh(8, 8);
    const coarse = makeMesh(4, 4);
    const lod = buildLodMesh('m', { x: 0, y: 0, z: 0 }, [{ mesh: fine }, { mesh: coarse }]);
    const cam = new Camera(60, 1, 0.1, 1000);
    cam.setPosition(new Vec3(100, 5, 0)); // far from origin => coarser
    const r = new WebGL2Renderer(null);
    r.renderLod(lod, cam, pbrInput());
    const sel = r.calls.find((c) => c.startsWith('lodSelect:'))!;
    expect(sel).toContain('level=');
    // Same camera => identical selection + draw calls.
    const r2 = new WebGL2Renderer(null);
    r2.renderLod(lod, cam, pbrInput());
    expect(r2.calls.find((c) => c.startsWith('lodSelect:'))).toEqual(sel);
  });

  it('WebGPU renderLod records the selected level + pbr draw', () => {
    const fine = makeMesh(8, 8);
    const coarse = makeMesh(4, 4);
    const lod = buildLodMesh('m', { x: 0, y: 0, z: 0 }, [{ mesh: fine }, { mesh: coarse }]);
    const cam = new Camera(60, 1, 0.1, 1000);
    cam.setPosition(new Vec3(0, 5, 40)); // mid distance
    const r = new WebGPURenderer(null);
    r.renderLod(lod, cam, pbrInput());
    expect(r.calls.some((c) => c.startsWith('lodSelect:dist='))).toBe(true);
    expect(r.calls.some((c) => c.startsWith('drawIndexedPbr:'))).toBe(true);
  });
});

describe('integration: gradient path still works', () => {
  it('legacy render() untouched by PBR additions', () => {
    const r = new WebGL2Renderer(null);
    const mesh = makeMesh(4, 4);
    const cam = new Camera();
    const grad = new ColorGradient();
    expect(() => r.render(mesh, cam, grad)).not.toThrow();
    expect(r.calls).toContain('drawElements');
  });
});
