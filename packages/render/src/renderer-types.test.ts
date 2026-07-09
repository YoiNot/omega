import { describe, it, expect } from 'vitest';
import { WebGL2Renderer } from './gl.js';
import { WebGPURenderer, RecordingGPUContext } from './webgpu.js';
import { createRenderer } from './renderer.js';
import type { Renderer } from './renderer-types.js';
import { HeightfieldMeshBuilder, computeNormals } from './mesh.js';
import { ColorGradient } from './color.js';
import { Camera } from './camera.js';

/**
 * Compile-time conformance check: both renderers are structurally assignable to
 * the shared {@link Renderer} interface. If either drifts, this errors at build.
 */
function expectRenderer<R extends Renderer>(_r: R): void {}

expectRenderer<WebGL2Renderer>(null as unknown as WebGL2Renderer);
expectRenderer<WebGPURenderer>(null as unknown as WebGPURenderer);

/** A recording fake implementing GLLike (mirrors gl.test.ts). */
class RecordingGL {
  calls: string[] = [];
  buffers = 0;
  programs = 0;
  createBuffer() { this.calls.push('gl.createBuffer'); return { id: ++this.buffers }; }
  bindBuffer() { this.calls.push('gl.bindBuffer'); }
  bufferData() { this.calls.push('gl.bufferData'); }
  enableVertexAttribArray() { this.calls.push('gl.enableVertexAttribArray'); }
  vertexAttribPointer() { this.calls.push('gl.vertexAttribPointer'); }
  useProgram() { this.calls.push('gl.useProgram'); }
  getUniformLocation() { this.calls.push('gl.getUniformLocation'); return { loc: 1 }; }
  uniformMatrix4fv() { this.calls.push('gl.uniformMatrix4fv'); }
  drawElements() { this.calls.push('gl.drawElements'); }
  clearColor() { this.calls.push('gl.clearColor'); }
  clear() { this.calls.push('gl.clear'); }
  createProgram() { this.calls.push('gl.createProgram'); return { id: ++this.programs }; }
}

function makeMesh(w = 4, h = 4) {
  const heightmap = new Float32Array(w * h).fill(0);
  const mesh = new HeightfieldMeshBuilder(heightmap, w, h, 1).build();
  computeNormals(mesh.positions, mesh.indices);
  return mesh;
}

describe('Renderer interface conformance', () => {
  const mesh = makeMesh(4, 4);
  const camera = new Camera(60, 1, 0.1, 1000);
  const gradient = new ColorGradient();

  it('WebGL2Renderer satisfies Renderer and renders', () => {
    const gl = new RecordingGL() as any;
    const r: Renderer = new WebGL2Renderer(gl);
    expect(() => r.render(mesh, camera, gradient)).not.toThrow();
    r.resize(800, 600);
    r.dispose();
    expect(r).toBeInstanceOf(WebGL2Renderer);
  });

  it('WebGPURenderer satisfies Renderer and renders (record mode)', () => {
    const r: Renderer = new WebGPURenderer(null);
    expect(() => r.render(mesh, camera, gradient)).not.toThrow();
    r.resize(800, 600);
    r.dispose();
    expect(r).toBeInstanceOf(WebGPURenderer);
  });

  it('createRenderer returns a WebGPURenderer when gpu is supplied', () => {
    const gpu = new RecordingGPUContext();
    const r = createRenderer(null, { gpu });
    expect(r).toBeInstanceOf(WebGPURenderer);
    expect(() => r.render(mesh, camera, gradient)).not.toThrow();
  });

  it('createRenderer falls back to WebGL2Renderer when only gl is supplied', () => {
    const gl = new RecordingGL() as any;
    const r = createRenderer(null, { gl });
    expect(r).toBeInstanceOf(WebGL2Renderer);
  });

  it('createRenderer with no surfaces yields a WebGL2Renderer in pure-record mode', () => {
    const r = createRenderer(null, {});
    expect(r).toBeInstanceOf(WebGL2Renderer);
    // Pure record mode: render just logs, no throw.
    expect(() => r.render(mesh, camera, gradient)).not.toThrow();
  });
});
