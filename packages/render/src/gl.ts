import { Mat4 } from '@omega/engine-math';
import type { MeshData } from './mesh.js';

/**
 * Minimal subset of the WebGL2 API used by {@link WebGL2Renderer}.
 * Implemented by a real WebGL2RenderingContext in the browser, or by a
 * recording fake in Node tests. This isolates GL (browser-only) from the
 * pure, Node-testable command recording logic.
 */
export interface GLLike {
  createBuffer(): any;
  bindBuffer(t: number, d: any): void;
  bufferData(t: number, d: any, u: number): void;
  enableVertexAttribArray(i: number): void;
  vertexAttribPointer(i: number, sz: number, type: number, norm: boolean, stride: number, off: number): void;
  useProgram(p: any): void;
  getUniformLocation(p: any, n: string): any;
  uniformMatrix4fv(l: any, transpose: boolean, data: Float32Array | number[]): void;
  drawElements(mode: number, count: number, type: number, off: number): void;
  clearColor(r: number, g: number, b: number, a: number): void;
  clear(mask: number): void;
  createProgram(): any;
}

const STATIC_DRAW = 0x88e4;
const ARRAY_BUFFER = 0x8892;
const ELEMENT_ARRAY_BUFFER = 0x8893;
const TRIANGLES = 0x0004;
const UNSIGNED_INT = 0x1405;
const FLOAT = 0x1406;
const COLOR_BUFFER_BIT = 0x4000;

/**
 * WebGL2 renderer abstraction. Records a sequence of high-level commands into
 * `this.calls` so behavior is asserted without a real GL context. Actual GL
 * calls are guarded by `if (this.gl)`, so a null GL yields pure recording.
 */
export class WebGL2Renderer {
  readonly gl: GLLike | null;
  readonly calls: string[] = [];
  private program: any = null;

  constructor(gl: GLLike | null) {
    this.gl = gl;
  }

  /** Clear the framebuffer to a color. Records 'clear'. */
  clear(r = 0, g = 0, b = 0, a = 1): void {
    this.calls.push('clear');
    if (this.gl) {
      this.gl.clearColor(r, g, b, a);
      this.gl.clear(COLOR_BUFFER_BIT);
    }
  }

  /** Allocate + upload a GPU buffer. Records 'createBuffer'. */
  createBuffer(
    data: ArrayBufferView | null,
    target: number = ARRAY_BUFFER,
    usage: number = STATIC_DRAW,
  ): any {
    this.calls.push('createBuffer');
    if (this.gl) {
      const buf = this.gl.createBuffer();
      this.gl.bindBuffer(target, buf);
      if (data) this.gl.bufferData(target, data, usage);
      return buf;
    }
    return null;
  }

  /** Bind the active shader program. */
  useProgram(p: any): void {
    this.program = p;
    if (this.gl) this.gl.useProgram(p);
  }

  /**
   * Record + issue a draw call for a mesh. Uploads vertex positions to a new
   * buffer, binds a program, sets the view-projection uniform, configures the
   * position attribute, and issues drawElements. Records 'createBuffer' then
   * 'drawElements'.
   */
  drawMesh(mesh: MeshData, viewProj: Mat4): void {
    // Upload vertex positions.
    this.createBuffer(mesh.positions, ARRAY_BUFFER);

    this.calls.push('drawElements');
    if (this.gl) {
      if (!this.program) this.program = this.gl.createProgram();
      this.gl.useProgram(this.program);
      const loc = this.gl.getUniformLocation(this.program, 'uViewProj');
      this.gl.uniformMatrix4fv(loc, false, viewProj.m);
      this.gl.enableVertexAttribArray(0);
      this.gl.vertexAttribPointer(0, 3, FLOAT, false, 0, 0);
      this.gl.drawElements(TRIANGLES, mesh.indexCount, UNSIGNED_INT, 0);
    }
  }
}

/** GL enum constants re-exported for callers / tests. */
export const GL = {
  STATIC_DRAW,
  ARRAY_BUFFER,
  ELEMENT_ARRAY_BUFFER,
  TRIANGLES,
  UNSIGNED_INT,
  FLOAT,
  COLOR_BUFFER_BIT,
} as const;
