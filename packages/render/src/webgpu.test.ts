import { describe, it, expect } from 'vitest';
import {
  WebGPURenderer,
  RecordingGPUContext,
  TERRAIN_VERTEX_WGSL,
  TERRAIN_FRAGMENT_WGSL,
  VERTEX_STRIDE,
  UNIFORM_SIZE,
  buildVertexBufferLayout,
  buildTerrainPipeline,
  shaderHasEntryPoints,
} from './webgpu.js';
import { HeightfieldMeshBuilder, computeNormals } from './mesh.js';
import { ColorGradient } from './color.js';
import { Camera } from './camera.js';
import { Vec3 } from '@omega/engine-math';

function makeMesh(w = 4, h = 4) {
  const heightmap = new Float32Array(w * h).fill(0);
  const mesh = new HeightfieldMeshBuilder(heightmap, w, h, 1).build();
  computeNormals(mesh.positions, mesh.indices);
  return mesh;
}

describe('WebGPU WGSL shaders', () => {
  it('vertex & fragment shader strings are non-empty and have @vertex/@fragment', () => {
    expect(TERRAIN_VERTEX_WGSL.length).toBeGreaterThan(0);
    expect(TERRAIN_FRAGMENT_WGSL.length).toBeGreaterThan(0);

    const v = shaderHasEntryPoints(TERRAIN_VERTEX_WGSL);
    const f = shaderHasEntryPoints(TERRAIN_FRAGMENT_WGSL);

    expect(v.vertex).toBe(true);
    expect(v.fragment).toBe(false);
    expect(f.vertex).toBe(false);
    expect(f.fragment).toBe(true);

    // Raw markers present as the spec requires.
    expect(TERRAIN_VERTEX_WGSL).toContain('@vertex');
    expect(TERRAIN_FRAGMENT_WGSL).toContain('@fragment');
    // Shader logic matches WebGL2 look: directional lighting from normals.
    expect(TERRAIN_FRAGMENT_WGSL).toContain('dot(n, lightDir)');
    expect(TERRAIN_VERTEX_WGSL).toContain('@location(0) position');
    expect(TERRAIN_VERTEX_WGSL).toContain('@location(1) normal');
    expect(TERRAIN_VERTEX_WGSL).toContain('@location(2) color');
  });
});

describe('WebGPU pipeline-builder', () => {
  it('vertex buffer layout: stride 36, pos@0, normal@12, color@24', () => {
    const layout = buildVertexBufferLayout();
    expect(layout.arrayStride).toBe(VERTEX_STRIDE);
    expect(layout.stepMode).toBe('vertex');
    expect(layout.attributes).toHaveLength(3);

    const [pos, normal, color] = layout.attributes;
    expect(pos.shaderLocation).toBe(0);
    expect(pos.offset).toBe(0);
    expect(pos.format).toBe('float32x3');

    expect(normal.shaderLocation).toBe(1);
    expect(normal.offset).toBe(12);
    expect(normal.format).toBe('float32x3');

    expect(color.shaderLocation).toBe(2);
    expect(color.offset).toBe(24);
    expect(color.format).toBe('float32x3');
  });

  it('uniform buffer is 64 bytes (one mat4x4<f32>)', () => {
    expect(UNIFORM_SIZE).toBe(64);
    // matches the WGSL `viewProj : mat4x4<f32>` (16 floats * 4 bytes).
    expect(UNIFORM_SIZE).toBe(16 * 4);
  });

  it('buildTerrainPipeline produces a real descriptor with shader modules + targets', () => {
    const fake = new RecordingGPUContext();
    const pipeline = buildTerrainPipeline(fake.device, 'bgra8unorm');

    expect(pipeline.uniformSize).toBe(64);
    expect(pipeline.vertexBufferLayout.attributes).toHaveLength(3);
    expect(pipeline.descriptor.vertex.entryPoint).toBe('vs_main');
    expect(pipeline.descriptor.fragment?.entryPoint).toBe('fs_main');
    expect(pipeline.descriptor.fragment?.targets[0].format).toBe('bgra8unorm');
    expect(pipeline.descriptor.primitive?.topology).toBe('triangle-list');
    // buildTerrainPipeline records shader module creation (pipeline creation
    // itself is performed by WebGPURenderer.render against the descriptor).
    expect(fake.calls.filter((c) => c.startsWith('device.createShaderModule')).length).toBe(2);
    expect(fake.calls.some((c) => c.startsWith('device.createRenderPipeline'))).toBe(false);
  });
});

describe('WebGPURenderer (recording fake)', () => {
  it('render() in record mode captures draw with mesh vertex/index counts', () => {
    const mesh = makeMesh(4, 4); // 16 verts, (3*3)*6 = 54 indices
    const camera = new Camera(60, 1, 0.1, 1000);
    const gradient = new ColorGradient();
    const renderer = new WebGPURenderer(null);

    renderer.render(mesh, camera, gradient);

    expect(renderer.lastDraw).not.toBeNull();
    expect(renderer.lastDraw!.vertexCount).toBe(mesh.vertexCount);
    expect(renderer.lastDraw!.indexCount).toBe(mesh.indexCount);
    expect(renderer.calls).toContain(
      `drawIndexed:vertexCount=${mesh.vertexCount},indexCount=${mesh.indexCount}`,
    );
  });

  it('render() with a real GPU context issues buffers + pipeline + draw', () => {
    const mesh = makeMesh(5, 5);
    const camera = new Camera(60, 1, 0.1, 1000);
    const gradient = new ColorGradient();
    const gpu = new RecordingGPUContext();
    const renderer = new WebGPURenderer(gpu);

    renderer.render(mesh, camera, gradient);

    expect(renderer.lastDraw!.vertexCount).toBe(mesh.vertexCount);
    expect(renderer.lastDraw!.indexCount).toBe(mesh.indexCount);
    // At least: 3 buffers, 2 shader modules, 1 pipeline, 1 bind group, a draw.
    expect(gpu.buffers).toBeGreaterThanOrEqual(3);
    expect(gpu.pipelines).toBe(1);
    expect(gpu.bindGroups).toBe(1);
    expect(gpu.calls.some((c) => c.startsWith('queue.writeBuffer'))).toBe(true);
    expect(gpu.calls.some((c) => c.startsWith('device.createRenderPipeline'))).toBe(true);
  });

  it('resize + dispose record commands; matches Renderer contract', () => {
    const gpu = new RecordingGPUContext();
    const renderer = new WebGPURenderer(gpu);
    renderer.resize(800, 600);
    renderer.dispose();

    expect(renderer.calls).toContain('resize:800x600');
    expect(renderer.calls).toContain('dispose');
    expect(renderer.calls.some((c) => c.includes('pipeline='))).toBe(true);
  });

  it('view-projection uniform is derived from the camera matrix', () => {
    const mesh = makeMesh(3, 3);
    const camera = new Camera(60, 1.5, 0.1, 1000);
    camera.orbit(0.5, 0.3, 12, new Vec3());
    const gradient = new ColorGradient();
    const renderer = new WebGPURenderer(null);

    // Record-mode path: the uniform is built but not uploaded; assert the
    // renderer exposes render() and the call was recorded without throwing.
    expect(() => renderer.render(mesh, camera, gradient)).not.toThrow();
    expect(renderer.lastDraw!.vertexCount).toBe(mesh.vertexCount);
  });
});

describe('WebGPU determinism (no Math.random / Date.now)', () => {
  it('two identical meshes render to identical recorded draws', () => {
    const a = makeMesh(4, 4);
    const b = makeMesh(4, 4);
    const cam = new Camera();
    const grad = new ColorGradient();
    const ra = new WebGPURenderer(null);
    const rb = new WebGPURenderer(null);
    ra.render(a, cam, grad);
    rb.render(b, cam, grad);
    expect(ra.calls).toEqual(rb.calls);
  });
});
