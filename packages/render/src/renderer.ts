import { WebGL2Renderer } from './gl.js';
import { WebGPURenderer } from './webgpu.js';
import type { GLLike } from './gl.js';
import type { GPUContextLike } from './webgpu.js';
import type { Renderer } from './renderer-types.js';

/**
 * A canvas-like surface. We only need `width`/`height` for resize bookkeeping
 * and, in a real browser, the underlying HTMLCanvasElement would expose
 * `getContext('webgl2')` / `getContext('webgpu')`. Kept structural so it is
 * Node-testable.
 */
export interface CanvasLike {
  width: number;
  height: number;
}

/**
 * Options for {@link createRenderer}. The caller supplies the GL and GPU
 * surfaces explicitly so the factory stays pure and Node-testable; in a browser
 * you would build these from `canvas.getContext(...)`.
 */
export interface RendererOptions {
  /** WebGL2 context/recording fake. Required when WebGPU is unavailable. */
  gl?: GLLike;
  /** WebGPU device + canvas context. When present, the WebGPU path is used. */
  gpu?: GPUContextLike;
}

/**
 * Unified renderer factory.
 *
 * Detects WebGPU by the presence of `opts.gpu` (mirroring a browser check for
 * `navigator.gpu`). When a GPU context is supplied it returns a
 * {@link WebGPURenderer}; otherwise it falls back to {@link WebGL2Renderer}.
 *
 * The returned object satisfies the shared {@link Renderer} interface, so the
 * rest of the engine is backend-agnostic.
 */
export function createRenderer(_canvas: CanvasLike | null, opts: RendererOptions = {}): Renderer {
  if (opts.gpu) {
    return new WebGPURenderer(opts.gpu);
  }
  return new WebGL2Renderer(opts.gl ?? null);
}
