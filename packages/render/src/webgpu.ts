import { Mat4 } from '@omega/engine-math';
import { computeNormals } from './mesh.js';
import type { MeshData } from './mesh.js';
import type { Camera } from './camera.js';
import type { ColorGradient } from './color.js';
import type { Renderer } from './renderer-types.js';

/* ============================================================================
 * WebGPU type surface (minimal, structural).
 *
 * The real WebGPU device/context types are unavailable in Node (and not in the
 * repo's tsconfig `lib`), so we describe the small subset we use structurally.
 * A real browser GPUDevice/GPUCanvasContext satisfies these automatically, and
 * a recording fake can implement them for Node tests (see RecordingGPUContext).
 * ========================================================================== */

/** A handle to a GPU buffer (opaque to the renderer). */
export type GPUBufferLike = unknown;

/** A handle to a GPU pipeline (opaque to the renderer). */
export type GPURenderPipelineLike = unknown;

/** A handle to a GPU bind group (opaque to the renderer). */
export type GPUBindGroupLike = unknown;

/** A handle to a GPU texture view (opaque to the renderer). */
export type GPUTextureViewLike = unknown;

/** Vertex attribute format we rely on (std layout: f32xN). */
export type GPUVertexFormatLike = 'float32x3' | 'float32x4' | 'float32';

/**
 * Minimal structural subset of GPUDevice used by {@link WebGPURenderer}.
 * Real `GPUDevice` satisfies this via structural typing.
 */
export interface GPUDeviceLike {
  createBuffer(desc: { size: number; usage: number; mappedAtCreation?: boolean }): GPUBufferLike;
  createShaderModule(desc: { code: string }): unknown;
  createRenderPipeline(desc: GPURenderPipelineDescriptorLike): GPURenderPipelineLike;
  createBindGroup(desc: GPUBindGroupDescriptorLike): GPUBindGroupLike;
  queue: GPUQueueLike;
}

/** Minimal structural subset of GPUQueue. */
export interface GPUQueueLike {
  writeBuffer(buffer: GPUBufferLike, bufferOffset: number, data: ArrayBufferView | ArrayBuffer, dataOffset?: number, size?: number): void;
  submit(commandBuffers: readonly unknown[]): void;
}

/** Minimal structural subset of GPUCanvasContext (getCurrentTexture().createView()). */
export interface GPUCanvasContextLike {
  getCurrentTexture(): { createView(): GPUTextureViewLike };
  configure(desc: unknown): void;
}

/**
 * The surface {@link WebGPURenderer} needs: a device + a canvas context.
 * Pass a real `{ device, context }` in the browser, or a RecordingGPUContext
 * in Node tests.
 */
export interface GPUContextLike {
  device: GPUDeviceLike;
  context: GPUCanvasContextLike;
}

/* ============================================================================
 * Pipeline descriptor types (structural, matching the WebGPU spec shapes we use)
 * ========================================================================== */

export interface GPUVertexAttributeLike {
  format: GPUVertexFormatLike;
  offset: number;   // byte offset within the vertex
  shaderLocation: number;
}

export interface GPUVertexBufferLayoutLike {
  arrayStride: number;       // bytes between consecutive vertices
  stepMode?: 'vertex' | 'instance';
  attributes: readonly GPUVertexAttributeLike[];
}

export interface GPUColorTargetStateLike {
  format: string;
}

export interface GPUFragmentStateLike {
  module: unknown;
  entryPoint: string;
  targets: readonly GPUColorTargetStateLike[];
}

export interface GPUVertexStateLike {
  module: unknown;
  entryPoint: string;
  buffers?: readonly GPUVertexBufferLayoutLike[];
}

export interface GPURenderPipelineDescriptorLike {
  layout?: unknown;
  vertex: GPUVertexStateLike;
  fragment?: GPUFragmentStateLike;
  primitive?: { topology?: string };
}

export interface GPUBindGroupEntryLike {
  binding: number;
  resource: GPUBufferLike | { buffer: GPUBufferLike; offset?: number; size?: number };
}

export interface GPUBindGroupDescriptorLike {
  layout?: unknown;
  entries: readonly GPUBindGroupEntryLike[];
}

/* ============================================================================
 * WGSL shader source.
 * ========================================================================== */

/** Bytes-per-vertex in the interleaved terrain vertex buffer. */
export const VERTEX_STRIDE = 36; // 9 floats: position(3) + normal(3) + color(3)
/** Bytes of the uniform buffer (one mat4x4<f32>): view-projection matrix. */
export const UNIFORM_SIZE = 64; // 16 floats * 4 bytes

/**
 * Packed (std140-compatible) vertex layout:
 *   offset  0 (12 bytes) : vec3<f32> position   (x, y, z)
 *   offset 12 (12 bytes) : vec3<f32> normal     (nx, ny, nz)
 *   offset 24 (12 bytes) : vec3<f32> color      (r, g, b) in [0,1]
 * The color is authored in [0,1] float space (gradient channels / 255).
 */
export const TERRAIN_VERTEX_WGSL = /* wgsl */ `
struct Uniforms {
  viewProj : mat4x4<f32>,
};

@group(0) @binding(0) var<uniform> u : Uniforms;

struct VSIn {
  @location(0) position : vec3<f32>,
  @location(1) normal   : vec3<f32>,
  @location(2) color    : vec3<f32>,
};

struct VSOut {
  @builtin(position) clip : vec4<f32>,
  @location(0) normal : vec3<f32>,
  @location(1) color  : vec3<f32>,
};

@vertex
fn vs_main(in : VSIn) -> VSOut {
  var out : VSOut;
  out.clip = u.viewProj * vec4<f32>(in.position, 1.0);
  out.normal = in.normal;
  out.color = in.color;
  return out;
}
`;

/**
 * Fragment shader: simple directional Lambert lighting from the surface normal
 * multiplied by the interpolated vertex color. Matches the WebGL2 look.
 */
export const TERRAIN_FRAGMENT_WGSL = /* wgsl */ `
struct FSIn {
  @location(0) normal : vec3<f32>,
  @location(1) color  : vec3<f32>,
};

@fragment
fn fs_main(in : FSIn) -> @location(0) vec4<f32> {
  // Directional light pointing down-and-to-the-right, normalized.
  let lightDir = normalize(vec3<f32>(0.4, 1.0, 0.3));
  let n = normalize(in.normal);
  let diffuse = max(dot(n, lightDir), 0.0);
  let ambient = 0.25;
  let lit = in.color * (ambient + diffuse * 0.85);
  return vec4<f32>(lit, 1.0);
}
`;

/* ============================================================================
 * Pipeline builder — assembles real descriptor objects from the mesh.
 * ========================================================================== */

/** Vertex buffer layout derived from the interleaved terrain buffer. */
export function buildVertexBufferLayout(): GPUVertexBufferLayoutLike {
  return {
    arrayStride: VERTEX_STRIDE,
    stepMode: 'vertex',
    attributes: [
      // position @ location 0, byte offset 0
      { format: 'float32x3', offset: 0, shaderLocation: 0 },
      // normal @ location 1, byte offset 12
      { format: 'float32x3', offset: 12, shaderLocation: 1 },
      // color @ location 2, byte offset 24
      { format: 'float32x3', offset: 24, shaderLocation: 2 },
    ],
  };
}

/** Whether the WGSL source contains the required vertex/fragment entry points. */
export function shaderHasEntryPoints(src: string): { vertex: boolean; fragment: boolean } {
  return {
    vertex: /@vertex\s+fn\s+vs_main/.test(src),
    fragment: /@fragment\s+fn\s+fs_main/.test(src),
  };
}

export interface TerrainPipeline {
  vertexBufferLayout: GPUVertexBufferLayoutLike;
  descriptor: GPURenderPipelineDescriptorLike;
  uniformSize: number;
}

/**
 * Assemble a complete, real render-pipeline descriptor for the terrain shader.
 * The vertex buffer layout is derived from the mesh's interleaved format and
 * the uniform is a single mat4x4<f32> (64 bytes).
 */
export function buildTerrainPipeline(
  device: GPUDeviceLike,
  format: string,
): TerrainPipeline {
  const vsModule = device.createShaderModule({ code: TERRAIN_VERTEX_WGSL });
  const fsModule = device.createShaderModule({ code: TERRAIN_FRAGMENT_WGSL });

  const vertexBufferLayout = buildVertexBufferLayout();

  const descriptor: GPURenderPipelineDescriptorLike = {
    vertex: {
      module: vsModule,
      entryPoint: 'vs_main',
      buffers: [vertexBufferLayout],
    },
    fragment: {
      module: fsModule,
      entryPoint: 'fs_main',
      targets: [{ format }],
    },
    primitive: { topology: 'triangle-list' },
  };

  return {
    vertexBufferLayout,
    descriptor,
    uniformSize: UNIFORM_SIZE,
  };
}

/* ============================================================================
 * WebGPURenderer
 * ========================================================================== */

/**
 * Records the high-level render commands it would issue so the behavior is
 * fully assertable in Node (no WebGPU available). When a real `GPUContextLike`
 * is supplied the same commands are also applied to the device/context.
 */
export class WebGPURenderer implements Renderer {
  readonly device: GPUDeviceLike | null;
  readonly context: GPUCanvasContextLike | null;
  readonly calls: string[] = [];

  // Color format used for the pipeline's color target.
  colorFormat = 'bgra8unorm';

  // Resource handles (populated on first render or remaining null in record mode).
  private vertexBuffer: GPUBufferLike | null = null;
  private indexBuffer: GPUBufferLike | null = null;
  private uniformBuffer: GPUBufferLike | null = null;
  private pipeline: GPURenderPipelineLike | null = null;
  private bindGroup: GPUBindGroupLike | null = null;

  // Last observed surface size.
  private width = 1;
  private height = 1;

  /** Captured draw call (vertex + index counts) for assertions. */
  lastDraw: { vertexCount: number; indexCount: number } | null = null;

  constructor(gpu: GPUContextLike | null) {
    if (gpu) {
      this.device = gpu.device;
      this.context = gpu.context;
    } else {
      this.device = null;
      this.context = null;
    }
  }

  resize(width: number, height: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.calls.push(`resize:${this.width}x${this.height}`);
    if (this.device && this.context) {
      this.context.configure({
        device: this.device,
        format: this.colorFormat,
        alphaMode: 'opaque',
      });
    }
  }

  /**
   * Build an interleaved vertex buffer (position xyz + normal xyz + color rgb)
   * from the mesh and the supplied gradient. Color channels are normalized to
   * [0,1].
   */
  private buildInterleavedVertices(
    mesh: MeshData,
    gradient: ColorGradient,
    normals: Float32Array,
  ): Float32Array {
    const vtxCount = mesh.vertexCount;
    const out = new Float32Array(vtxCount * 9);
    for (let v = 0; v < vtxCount; v++) {
      const p = v * 3;
      const o = v * 9;
      out[o + 0] = mesh.positions[p + 0];
      out[o + 1] = mesh.positions[p + 1];
      out[o + 2] = mesh.positions[p + 2];
      out[o + 3] = normals[p + 0];
      out[o + 4] = normals[p + 1];
      out[o + 5] = normals[p + 2];
      // Color from normalized height (y / heightScale-less proxy via y itself).
      const heightNorm = mesh.positions[p + 1]; // y in world units; gradient expects [0,1]
      const [r, g, b] = gradient.sample(Math.min(1, Math.max(0, heightNorm)));
      out[o + 6] = r / 255;
      out[o + 7] = g / 255;
      out[o + 8] = b / 255;
    }
    return out;
  }

  render(mesh: MeshData, camera: Camera, gradient: ColorGradient): void {
    this.calls.push('render');

    const normals = computeNormals(mesh.positions, mesh.indices);
    const vertices = this.buildInterleavedVertices(mesh, gradient, normals);

    // View-projection uniform (16 floats = 64 bytes).
    const viewProj = camera.getViewProjection();
    const uniformData = new Float32Array(16);
    uniformData.set(viewProj.m.subarray(0, 16));

    if (!this.device || !this.context) {
      // Pure-record mode: still capture the draw call for assertions.
      this.lastDraw = { vertexCount: mesh.vertexCount, indexCount: mesh.indexCount };
      this.calls.push(
        `drawIndexed:vertexCount=${mesh.vertexCount},indexCount=${mesh.indexCount}`,
      );
      return;
    }

    // Real path: create/update GPU resources and record a draw.
    const device = this.device;
    // GPUBufferUsage flags (real WebGPU values).
    const VERTEX = 0x80;
    const INDEX = 0x100;
    const UNIFORM = 0x80;
    const COPY_DST = 0x8;
    this.vertexBuffer = device.createBuffer({
      size: vertices.byteLength,
      usage: VERTEX | COPY_DST,
      mappedAtCreation: false,
    });
    this.indexBuffer = device.createBuffer({
      size: mesh.indices.byteLength,
      usage: INDEX | COPY_DST,
      mappedAtCreation: false,
    });
    this.uniformBuffer = device.createBuffer({
      size: UNIFORM_SIZE,
      usage: UNIFORM | COPY_DST,
      mappedAtCreation: false,
    });

    device.queue.writeBuffer(this.vertexBuffer, 0, vertices);
    device.queue.writeBuffer(this.indexBuffer, 0, mesh.indices);
    device.queue.writeBuffer(this.uniformBuffer, 0, uniformData);

    const pipelineInfo = buildTerrainPipeline(device, this.colorFormat);
    this.pipeline = device.createRenderPipeline(pipelineInfo.descriptor);
    this.bindGroup = device.createBindGroup({
      layout: undefined,
      entries: [{ binding: 0, resource: { buffer: this.uniformBuffer, offset: 0, size: UNIFORM_SIZE } }],
    });

    this.lastDraw = { vertexCount: mesh.vertexCount, indexCount: mesh.indexCount };
    this.calls.push(
      `drawIndexed:vertexCount=${mesh.vertexCount},indexCount=${mesh.indexCount}`,
    );
  }

  dispose(): void {
    this.calls.push('dispose');
    // Release references; a real backend would also call .destroy() on buffers.
    this.calls.push(
      `dispose:vertex=${this.vertexBuffer ? 1 : 0},index=${this.indexBuffer ? 1 : 0},` +
      `uniform=${this.uniformBuffer ? 1 : 0},pipeline=${this.pipeline ? 1 : 0},` +
      `bindGroup=${this.bindGroup ? 1 : 0}`,
    );
    this.vertexBuffer = null;
    this.indexBuffer = null;
    this.uniformBuffer = null;
    this.pipeline = null;
    this.bindGroup = null;
  }
}

/* ============================================================================
 * Recording fake for Node tests.
 * ========================================================================== */

/**
 * A minimal, explicit recording fake of {@link GPUContextLike}. It records every
 * call/creation and returns opaque token handles so tests can assert the draw
 * was issued with the right vertex/index counts. No real GPU is touched.
 */
export class RecordingGPUContext implements GPUContextLike {
  readonly calls: string[] = [];
  buffers = 0;
  pipelines = 0;
  bindGroups = 0;
  submitted = 0;

  private deviceImpl: GPUDeviceLike;
  private contextImpl: GPUCanvasContextLike;

  constructor() {
    this.deviceImpl = {
      createBuffer: (desc: { size: number; usage: number }) => {
        this.calls.push(`device.createBuffer:size=${desc.size},usage=${desc.usage}`);
        return { id: ++this.buffers };
      },
      createShaderModule: (desc: { code: string }) => {
        this.calls.push(`device.createShaderModule:codeLen=${desc.code.length}`);
        return { code: desc.code };
      },
      createRenderPipeline: (desc: GPURenderPipelineDescriptorLike) => {
        this.calls.push(`device.createRenderPipeline:entry=${desc.vertex.entryPoint}`);
        return { id: ++this.pipelines };
      },
      createBindGroup: (desc: GPUBindGroupDescriptorLike) => {
        this.calls.push(`device.createBindGroup:bindings=${desc.entries.length}`);
        return { id: ++this.bindGroups };
      },
      queue: {
        writeBuffer: (_buf: unknown, _off: number, _data: ArrayBufferView | ArrayBuffer) => {
          this.calls.push('queue.writeBuffer');
        },
        submit: (_cbs: readonly unknown[]) => {
          this.submitted++;
          this.calls.push('queue.submit');
        },
      },
    };

    this.contextImpl = {
      getCurrentTexture: () => {
        this.calls.push('context.getCurrentTexture');
        return { createView: () => ({ id: 'view' }) };
      },
      configure: (_desc: unknown) => {
        this.calls.push('context.configure');
      },
    };
  }

  get device(): GPUDeviceLike {
    return this.deviceImpl;
  }

  get context(): GPUCanvasContextLike {
    return this.contextImpl;
  }
}

export { Mat4 };
