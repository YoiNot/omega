/**
 * @omega/nav-core — binary min-heap.
 *
 * A small, allocation-light binary min-heap parameterised over a comparator so
 * callers control ordering (and therefore deterministic tie-breaking). Used by
 * A* and the flow-field Dijkstra pass.
 *
 * Determinism: for a fixed sequence of `push` calls and a fixed comparator the
 * heap always pops the same sequence of elements. To break ties reproducibly
 * in search, pass a comparator that falls through to a monotonic key (e.g. cell
 * index) — see `astar.ts` / `flow.ts`.
 */

/** Standard binary min-heap. `compare(a, b) < 0` means `a` has higher priority. */
export class MinHeap<T> {
  private readonly items: T[] = [];

  constructor(private readonly compare: (a: T, b: T) => number) {}

  /** Number of elements currently in the heap. */
  get size(): number {
    return this.items.length;
  }

  /** True when the heap holds no elements. */
  isEmpty(): boolean {
    return this.items.length === 0;
  }

  /** Peek at the minimum element without removing it. */
  peek(): T | undefined {
    return this.items[0];
  }

  /** Insert an element and restore the heap invariant. */
  push(item: T): void {
    this.items.push(item);
    this.siftUp(this.items.length - 1);
  }

  /** Remove and return the minimum element, or `undefined` if empty. */
  pop(): T | undefined {
    const n = this.items.length;
    if (n === 0) return undefined;
    const top = this.items[0];
    const last = this.items.pop()!;
    if (n > 1) {
      this.items[0] = last;
      this.siftDown(0);
    }
    return top;
  }

  /** Snapshot of the heap contents (in array order, NOT sorted). */
  toArray(): readonly T[] {
    return this.items.slice();
  }

  private siftUp(i: number): void {
    const items = this.items;
    const node = items[i];
    while (i > 0) {
      const parent = (i - 1) >> 1;
      const p = items[parent];
      if (this.compare(node, p) >= 0) break;
      items[i] = p;
      i = parent;
    }
    items[i] = node;
  }

  private siftDown(i: number): void {
    const items = this.items;
    const n = items.length;
    const node = items[i];
    let hole = i;
    for (;;) {
      const l = 2 * hole + 1;
      const r = 2 * hole + 2;
      let smallestChild = -1;
      if (l < n) smallestChild = l;
      if (r < n && this.compare(items[r], items[l]) < 0) smallestChild = r;
      if (smallestChild === -1) break;
      if (this.compare(items[smallestChild], node) < 0) {
        items[hole] = items[smallestChild];
        hole = smallestChild;
      } else {
        break;
      }
    }
    items[hole] = node;
  }
}
