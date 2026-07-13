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
 *
 *   As of this revision the PBR path is MULTI-PASS: a G-Buffer (depth+normal)
 *   feeds GTAO (Ground-Truth Ambient Occlusion, `@omega/render`), whose AO
 *   texture is composited into the PBR fragment shader alongside a
 *   seed-deterministic IBL env map (`@omega/render` `bakeEnvMap`). The result
 *   is real screen-space ambient occlusion + image-based ambient — no longer
 *   the "early-2000s OpenGL" look of flat lambert.
 */

import { GBufferPass, GTAO_FRAG, FULLSCREEN_VERT, bakeEnvMap } from '@omega/render';
import type { GLScene as GBufferScene } from '@omega/render';

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

// PBR vertex shader: also emit view-space position for the G-Buffer path
// (needed to reconstruct the view vector in the PBR frag for correct specular).
const VERT_PBR = `#version 300 es
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec4 aColor;
uniform mat4 uViewProj;
uniform mat4 uView;        // view matrix, to get view-space position
out vec3 vNormal;
out vec3 vViewPos;
out vec4 vColor;
void main() {
  vNormal = aNormal;
  vColor = aColor;
  vec4 viewPos = uView * vec4(aPos, 1.0);
  vViewPos = viewPos.xyz;
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

// Cook-Torrance GGX metallic-roughness BRDF (deterministic). Mirrors the
// math in @omega/render-pbr/src/brdf.ts so the browser render matches Node.
// Now MULTI-PASS: G-Buffer (depth+normal) feeds GTAO, which yields an AO
// texture composited here. IBL comes from a seed-deterministic env map.
const FRAG_PBR = `#version 300 es
precision highp float;
in vec3 vNormal;
in vec3 vViewPos;   // view-space position (from G-Buffer path)
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
uniform float uAmbIntensity;
uniform sampler2D uAO;    // GTAO result (R channel)
uniform vec3 uIBLTop;     // env-map up radiance (linear)
uniform vec3 uIBLGround;  // env-map down radiance (linear)

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
  // Reconstruct a stable view vector from the G-Buffer view-space position
  // (the old code hard-coded V=(0,1,0), which disabled specular at grazing).
  vec3 V = normalize(-vViewPos);
  vec3 L = normalize(-uSunDir);
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

  // Hemisphere ambient from the procedural env map (IBL approximation).
  float up = N.y * 0.5 + 0.5;
  vec3 ambient = mix(uIBLGround, uIBLTop, up) * uAmbIntensity * uAlbedo;

  // GTAO: sample the AO texture at this fragment's UV.
  float ao = texture(uAO, gl_FragCoord.xy / vec2(textureSize(uAO, 0))).r;
  ao = clamp(ao, 0.0, 1.0);

  vec3 color = (direct + ambient) * ao + uEmissive;
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
  /** G-Buffer pass (depth + view-space normal) feeding GTAO. */
  private gbufferPass: GBufferPass | null = null;
  /** GTAO output (AO texture + its FBO), produced each frame. */
  private aoFbo: WebGLFramebuffer | null = null;
  private aoTex: WebGLTexture | null = null;
  /** GTAO fullscreen-quad pass program + VAO. */
  private aoProgram: WebGLProgram | null = null;
  private aoVao: WebGLVertexArrayObject | null = null;
  /** Seed-deterministic IBL env map (procedural, no asset). */
  private envIrradiance: [number, number, number] = [0.3, 0.35, 0.45];
  /** One VAO per LOD level (fine → coarse → coarsest). Index 0 is active by default. */
  private lodVaos: WebGLVertexArrayObject[] = [];
  private lodIndexCounts: number[] = [];
  private lodLevel = 0;
  private viewProjLoc: WebGLUniformLocation | null;
  private pbrLoc: {
    viewProj: WebGLUniformLocation | null;
    view: WebGLUniformLocation | null;
    albedo: WebGLUniformLocation | null;
    roughness: WebGLUniformLocation | null;
    metallic: WebGLUniformLocation | null;
    emissive: WebGLUniformLocation | null;
    sunDir: WebGLUniformLocation | null;
    sunColor: WebGLUniformLocation | null;
    sunIntensity: WebGLUniformLocation | null;
    ambTop: WebGLUniformLocation | null;
    ambIntensity: WebGLUniformLocation | null;
    ao: WebGLUniformLocation | null;
    ibTop: WebGLUniformLocation | null;
    ibGround: WebGLUniformLocation | null;
  } | null = null;
  private usePbr = false;
  /** Constructor scene (kept for the G-Buffer pass geometry). */
  private lodScene: GLScene | null = null;

  constructor(canvas: HTMLCanvasElement, scene: GLScene) {
    const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: true });
    if (!gl) throw new Error('WebGL2 not supported in this browser');
    this.gl = gl;
    const vs = compile(gl, gl.VERTEX_SHADER, VERT);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
    this.legacyProgram = link(gl, vs, fs);
    this.viewProjLoc = gl.getUniformLocation(this.legacyProgram, 'uViewProj');
    // Build the base (level 0) LOD mesh from the constructor scene.
    this.lodVaos = [this.buildVao(scene)];
    this.lodIndexCounts = [scene.indices.length];
    this.lodLevel = 0;
    this.lodScene = scene;
  }

  /** Build a VAO for one LOD level's geometry. */
  private buildVao(scene: GLScene): WebGLVertexArrayObject {
    const gl = this.gl;
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    this.upload('aPos', scene.positions, 3);
    this.upload('aNormal', scene.normals, 3);
    this.upload('aColor', scene.colors, 4);
    const ibo = gl.createBuffer()!;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, scene.indices, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    return vao;
  }

  /**
   * Replace the LOD chain with `levels` (ordered fine → coarse → coarsest).
   * Each level is an independent GLScene; the renderer picks one per frame via
   * {@link setLodLevel}. This is Roadmap §20 LOD tiering — distant views draw
   * fewer vertices, the real weak-HW win for the colony sim.
   */
  setLodMeshes(levels: GLScene[]): void {
    const gl = this.gl;
    // Delete old VAOs to avoid GPU leaks.
    for (const v of this.lodVaos) gl.deleteVertexArray(v);
    this.lodVaos = levels.map((lv) => this.buildVao(lv));
    this.lodIndexCounts = levels.map((lv) => lv.indices.length);
    this.lodLevel = 0;
  }

  /** Select the active LOD level (clamped to the available chain). */
  setLodLevel(level: number): void {
    if (this.lodVaos.length === 0) return;
    this.lodLevel = Math.max(0, Math.min(level, this.lodVaos.length - 1));
  }

  /** Current LOD level (for HUD / debug). */
  get currentLodLevel(): number {
    return this.lodLevel;
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
        view: gl.getUniformLocation(this.pbrProgram, 'uView'),
        albedo: gl.getUniformLocation(this.pbrProgram, 'uAlbedo'),
        roughness: gl.getUniformLocation(this.pbrProgram, 'uRoughness'),
        metallic: gl.getUniformLocation(this.pbrProgram, 'uMetallic'),
        emissive: gl.getUniformLocation(this.pbrProgram, 'uEmissive'),
        sunDir: gl.getUniformLocation(this.pbrProgram, 'uSunDir'),
        sunColor: gl.getUniformLocation(this.pbrProgram, 'uSunColor'),
        sunIntensity: gl.getUniformLocation(this.pbrProgram, 'uSunIntensity'),
        ambTop: gl.getUniformLocation(this.pbrProgram, 'uAmbTop'),
        ambIntensity: gl.getUniformLocation(this.pbrProgram, 'uAmbIntensity'),
        ao: gl.getUniformLocation(this.pbrProgram, 'uAO'),
        ibTop: gl.getUniformLocation(this.pbrProgram, 'uIBLTop'),
        ibGround: gl.getUniformLocation(this.pbrProgram, 'uIBLGround'),
      };
    }
    // Build the G-Buffer + GTAO passes once (idempotent). GBufferPass owns its
    // geometry VAO, so we feed it the level-0 scene from the constructor.
    if (!this.gbufferPass) {
      const w = gl.canvas.width || 1, h = gl.canvas.height || 1;
      const scene: GBufferScene = {
        positions: this.lodScene?.positions ?? new Float32Array(),
        normals: this.lodScene?.normals ?? new Float32Array(),
        indices: this.lodScene?.indices ?? new Uint32Array(),
      };
      this.gbufferPass = new GBufferPass(gl, scene, w, h);
      // AO target + fullscreen-quad pass (GTAO_FRAG consumes G-Buffer outputs).
      this.aoFbo = gl.createFramebuffer()!;
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.aoFbo);
      this.aoTex = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, this.aoTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, w, h, 0, gl.RED, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.aoTex, 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      const avs = compile(gl, gl.VERTEX_SHADER, FULLSCREEN_VERT);
      const afs = compile(gl, gl.FRAGMENT_SHADER, GTAO_FRAG);
      this.aoProgram = link(gl, avs, afs);
      this.aoVao = gl.createVertexArray()!;
      gl.bindVertexArray(this.aoVao);
      const qb = gl.createBuffer()!;
      gl.bindBuffer(gl.ARRAY_BUFFER, qb);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      gl.bindVertexArray(null);
    }
    // Procedural, seed-deterministic IBL env map (no HDRI asset, $0).
    const seed = Math.floor(sun.ambientTop[0] * 100 + sun.ambientBottom[0] * 7 + sun.intensity * 3);
    const env = bakeEnvMap(seed);
    this.envIrradiance = env.irradiance;
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
    if (loc.ambIntensity) gl.uniform1f(loc.ambIntensity, sun.ambientIntensity);
    if (loc.ibTop) gl.uniform3fv(loc.ibTop, this.envIrradiance);
    if (loc.ibGround) gl.uniform3fv(loc.ibGround, [this.envIrradiance[0] * 0.5, this.envIrradiance[1] * 0.5, this.envIrradiance[2] * 0.5]);
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

  render(viewProj: Float32Array, view?: Float32Array): void {
    const gl = this.gl;
    const w = gl.canvas.width, h = gl.canvas.height;
    gl.viewport(0, 0, w, h);
    gl.clearColor(0.04, 0.06, 0.1, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);

    if (this.usePbr && this.pbrProgram && this.gbufferPass && this.aoProgram && this.aoVao && this.aoTex) {
      const model = new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]);
      // --- Pass 1: G-Buffer (depth + view-space normal) into FBO ---
      this.gbufferPass.render(viewProj, model);
      const gb = this.gbufferPass.targets;

      // --- Pass 2: GTAO -> AO texture (reads G-Buffer normal/depth) ---
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.aoFbo);
      gl.viewport(0, 0, w, h);
      gl.clearColor(1, 1, 1, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.disable(gl.DEPTH_TEST);
      gl.useProgram(this.aoProgram);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, gb.normalTex);
      gl.uniform1i(gl.getUniformLocation(this.aoProgram, 'uNormal'), 0);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, gb.depthTex);
      gl.uniform1i(gl.getUniformLocation(this.aoProgram, 'uDepth'), 1);
      gl.uniform2f(gl.getUniformLocation(this.aoProgram, 'uResolution'), w, h);
      gl.uniform1f(gl.getUniformLocation(this.aoProgram, 'uRadius'), 0.5);
      gl.uniform1f(gl.getUniformLocation(this.aoProgram, 'uFalloff'), 0.2);
      gl.uniform1i(gl.getUniformLocation(this.aoProgram, 'uSamples'), 8);
      gl.uniform1i(gl.getUniformLocation(this.aoProgram, 'uSlices'), 16);
      gl.bindVertexArray(this.aoVao);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindVertexArray(null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.enable(gl.DEPTH_TEST);

      // --- Pass 3: PBR composite (terrain) with AO * IBL ---
      gl.viewport(0, 0, w, h);
      gl.clearColor(0.04, 0.06, 0.1, 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST);
      gl.useProgram(this.pbrProgram);
      const loc = this.pbrLoc!;
      if (loc.viewProj) gl.uniformMatrix4fv(loc.viewProj, false, viewProj);
      if (loc.view) gl.uniformMatrix4fv(loc.view, false, view ?? viewProj);
      // Bind GTAO result to uAO (texture unit 0).
      if (loc.ao) {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.aoTex);
        gl.uniform1i(loc.ao, 0);
      }
      gl.bindVertexArray(this.lodVaos[this.lodLevel]!);
      gl.drawElements(gl.TRIANGLES, this.lodIndexCounts[this.lodLevel] ?? 0, gl.UNSIGNED_INT, 0);
      gl.bindVertexArray(null);
    } else {
      gl.useProgram(this.legacyProgram);
      if (this.viewProjLoc) gl.uniformMatrix4fv(this.viewProjLoc, false, viewProj);
      gl.bindVertexArray(this.lodVaos[this.lodLevel]!);
      gl.drawElements(gl.TRIANGLES, this.lodIndexCounts[this.lodLevel] ?? 0, gl.UNSIGNED_INT, 0);
      gl.bindVertexArray(null);
    }
  }
}

function canvasW(gl: WebGL2RenderingContext): number {
  return (gl.canvas as HTMLCanvasElement).width;
}
function canvasH(gl: WebGL2RenderingContext): number {
  return (gl.canvas as HTMLCanvasElement).height;
}
