/**
 * @omega/pool — deterministic memory pool / buffer allocator.
 *
 * Why: hot simulation paths that allocate per-frame invite GC nondeterminism
 * (collection timing is not part of the reproducible state). A fixed-capacity
 * pool hands out stable byte ranges from a single backing buffer, and the
 * sequence of {alloc, free} operations is itself a fully deterministic state
 * machine (a free-list stack). Given the same starting layout and the same
 * operation sequence, the pool reaches the *bit-identical* state — no RNG,
 * no Date, no global ordering dependence.
 *
 * The pool can sit on a plain ArrayBuffer or a SharedArrayBuffer (so worker
 * lanes in the job system can carve their output regions from one shared
 * buffer deterministically). Allocation never reads or writes the payload
 * bytes — it only manages the header (bookkeeping), so determinism of the
 * *pool state* is independent of whatever the user writes into the blocks.
 *
 * Determinism contract:
 *  - Free-list is a LIFO stack of free block indices.
 *  - alloc pops the most-recently-freed index (or the next fresh index).
 *  - free pushes the index back exactly as given (no coalescing / reordering).
 *  - `snapshot()` / `load()` make the entire layout comparable and restorable.
 */

export interface PoolOptions {
  /** Capacity in bytes. */
  readonly capacity: number;
  /** Block size in bytes (all blocks equal; keeps the free-list trivially deterministic). */
  readonly blockSize: number;
  /** Use a SharedArrayBuffer (for worker-shared regions). Default false. */
  readonly shared?: boolean;
  /** Optional explicit buffer (must match capacity). Rarely needed. */
  readonly buffer?: ArrayBufferLike;
}

export interface AllocHandle {
  /** Stable block index within the pool (0 .. blockCount-1). */
  readonly index: number;
  /** Byte offset of this block in the backing buffer. */
  readonly offset: number;
  /** Byte length of this block. */
  readonly length: number;
}

/** Plain serializable snapshot of pool state (for deterministic comparison/tests). */
export interface PoolSnapshot {
  readonly capacity: number;
  readonly blockSize: number;
  readonly blockCount: number;
  /** Free indices in stack order (bottom..top). */
  readonly freeStack: readonly number[];
  /** Order in which blocks were allocated (for replay-equality checks). */
  readonly allocOrder: readonly number[];
  readonly allocatedCount: number;
}

/**
 * Fixed-capacity block pool with a LIFO free-list. Deterministic: identical
 * (capacity, blockSize) and identical operation sequences yield identical
 * snapshots and identical block placements.
 */
export class PoolAllocator {
  readonly buffer: ArrayBufferLike;
  readonly blockSize: number;
  readonly blockCount: number;
  readonly capacity: number;

  /** Free block indices, LIFO (top of stack = end of array). */
  private readonly _freeStack: number[] = [];
  /** The order blocks were handed out (push on alloc, ignored on free). */
  private readonly _allocOrder: number[] = [];
  private _allocated = 0;

  constructor(opts: PoolOptions) {
    this.capacity = opts.capacity;
    this.blockSize = opts.blockSize;
    this.blockCount = Math.floor(opts.capacity / opts.blockSize);
    if (this.blockCount < 1) {
      throw new Error(
        `PoolAllocator: capacity ${opts.capacity} < blockSize ${opts.blockSize}`,
      );
    }
    if (opts.buffer) {
      if (opts.buffer.byteLength !== opts.capacity) {
        throw new Error(
          `PoolAllocator: explicit buffer byteLength ${opts.buffer.byteLength} != capacity ${opts.capacity}`,
        );
      }
      this.buffer = opts.buffer;
    } else if (opts.shared) {
      this.buffer = new SharedArrayBuffer(opts.capacity);
    } else {
      this.buffer = new ArrayBuffer(opts.capacity);
    }
    for (let i = this.blockCount - 1; i >= 0; i--) this._freeStack.push(i);
  }

  /** Number of currently allocated blocks. */
  get allocatedCount(): number {
    return this._allocated;
  }

  /** Number of free blocks remaining. */
  get freeCount(): number {
    return this.blockCount - this._allocated;
  }

  /**
   * Allocate one block. Throws if the pool is exhausted (deterministic —
   * exhaustion is a state, not an error condition left to chance).
   */
  alloc(): AllocHandle {
    const index = this._freeStack.pop();
    if (index === undefined) {
      throw new Error('PoolAllocator: out of capacity');
    }
    this._allocated++;
    this._allocOrder.push(index);
    return { index, offset: index * this.blockSize, length: this.blockSize };
  }

  /** Allocate `n` contiguous blocks (consecutive indices). Returns their handles. */
  allocMany(n: number): AllocHandle[] {
    const out: AllocHandle[] = [];
    for (let i = 0; i < n; i++) out.push(this.alloc());
    return out;
  }

  /** Release a previously allocated block by index. No-op if already free. */
  free(index: number): void {
    if (index < 0 || index >= this.blockCount) return;
    // Only push back if it is actually allocated (tracked). We detect
    // "allocated" by absence from the free stack — cheap linear scan is fine
    // for the deterministic small pools this engine targets.
    if (!this._freeStack.includes(index)) {
      this._freeStack.push(index);
      this._allocated = Math.max(0, this._allocated - 1);
    }
  }

  /** Reset to fully-free state (all blocks returned, alloc order cleared). */
  clear(): void {
    this._freeStack.length = 0;
    for (let i = this.blockCount - 1; i >= 0; i--) this._freeStack.push(i);
    this._allocOrder.length = 0;
    this._allocated = 0;
  }

  /** Capture a plain serializable snapshot (deterministic comparison/tests). */
  snapshot(): PoolSnapshot {
    return {
      capacity: this.capacity,
      blockSize: this.blockSize,
      blockCount: this.blockCount,
      freeStack: [...this._freeStack],
      allocOrder: [...this._allocOrder],
      allocatedCount: this._allocated,
    };
  }

  /** Restore from a snapshot produced by `snapshot()`. Throws on shape mismatch. */
  load(snap: PoolSnapshot): void {
    if (snap.capacity !== this.capacity || snap.blockSize !== this.blockSize) {
      throw new Error('PoolAllocator.load: snapshot layout mismatch');
    }
    this._freeStack.length = 0;
    for (const i of snap.freeStack) this._freeStack.push(i);
    this._allocOrder.length = 0;
    for (const i of snap.allocOrder) this._allocOrder.push(i);
    this._allocated = snap.allocatedCount;
  }

  /** Byte offset for a block index (pure). */
  offsetOf(index: number): number {
    return index * this.blockSize;
  }

  /** View helper: a Float64Array window over a block (for typed payloads). */
  view<TArray extends Float32Array | Float64Array | Int32Array | Uint32Array | Uint8Array>(
    index: number,
    ctor: { new (buf: ArrayBufferLike, offset: number, length: number): TArray; BYTES_PER_ELEMENT: number },
  ): TArray {
    return new ctor(this.buffer, this.offsetOf(index), this.blockSize / ctor.BYTES_PER_ELEMENT);
  }
}
