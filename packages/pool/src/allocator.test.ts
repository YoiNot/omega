import { describe, it, expect } from 'vitest';
import { PoolAllocator } from './allocator.js';

describe('PoolAllocator', () => {
  it('allocates contiguous blocks from a fresh pool in order', () => {
    const p = new PoolAllocator({ capacity: 64, blockSize: 16 });
    expect(p.blockCount).toBe(4);
    const a = p.alloc();
    const b = p.alloc();
    expect(a.index).toBe(0);
    expect(b.index).toBe(1);
    expect(a.offset).toBe(0);
    expect(b.offset).toBe(16);
    expect(p.allocatedCount).toBe(2);
    expect(p.freeCount).toBe(2);
  });

  it('free returns blocks to the LIFO stack deterministically', () => {
    const p = new PoolAllocator({ capacity: 64, blockSize: 16 });
    const a = p.alloc(); // 0
    const b = p.alloc(); // 1
    p.alloc(); // 2 (still allocated)
    p.free(b.index); // free 1 -> stack top
    p.free(a.index); // free 0 -> stack top
    // 3 allocated total, 2 freed -> 1 still allocated, 3 free of 4.
    expect(p.freeCount).toBe(3);
    // Next alloc reuses the most recently freed (0).
    const d = p.alloc();
    expect(d.index).toBe(0);
    // Then 1.
    const e = p.alloc();
    expect(e.index).toBe(1);
    // c (2) is still allocated.
    expect(p.allocatedCount).toBe(3);
  });

  it('identical operation sequences yield identical snapshots (reproducibility)', () => {
    const build = () => {
      const p = new PoolAllocator({ capacity: 128, blockSize: 16 });
      p.alloc(); p.alloc(); // 0,1
      const x = p.alloc(); p.alloc(); // 2,3
      p.free(1); p.free(2);
      p.alloc(); // reuses 2
      p.free(x.index);
      return p.snapshot();
    };
    expect(build()).toEqual(build());
  });

  it('snapshot -> load round-trips exact state', () => {
    const p = new PoolAllocator({ capacity: 128, blockSize: 16 });
    p.alloc(); p.alloc(); p.alloc();
    p.free(1);
    const snap = p.snapshot();
    const q = new PoolAllocator({ capacity: 128, blockSize: 16 });
    q.load(snap);
    expect(q.snapshot()).toEqual(snap);
    // Continue allocating — must follow same deterministic path.
    const next = q.alloc();
    expect(next.index).toBe(1); // reuse freed 1
  });

  it('throws on exhaustion deterministically', () => {
    const p = new PoolAllocator({ capacity: 32, blockSize: 16 }); // 2 blocks
    p.alloc(); p.alloc();
    expect(p.freeCount).toBe(0);
    expect(() => p.alloc()).toThrow(/out of capacity/);
  });

  it('rejects capacity smaller than blockSize', () => {
    expect(() => new PoolAllocator({ capacity: 8, blockSize: 16 })).toThrow();
  });

  it('supports shared buffers for worker-shared regions', () => {
    const p = new PoolAllocator({ capacity: 64, blockSize: 16, shared: true });
    expect(p.buffer).toBeInstanceOf(SharedArrayBuffer);
  });

  it('free of an already-free index is a safe no-op', () => {
    const p = new PoolAllocator({ capacity: 32, blockSize: 16 });
    const a = p.alloc();
    p.free(a.index);
    const before = p.snapshot();
    p.free(a.index); // again
    expect(p.snapshot()).toEqual(before);
  });

  it('clear resets to a fully-free pool deterministically', () => {
    const p = new PoolAllocator({ capacity: 64, blockSize: 16 });
    p.alloc(); p.alloc(); p.free(0); p.alloc();
    p.clear();
    expect(p.allocatedCount).toBe(0);
    expect(p.freeCount).toBe(4);
    const a = p.alloc();
    expect(a.index).toBe(0); // back to fresh order after clear
  });
});
