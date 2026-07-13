/**
 * @omega/render-graph — ComposePass: a fullscreen-quad fragment that blends N
 * input textures into one output. This is the workhorse for post-FX chains
 * (bloom add, tone-map, final composite) and keeps each effect as a tiny,
 * swappable shader rather than a monolithic frag.
 *
 * DETERMINISM: the blend math is a pure function of the input texels; the pass
 * records its uniform set so Node tests can assert the same inputs => same
 * composite (no GL needed to verify the graph wiring).
 */
import type { RenderPass, PassContext, PassTarget } from './pass.js';

/** A (id, weight) pair fed to the composer. */
export interface ComposeInput {
  id: string;
  weight: number;
}

/**
 * Composite pass: `out = sum(weight_i * sample(input_i))` over the supplied
 * inputs, evaluated at the same UV for every input. A `bias` is added last
 * (e.g. ambient floor). Deterministic: identical inputs/weights => identical
 * output texels.
 */
export class ComposePass implements RenderPass {
  readonly id: string;
  readonly inputs: string[];

  /** Recorded uniform snapshot for test assertions. */
  lastUniforms: { weights: number[]; bias: [number, number, number] } | null = null;

  constructor(
    id: string,
    inputs: ComposeInput[],
    private bias: [number, number, number] = [0, 0, 0],
  ) {
    this.id = id;
    this.inputs = inputs.map((i) => i.id);
    this.spec = inputs;
  }

  private spec: ComposeInput[];

  execute(inputs: Map<string, unknown>, _target: PassTarget, _ctx: PassContext): void {
    const weights = this.spec.map((i) => i.weight);
    // Pure blend record — the real backend would sample each input texture at
    // the fragment UV and accumulate. We record what WOULD be sampled so the
    // graph wiring (which inputs arrived) is testable without a GPU.
    let available = 0;
    for (const i of this.spec) if (inputs.has(i.id)) available++;
    this.lastUniforms = { weights, bias: this.bias };
    // Marker: the composite "produces" an output keyed by this.id if all
    // inputs were present; downstream passes consume it by id.
    if (available === this.spec.length) {
      inputs.set(this.id, { composed: true, weights, bias: this.bias });
    }
  }
}
