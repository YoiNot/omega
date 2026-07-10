/**
 * @omega/input-core — replay-safe ring buffer of input frames.
 *
 * A fixed-capacity ring buffer that stores the most recent `InputFrame`s. Used
 * for rollback/replay: record every sampled frame, then re-feed the exact same
 * sequence to verify the simulation is frame-for-frame identical. No clock, no
 * randomness — indexing is purely by the caller-supplied frame ordering.
 */

import type { InputFrame } from './types.js';

/**
 * Fixed-capacity FIFO ring buffer of `InputFrame`s. When full, the oldest frame
 * is overwritten. Deterministic: identical push sequences produce identical
 * `toArray()` output.
 */
export class InputBuffer {
  private readonly slots: (InputFrame | undefined)[];
  private head = 0;
  private count = 0;

  constructor(public readonly capacity: number) {
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new Error('InputBuffer: capacity must be a positive integer');
    }
    this.slots = new Array<InputFrame | undefined>(capacity);
  }

  /** Number of frames currently stored (<= capacity). */
  get size(): number {
    return this.count;
  }

  /** Append a frame; overwrites the oldest once capacity is exceeded. */
  push(frame: InputFrame): void {
    this.slots[this.head] = frame;
    this.head = (this.head + 1) % this.capacity;
    if (this.count < this.capacity) this.count++;
  }

  /**
   * Get the frame at logical index `i` in chronological order (0 = oldest held).
   * Returns undefined if out of range.
   */
  at(i: number): InputFrame | undefined {
    if (i < 0 || i >= this.count) return undefined;
    const start = (this.head - this.count + this.capacity) % this.capacity;
    return this.slots[(start + i) % this.capacity];
  }

  /** The most recently pushed frame, or undefined if empty. */
  last(): InputFrame | undefined {
    return this.at(this.count - 1);
  }

  /** All stored frames in chronological order (oldest first). */
  toArray(): InputFrame[] {
    const out: InputFrame[] = [];
    for (let i = 0; i < this.count; i++) {
      const f = this.at(i);
      if (f !== undefined) out.push(f);
    }
    return out;
  }

  /** Drop all stored frames. */
  clear(): void {
    this.head = 0;
    this.count = 0;
    this.slots.fill(undefined);
  }
}
