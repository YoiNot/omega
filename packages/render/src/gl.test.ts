import { describe, it, expect } from 'vitest';
import { WebGL2Renderer, GL, type GLLike } from './gl.js';
import { HeightfieldMeshBuilder, computeNormals } from './mesh.js';
import { Mat4 } from '@omega/engine-math';

/**
 * A recording fake implementing GLLike. It is a test double for the GL API
 * (allowed by the task) and lets us assert which GL calls would be issued.
 */
class RecordingGL implements GLLike {
  calls: string[] = [];
  buffers = 0;
  programs = 0;

  createBuffer(): any { this.calls.push('gl.createBuffer'); return { id: ++this.buffers }; }
  bindBuffer(_t: number, _d: any): void { this.calls.push('gl.bindBuffer'); }
  bufferData(_t: number, _d: any, _u: number): void { this.calls.push('gl.bufferData'); }
  enableVertexAttribArray(_i: number): void { this.calls.push('gl.enableVertexAttribArray'); }
  vertexAttribPointer(_i: number, _sz: number, _type: number, _n: boolean, _s: number, _o: number): void { this.calls.push('gl.vertexAttribPointer'); }
  useProgram(_p: any): void { this.calls.push('gl.useProgram'); }
  getUniformLocation(_p: any, _n: string): any { this.calls.push('gl.getUniformLocation'); return { loc: 1 }; }
  uniformMatrix4fv(_l: any, _tr: boolean, _d: Float32Array | number[]): void { this.calls.push('gl.uniformMatrix4fv'); }
  drawElements(_m: number, _c: number, _t: number, _o: number): void { this.calls.push('gl.drawElements'); }
  clearColor(_r: number, _g: number, _b: number, _a: number): void { this.calls.push('gl.clearColor'); }
  clear(_mask: number): void { this.calls.push('gl.clear'); }
  createProgram(): any { this.calls.push('gl.createProgram'); return { id: ++this.programs }; }
}

function makeMesh() {
  const w = 4, h = 4;
  const heightmap = new Float32Array(w * h).fill(0);
  const mesh = new HeightfieldMeshBuilder(heightmap, w, h, 1).build();
  computeNormals(mesh.positions, mesh.indices);
  return mesh;
}

describe('WebGL2Renderer', () => {
  it('clear() records clear and issues clearColor + clear', () => {
    const gl = new RecordingGL();
    const r = new WebGL2Renderer(gl);
    r.clear(0.1, 0.2, 0.3, 1);

    expect(r.calls).toContain('clear');
    expect(gl.calls).toContain('gl.clearColor');
    expect(gl.calls).toContain('gl.clear');
  });

  it('two buffers => two createBuffer records', () => {
    const gl = new RecordingGL();
    const r = new WebGL2Renderer(gl);
    r.createBuffer(new Float32Array([1, 2, 3]));
    r.createBuffer(new Float32Array([4, 5, 6]));

    expect(r.calls.filter((c) => c === 'createBuffer')).toHaveLength(2);
    expect(gl.buffers).toBe(2);
  });

  it('drawMesh issues buffer + drawElements and records high-level commands', () => {
    const gl = new RecordingGL();
    const r = new WebGL2Renderer(gl);
    const mesh = makeMesh();
    const vp = new Mat4();

    r.drawMesh(mesh, vp);

    expect(r.calls).toContain('createBuffer');
    expect(r.calls).toContain('drawElements');
    expect(gl.calls).toContain('gl.drawElements');
    expect(gl.calls).toContain('gl.uniformMatrix4fv');
    expect(gl.calls).toContain('gl.vertexAttribPointer');
  });

  it('createBuffer records even when GL is null (pure recording)', () => {
    const r = new WebGL2Renderer(null);
    r.createBuffer(new Float32Array([1]));
    expect(r.calls).toEqual(['createBuffer']);
    expect(r.gl).toBeNull();
  });

  it('clear records when GL is null', () => {
    const r = new WebGL2Renderer(null);
    r.clear(0, 0, 0, 1);
    expect(r.calls).toEqual(['clear']);
  });

  it('drawMesh records commands when GL is null', () => {
    const r = new WebGL2Renderer(null);
    const mesh = makeMesh();
    r.drawMesh(mesh, new Mat4());
    expect(r.calls).toContain('createBuffer');
    expect(r.calls).toContain('drawElements');
  });

  it('exposes GL enum constants', () => {
    expect(GL.TRIANGLES).toBe(0x0004);
    expect(GL.UNSIGNED_INT).toBe(0x1405);
    expect(GL.ARRAY_BUFFER).toBe(0x8892);
  });
});
