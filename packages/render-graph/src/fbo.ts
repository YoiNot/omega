/**
 * @omega/render-graph — reusable framebuffer pool.
 *
 * Post-FX graphs churn through many intermediate targets (AO, bloom mips,
 * composited HDR...). Allocating a fresh FBO per pass per frame is the classic
 * GC/VRAM thrash. Instead we keep a small pool keyed by (w,h,format) and reuse
 * across frames. Allocation is deterministic: same request sequence => same
 * pool contents => no allocation-order drift between machines.
 */

export interface FboSpec {
  width: number;
  height: number;
  /** GL-internal format string used as the pool key discriminator. */
  format: string;
}

export interface PooledFbo {
  id: string;
  width: number;
  height: number;
  format: string;
  /** Backing resource handle (a WebGLTexture/FBO in the real backend). */
  handle: unknown;
}

/**
 * Minimal, backend-agnostic FBO pool. The `alloc` callback is supplied by the
 * caller so this module stays free of WebGL imports (Node-testable). It returns
 * a stable id for each pooled target so passes can reference it by name.
 */
export class FramebufferPool {
  private pool = new Map<string, PooledFbo>();
  private seq = 0;

  constructor(private alloc: (spec: FboSpec) => unknown) {}

  /**
   * Acquire (or reuse) a target for the given spec. Returns a stable id; the
   * same (w,h,format) requested twice in a frame yields the SAME id, so the
   * graph can wire passes by id deterministically.
   */
  acquire(spec: FboSpec): string {
    for (const f of this.pool.values()) {
      if (f.width === spec.width && f.height === spec.height && f.format === spec.format) {
        return f.id;
      }
    }
    const id = `fbo#${this.seq++}`;
    const handle = this.alloc(spec);
    this.pool.set(id, { id, ...spec, handle });
    return id;
  }

  /** Look up the backing handle for an acquired id. */
  get(id: string): unknown {
    return this.pool.get(id)?.handle;
  }

  /** Number of live targets (test/debug visibility). */
  get size(): number {
    return this.pool.size;
  }

  /** Release all pooled targets (call on resize / dispose). */
  clear(): void {
    this.pool.clear();
    this.seq = 0;
  }
}
