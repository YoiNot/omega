/**
 * apps/web — real WebGL2 terrain renderer.
 *
 * Renders the heightfield mesh produced by @omega/render with a real shader
 * program (vertex colors + simple directional lighting from normals). This is the
 * browser-side rendering surface; the engine package supplies the pure, tested
 * mesh/normal/color builders it consumes.
 */

const VERT = `#version 300 es
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec4 aColor;
uniform mat4 uViewProj;
out vec3 vNormal;
out vec4 vColor;
void main() {
  vNormal = aNormal;
  vColor = aColor;
  gl_Position = uViewProj * vec4(aPos, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;
in vec3 vNormal;
in vec4 vColor;
out vec4 fragColor;
void main() {
  vec3 lightDir = normalize(vec3(0.4, 0.8, 0.3));
  float diff = max(dot(normalize(vNormal), lightDir), 0.0) * 0.8 + 0.2;
  fragColor = vec4(vColor.rgb * diff, 1.0);
}`;

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error(`Shader compile failed: ${log}`);
  }
  return sh;
}

function link(gl: WebGL2RenderingContext, vs: WebGLShader, fs: WebGLShader): WebGLProgram {
  const p = gl.createProgram()!;
  gl.attachShader(p, vs);
  gl.attachShader(p, fs);
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(p);
    gl.deleteProgram(p);
    throw new Error(`Program link failed: ${log}`);
  }
  return p;
}

export interface GLScene {
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
  indices: Uint32Array;
}

export class TerrainRenderer {
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private indexCount = 0;
  private viewProjLoc: WebGLUniformLocation | null;

  constructor(canvas: HTMLCanvasElement, scene: GLScene) {
    const gl = canvas.getContext('webgl2');
    if (!gl) throw new Error('WebGL2 not supported in this browser');
    this.gl = gl;
    const vs = compile(gl, gl.VERTEX_SHADER, VERT);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
    this.program = link(gl, vs, fs);
    this.viewProjLoc = gl.getUniformLocation(this.program, 'uViewProj');

    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);

    this.upload('aPos', scene.positions, 3);
    this.upload('aNormal', scene.normals, 3);
    this.upload('aColor', scene.colors, 4);

    const ibo = gl.createBuffer()!;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, scene.indices, gl.STATIC_DRAW);
    this.indexCount = scene.indices.length;

    gl.bindVertexArray(null);
  }

  private upload(attrib: string, data: Float32Array, size: number): void {
    const gl = this.gl;
    const loc = gl.getAttribLocation(this.program, attrib);
    if (loc < 0) return;
    const buf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
  }

  resize(w: number, h: number): void {
    const gl = this.gl;
    if (canvasW(gl) !== w || canvasH(gl) !== h) {
      gl.canvas.width = w;
      gl.canvas.height = h;
    }
  }

  render(viewProj: Float32Array): void {
    const gl = this.gl;
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
    gl.clearColor(0.04, 0.06, 0.1, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.useProgram(this.program);
    if (this.viewProjLoc) gl.uniformMatrix4fv(this.viewProjLoc, false, viewProj);
    gl.bindVertexArray(this.vao);
    gl.drawElements(gl.TRIANGLES, this.indexCount, gl.UNSIGNED_INT, 0);
    gl.bindVertexArray(null);
  }
}

function canvasW(gl: WebGL2RenderingContext): number {
  return (gl.canvas as HTMLCanvasElement).width;
}
function canvasH(gl: WebGL2RenderingContext): number {
  return (gl.canvas as HTMLCanvasElement).height;
}
