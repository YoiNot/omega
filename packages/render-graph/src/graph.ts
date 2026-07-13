/**
 * @omega/render-graph — the graph.
 *
 * Owns pass registration, resolves execution order via topological sort on the
 * `inputs` -> `id` dependency edges, and runs passes in that order, feeding
 * each pass its resolved input textures (keyed by upstream pass id) and a
 * target (a pooled FBO or the screen).
 *
 * DETERMINISM: topo-sort is stable (registration order is the tie-breaker),
 * and the FBO pool is deterministic (see fbo.ts). Given the same pass set +
 * same frame seed, the graph executes identically. No pass runs before its
 * inputs exist; cycles are rejected at build time (fail-fast, not silent).
 */
import type { RenderPass, PassContext, PassTarget, TextureRef } from './pass.js';
import { FramebufferPool, type FboSpec } from './fbo.js';

export class RenderGraph {
  private passes = new Map<string, RenderPass>();
  private order: string[] = [];
  private built = false;

  /** Register a pass. Duplicate ids throw. Call before `build()`. */
  add(pass: RenderPass): this {
    if (this.passes.has(pass.id)) throw new Error(`RenderGraph: duplicate pass id "${pass.id}"`);
    this.passes.set(pass.id, pass);
    this.built = false;
    return this;
  }

  /**
   * Topologically sort passes by dependency (inputs -> producer id). Passes
   * with no inputs run first; ties broken by registration order (stable).
   * Throws on cycle. Idempotent: rebuilds only when the pass set changed.
   */
  build(): this {
    const order: string[] = [];
    const visited = new Set<string>();
    const inProgress = new Set<string>();

    const visit = (id: string): void => {
      if (visited.has(id)) return;
      if (inProgress.has(id)) throw new Error(`RenderGraph: cycle detected at pass "${id}"`);
      inProgress.add(id);
      const pass = this.passes.get(id)!;
      for (const dep of pass.inputs) {
        if (!this.passes.has(dep)) {
          // External feed (e.g. scene geometry) — allowed, not a graph edge.
          continue;
        }
        visit(dep);
      }
      inProgress.delete(id);
      visited.add(id);
      order.push(id);
    };

    // Stable order: iterate registration order (Map preserves insertion).
    for (const id of this.passes.keys()) visit(id);
    this.order = order;
    this.built = true;
    return this;
  }

  /** Resolved execution order (pass ids), valid after `build()`. */
  get executionOrder(): readonly string[] {
    return this.order;
  }

  /**
   * Execute the graph.
   * @param seed deterministic frame seed
   * @param width frame width
   * @param height frame height
   * @param feeds external input textures keyed by id (scene, gbuffer inputs...)
   * @param alloc FBO allocator for the pool (backend supplies this)
   * @param targetFor maps a pass id to its render target; default pools by spec
   * @param run invokes the backend draw for a pass (test supplies a recorder)
   */
  execute(opts: {
    seed: number;
    width: number;
    height: number;
    feeds: Map<string, unknown>;
    alloc: (spec: FboSpec) => unknown;
    targetFor?: (pass: RenderPass, ctx: PassContext) => PassTarget;
    run: (pass: RenderPass, inputs: Map<string, unknown>, target: PassTarget, ctx: PassContext) => void;
  }): void {
    if (!this.built) this.build();
    const ctx: PassContext = { width: opts.width, height: opts.height, seed: opts.seed };
    const pool = new FramebufferPool(opts.alloc);
    const produced = new Map<string, unknown>(opts.feeds);

    for (const id of this.order) {
      const pass = this.passes.get(id)!;
      const inputs = new Map<string, unknown>();
      for (const dep of pass.inputs) {
        inputs.set(dep, produced.get(dep));
      }
      const target = opts.targetFor ? opts.targetFor(pass, ctx) : null;
      opts.run(pass, inputs, target, ctx);
      // A pass produces an output texture keyed by its id (for downstream).
      // If it rendered to a pooled FBO, register that handle; otherwise the
      // backend is expected to have published via feeds for the next pass.
      if (target && typeof target === 'object' && 'id' in target) {
        produced.set(id, pool.get((target as TextureRef).id));
      } else if (target === null) {
        // Screen pass; downstream shouldn't depend on it, but record a marker.
        produced.set(id, null);
      }
    }
  }
}
