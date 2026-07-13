/**
 * @omega/render-graph — RenderPass contract.
 *
 * A pass is the atomic unit of a render graph: it reads zero or more input
 * textures and writes to ONE output target (an FBO attachment or the screen).
 * Passes are PURE FUNCTIONS of their inputs + a deterministic seed — no clock,
 * no hidden state — so a graph executes identically on every machine (the
 * engine's determinism contract, extended from the GTAO work in @omega/render).
 *
 * The graph owns execution order (topological sort by `inputs`) and the FBO
 * pool; each pass only knows how to draw into a target it is given.
 */

/** A named texture reference resolved by the graph at execute time. */
export interface TextureRef {
  /** Stable id used to wire pass outputs -> inputs. */
  id: string;
}

/** Output target a pass renders into. `null` means the default framebuffer. */
export type PassTarget = TextureRef | null;

/**
 * A render pass. Implementations receive the resolved input textures (keyed by
 * the `TextureRef.id` they declared) and a target to render into. The graph
 * guarantees inputs are available (produced by an upstream pass) before this
 * pass runs.
 */
export interface RenderPass {
  /** Unique id; also names this pass's output texture for downstream passes. */
  readonly id: string;
  /** Inputs this pass reads (ids of upstream passes / external feeds). */
  readonly inputs: string[];
  /**
   * Execute the pass.
   * @param inputs resolved input textures keyed by id (subset of `this.inputs`)
   * @param target where to render (`null` = screen)
   * @param ctx shared execution context (gl, size, frame seed)
   */
  execute(inputs: Map<string, unknown>, target: PassTarget, ctx: PassContext): void;
}

/** Shared per-frame context handed to every pass. */
export interface PassContext {
  /** Frame width in device pixels. */
  width: number;
  /** Frame height in device pixels. */
  height: number;
  /** Deterministic frame seed (same seed => same graph execution). */
  seed: number;
}
