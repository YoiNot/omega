/**
 * apps/web — real WebGL2 terrain renderer.
 *
 * Renders the heightfield mesh produced by @omega/render with a real shader
 * program. Two lighting paths are supported:
 *
 *   - LEGACY: vertex-color gradient + simple directional lambert (the original
 *     demo path; kept for parity / fast iteration).
 *   - PBR:    Cook-Torrance GGX metallic-roughness BRDF driven by a
 *     {@link TerrainMaterial} (albedo / roughness / metallic) and a
 *     {@link TerrainSun} directional light. This is Roadmap §8 NEXT: the
 *     real PBR shader wired into the browser TerrainRenderer instead of the
 *     legacy gradient. Lighting is fully deterministic — same material + sun
 *     + normals => identical pixels on every machine, so the rendered world
 *     stays a pure function of the seed (matching the engine's determinism
 *     contract). The PBR/Lambert BRDF math mirrors `@omega/render-pbr`'s
 *     `brdf.ts` so the browser demo and the Node tests agree.
 */

/** PBR surface material fed to the terrain shader (linear RGB, [0,1]). */
export interface TerrainMaterial {
  albedo: [number, number, number];
  roughness: number;
  metallic: number;
  emissive: [number, number, number];
}

/** Directional (sun) light fed to the terrain shader. */
export interface TerrainSun {
  /** Direction the light TRAVELS (sun -> surface), world space. */
  direction: [number, number, number];
  color: [number, number, number];
  intensity: number;
  /** Sky/ground hemisphere ambient for the indirect term. */
  ambientTop: [number, number, number];
  ambientBottom: [number, number, number];
  ambientIntensity: number;
}

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

// PBR vertex shader is identical to the legacy one (positions/normals/colors
// are uploaded either way; colors are ignored by the PBR frag shader).
const VERT_PBR = VERT;

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

// Cook-Torrance GGX metallic-roughness BRDF (deterministic). Mirrors the
// math in @omega/render-pbr/src/brdf.ts so the browser render matches Node.
const FRAG_PBR = `#version 300 es
precision highp float;
in vec3 vNormal;
in vec4 vColor;
out vec4 fragColor;

uniform vec3 uAlbedo;
uniform float uRoughness;
uniform float uMetallic;
uniform vec3 uEmissive;
uniform vec3 uSunDir;     // light travel direction (sun -> surface)
uniform vec3 uSunColor;
uniform float uSunIntensity;
uniform vec3 uAmbTop;
uniform vec3 uAmbBottom;
uniform float uAmbIntensity;

const float PI = 3.141592653589793;

float distGGX(vec3 N, vec3 H, float a) {
  float a2 = a * a;
  float NdotH = max(dot(N, H), 0.0);
  float d = (NdotH * NdotH * (a2 - 1.0) + 1.0);
  return a2 / max(PI * d * d, 1e-7);
}

float geomSmith(float NdotV, float NdotL, float a) {
  float k = (a * a) / 2.0;
  float gv = NdotV / (NdotV * (1.0 - k) + k);
  float gl = NdotL / (NdotL * (1.0 - k) + k);
  return gv * gl;
}

vec3 fresnelSchlick(float cosT, vec3 f0) {
  return f0 + (vec3(1.0) - f0) * pow(clamp(1.0 - cosT, 0.0, 1.0), 5.0);
}

void main() {
  vec3 N = normalize(vNormal);
  vec3 V = vec3(0.0, 1.0, 0.0); // terrain-locked view approximation (top-down orbit)
  vec3 L = normalize(-uSunDir); // direction TO the sun
  vec3 H = normalize(V + L);

  float NdotL = max(dot(N, L), 0.0);
  float NdotV = max(dot(N, V), 1e-4);

  vec3 f0 = mix(vec3(0.04), uAlbedo, uMetallic);
  float D = distGGX(N, H, max(uRoughness * uRoughness, 1e-4));
  float G = geomSmith(NdotV, NdotL, max(uRoughness * uRoughness, 1e-4));
  vec3 F = fresnelSchlick(max(dot(H, V), 0.0), f0);
  vec3 spec = (D * G) * F / max(4.0 * NdotV * NdotL, 1e-4);

  vec3 kd = (vec3(1.0) - F) * (1.0 - uMetallic);
  vec3 diffuse = kd * uAlbedo / PI;
  vec3 direct = (diffuse + spec) * uSunColor * uSunIntensity * NdotL;

  // Hemisphere ambient (deterministic blend by normal.y).
  float up = N.y * 0.5 + 0.5;
  vec3 ambient = mix(uAmbBottom, uAmbTop, up) * uAmbIntensity * uAlbedo;

  vec3 color = direct + ambient + uEmissive;
  fragColor = vec4(color, 1.0);
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
  /** Legacy (lambert gradient) program — always available. */
  private legacyProgram: WebGLProgram;
  /** PBR (Cook-Torrance GGX) program — built when a material is supplied. */
  private pbrProgram: WebGLProgram | null = null;
  private vao: WebGLVertexArrayObject;
  private indexCount = 0;
  private viewProjLoc: WebGLUniformLocation | null;
  private pbrLoc: {
    viewProj: WebGLUniformLocation | null;
    albedo: WebGLUniformLocation | null;
    roughness: WebGLUniformLocation | null;
    metallic: WebGLUniformLocation | null;
    emissive: WebGLUniformLocation | null;
    sunDir: WebGLUniformLocation | null;
    sunColor: WebGLUniformLocation | null;
    sunIntensity: WebGLUniformLocation | null;
    ambTop: WebGLUniformLocation | null;
    ambBottom: WebGLUniformLocation | null;
    ambIntensity: WebGLUniformLocation | null;
  } | null = null;
  private usePbr = false;

  constructor(canvas: HTMLCanvasElement, scene: GLScene) {
    const gl = canvas.getContext('webgl2');
    if (!gl) throw new Error('WebGL2 not supported in this browser');
    this.gl = gl;
    const vs = compile(gl, gl.VERTEX_SHADER, VERT);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
    this.legacyProgram = link(gl, vs, fs);
    this.viewProjLoc = gl.getUniformLocation(this.legacyProgram, 'uViewProj');

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

  /**
   * Enable the PBR (Cook-Torrance GGX) render path (Roadmap §8 NEXT). The
   * supplied material + sun drive the deterministic BRDF. Idempotent: calling
   * again re-binds the same program (cheap) and refreshes uniforms. When no
   * material is set the renderer falls back to the legacy lambert gradient.
   */
  enablePbr(material: TerrainMaterial, sun: TerrainSun): void {
    const gl = this.gl;
    if (!this.pbrProgram) {
      const vs = compile(gl, gl.VERTEX_SHADER, VERT_PBR);
      const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG_PBR);
      this.pbrProgram = link(gl, vs, fs);
      this.pbrLoc = {
        viewProj: gl.getUniformLocation(this.pbrProgram, 'uViewProj'),
        albedo: gl.getUniformLocation(this.pbrProgram, 'uAlbedo'),
        roughness: gl.getUniformLocation(this.pbrProgram, 'uRoughness'),
        metallic: gl.getUniformLocation(this.pbrProgram, 'uMetallic'),
        emissive: gl.getUniformLocation(this.pbrProgram, 'uEmissive'),
        sunDir: gl.getUniformLocation(this.pbrProgram, 'uSunDir'),
        sunColor: gl.getUniformLocation(this.pbrProgram, 'uSunColor'),
        sunIntensity: gl.getUniformLocation(this.pbrProgram, 'uSunIntensity'),
        ambTop: gl.getUniformLocation(this.pbrProgram, 'uAmbTop'),
        ambBottom: gl.getUniformLocation(this.pbrProgram, 'uAmbBottom'),
        ambIntensity: gl.getUniformLocation(this.pbrProgram, 'uAmbIntensity'),
      };
    }
    this.usePbr = true;
    const p = this.pbrProgram!;
    const loc = this.pbrLoc!;
    gl.useProgram(p);
    if (loc.albedo) gl.uniform3fv(loc.albedo, material.albedo);
    if (loc.roughness) gl.uniform1f(loc.roughness, material.roughness);
    if (loc.metallic) gl.uniform1f(loc.metallic, material.metallic);
    if (loc.emissive) gl.uniform3fv(loc.emissive, material.emissive);
    if (loc.sunDir) gl.uniform3fv(loc.sunDir, sun.direction);
    if (loc.sunColor) gl.uniform3fv(loc.sunColor, sun.color);
    if (loc.sunIntensity) gl.uniform1f(loc.sunIntensity, sun.intensity);
    if (loc.ambTop) gl.uniform3fv(loc.ambTop, sun.ambientTop);
    if (loc.ambBottom) gl.uniform3fv(loc.ambBottom, sun.ambientBottom);
    if (loc.ambIntensity) gl.uniform1f(loc.ambIntensity, sun.ambientIntensity);
  }

  /** Switch back to the legacy lambert gradient path. */
  disablePbr(): void {
    this.usePbr = false;
  }

  private upload(attrib: string, data: Float32Array, size: number): void {
    const gl = this.gl;
    const loc = gl.getAttribLocation(this.legacyProgram, attrib);
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
    if (this.usePbr && this.pbrProgram) {
      gl.useProgram(this.pbrProgram);
      const loc = this.pbrLoc!;
      if (loc.viewProj) gl.uniformMatrix4fv(loc.viewProj, false, viewProj);
    } else {
      gl.useProgram(this.legacyProgram);
      if (this.viewProjLoc) gl.uniformMatrix4fv(this.viewProjLoc, false, viewProj);
    }
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
