/**
 * @omega/audio — reverb models.
 *
 * ReverbModel is the pluggable interface; input/output are plain Float32Array
 * sample buffers (mono). Implementations:
 *
 *  - DryReverb: passthrough (input === output), used when reverb is disabled.
 *  - SimpleConvolutionReverb: real time-domain convolution against an impulse
 *    response generated deterministically from an Rng (exponentially-decaying
 *    noise). Because the IR is seeded, the reverb tail is reproducible.
 *
 * Convolution is O(n·m); the IR length is bounded so this is cheap for short
 * tails. Output length is n + irLen - 1 (the linear convolution sum).
 */

import { Rng } from '@omega/engine-core';

export interface ReverbModel {
  process(input: Float32Array): Float32Array;
}

/** Passthrough reverb (no effect applied). */
export class DryReverb implements ReverbModel {
  process(input: Float32Array): Float32Array {
    return input;
  }
}

export interface SimpleConvolutionReverbOptions {
  /** Seed for the impulse-response generator. */
  seed?: bigint | number | string;
  /** Length of the impulse response in samples. */
  length?: number;
  /** Decay rate of the IR envelope (higher = faster decay). */
  decay?: number;
}

export class SimpleConvolutionReverb implements ReverbModel {
  private readonly ir: Float32Array;

  constructor(opts: SimpleConvolutionReverbOptions = {}) {
    const seed = opts.seed ?? 0;
    const length = Math.max(1, opts.length ?? 4096);
    const decay = opts.decay ?? 4;

    // Build a deterministic, exponentially-decaying noise impulse response.
    const rng = new Rng(seed);
    const ir = new Float32Array(length);
    for (let i = 0; i < length; i++) {
      const envelope = Math.exp((-decay * i) / length);
      // Two-sided noise in [-1, 1] from the Rng.
      ir[i] = (rng.nextF64() * 2 - 1) * envelope;
    }
    this.ir = ir;
  }

  get impulseLength(): number {
    return this.ir.length;
  }

  process(input: Float32Array): Float32Array {
    const n = input.length;
    const m = this.ir.length;
    const out = new Float32Array(n + m - 1);
    for (let i = 0; i < n; i++) {
      const x = input[i];
      for (let j = 0; j < m; j++) {
        out[i + j] += x * this.ir[j];
      }
    }
    return out;
  }
}
