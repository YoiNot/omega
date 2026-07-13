/**
 * @omega/render — minimal G-Buffer pass for AO/post-processing.
 *
 * The browser demo's TerrainRenderer (apps/web/src/renderer.ts) renders straight
 * to the default framebuffer with NO offscreen targets, and its PBR frag shader
 * hard-codes the view vector to (0,1,0). That makes screen-space AO impossible:
 * GTAO needs per-pixel view-space depth + normals as textures. This module is
 * the isolated Spike that adds exactly that — a G-Buffer — without touching the
 * shipping renderer.
 *
 * It is a self-contained mini-renderer (own programs, own VAOs) so the Spike is
 * fully isolated and reversible. If the AO proof lands, this becomes the seed
 * for either (a) wiring into @omega/render or (b) porting into apps/web.
 *
 * Determinism: all shader math uses the det_* helpers from determinism.ts, so
 * the G-Buffer (and everything downstream) is a pure function of inputs+seed.
 */

export interface GLScene {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
}

const GEO_VERT = /* glsl */ `#version 300 es
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aNormal;
uniform mat4 uViewProj;
uniform mat4 uModel;
out vec3 vViewPos;
out vec3 vViewNormal;
void main() {
  vec4 world = uModel * vec4(aPos, 1.0);
  vec4 view = uViewProj * world;
  vViewPos = view.xyz;                 // view-space position (for depth/linearZ)
  vViewNormal = mat3(uViewProj) * aNormal; // approx view normal (no separate normal matrix)
  gl_Position = view;
}`;

// MRT frag: target 0 = view-space normal (RGB16F), target 1 = linear depth (R16F)
const GEO_FRAG = /* glsl */ `#version 300 es
precision highp float;
in vec3 vViewPos;
in vec3 vViewNormal;
layout(location = 0) out vec4 oNormal;
layout(location = 1) out vec4 oDepth;
void main() {
  vec3 n = normalize(vViewNormal);
  oNormal = vec4(n * 0.5 + 0.5, 1.0);          // pack normal to [0,1]
  oDepth = vec4(length(vViewPos), 0.0, 0.0, 1.0); // linear view-space distance
}`;

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error(`G-Buffer shader compile failed: ${log}`);
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
    throw new Error(`G-Buffer link failed: ${log}`);
  }
  return p;
}

export interface GBuffer {
  fbo: WebGLFramebuffer;
  normalTex: WebGLTexture;
  depthTex: WebGLTexture;
  width: number;
  height: number;
  dispose(): void;
}

export class GBufferPass {
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private locViewProj: WebGLUniformLocation | null;
  private locModel: WebGLUniformLocation | null;
  private gbuffer: GBuffer;
  private indexCount: number;

  constructor(gl: WebGL2RenderingContext, scene: GLScene, width: number, height: number) {
    this.indexCount = scene.indices.length;
    this.gl = gl;
    const vs = compile(gl, gl.VERTEX_SHADER, GEO_VERT);
    const fs = compile(gl, gl.FRAGMENT_SHADER, GEO_FRAG);
    this.program = link(gl, vs, fs);
    this.locViewProj = gl.getUniformLocation(this.program, 'uViewProj');
    this.locModel = gl.getUniformLocation(this.program, 'uModel');

    // Build geometry VAO.
    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    this.upload('aPos', scene.positions, 3);
    this.upload('aNormal', scene.normals, 3);
    const ibo = gl.createBuffer()!;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, scene.indices, gl.STATIC_DRAW);
    gl.bindVertexArray(null);

    this.gbuffer = this.allocTargets(width, height);
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

  private allocTargets(w: number, h: number): GBuffer {
    const gl = this.gl;
    const fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);

    // Prefer float targets (real GPUs) for precision; fall back to 8-bit when
    // EXT_color_buffer_float is unavailable (e.g. SwiftShader headless CI).
    const ext = gl.getExtension('EXT_color_buffer_float');
    const useFloat = !!ext;
    const normFmt = useFloat ? gl.RGBA16F : gl.RGBA8;
    const depthFmt = useFloat ? gl.R16F : gl.R8;
    const normType = useFloat ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE;
    const depthType = useFloat ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE;

    const normalTex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, normalTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, normFmt, w, h, 0, gl.RGBA, normType, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, normalTex, 0);

    const depthTex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, depthTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, depthFmt, w, h, 0, gl.RED, depthType, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, depthTex, 0);

    const depthRb = gl.createRenderbuffer()!;
    gl.bindRenderbuffer(gl.RENDERBUFFER, depthRb);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depthRb);

    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error(`G-Buffer FBO incomplete: 0x${status.toString(16)}`);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { fbo, normalTex, depthTex, width: w, height: h, dispose() {} };
  }

  /** Render the scene into the G-Buffer. */
  render(viewProj: Float32Array, model: Float32Array): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.gbuffer.fbo);
    gl.viewport(0, 0, this.gbuffer.width, this.gbuffer.height);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.useProgram(this.program);
    if (this.locViewProj) gl.uniformMatrix4fv(this.locViewProj, false, viewProj);
    if (this.locModel) gl.uniformMatrix4fv(this.locModel, false, model);
    gl.bindVertexArray(this.vao);
    gl.drawElements(gl.TRIANGLES, this.indexCount, gl.UNSIGNED_INT, 0);
    gl.bindVertexArray(null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  get targets(): GBuffer {
    return this.gbuffer;
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteFramebuffer(this.gbuffer.fbo);
    gl.deleteTexture(this.gbuffer.normalTex);
    gl.deleteTexture(this.gbuffer.depthTex);
    gl.deleteProgram(this.program);
    gl.deleteVertexArray(this.vao);
  }
}
