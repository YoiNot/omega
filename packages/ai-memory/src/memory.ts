/**
 * @omega/ai-memory — deterministic agent memory for PROJECT OMEGA.
 *
 * Two complementary stores, both reproducible from the recorded event sequence:
 *
 *   - SHORT-TERM (episodic): a bounded ring buffer of {@link MemoryEvent}s. The most recent
 *     `capacity` events are retained in insertion order; older ones fall off the front
 *     deterministically (FIFO on record order, never on time — there is no clock here).
 *
 *   - LONG-TERM (semantic): a merged BELIEF snapshot — a flat {@link WorldState} that folds
 *     every observed state through a fixed {@link MergeOp}. The belief is the agent's
 *     "what I currently believe about the world" and can be fed straight into the GOAP
 *     planner as an additional WorldState source (see {@link MemoryStore.asWorldState}).
 *
 *   - SNAPSHOT STACK: a stack of past belief snapshots so a reasoning step can be
 *     checkpointed (`pushSnapshot`) and rolled back (`popSnapshot`). Useful for speculative
 *     planning where an agent explores a hypothetical without committing to it.
 *
 * DETERMINISM CONTRACT: the store is a pure fold over its `record` calls. No `Math.random`,
 * no `Date.now()`. Each event gets a monotonically increasing `seq` assigned in call order;
 * the belief merge is a fixed, order-dependent reduction; the ring buffer drops by FIFO.
 * Therefore the SAME sequence of `record(kind, state)` calls (same kinds, same states, same
 * order) ALWAYS yields an identical internal state, identical belief, and an identical
 * `serialize()` blob — on every machine. `fromSnapshot` reconstructs a byte-identical store.
 */

import { cloneState, toNumber, type WorldState } from '@omega/ai-goap';

/** How an observed feature value is folded into the long-term belief. */
export type MergeOp = 'last' | 'max' | 'min' | 'sum';

/** A single recorded observation (episodic memory entry). */
export interface MemoryEvent {
  /** Free-form category, e.g. `'see'`, `'hear'`, `'infer'`. */
  readonly kind: string;
  /** The observed world state (a flat feature map). */
  readonly state: WorldState;
  /** Monotonic insertion index assigned by the store — strictly increasing per record. */
  readonly seq: number;
}

/** A plain, JSON-serializable dump of the whole store (for checkpoint / restore). */
export interface MemorySnapshot {
  readonly capacity: number;
  readonly op: MergeOp;
  readonly seq: number;
  readonly events: readonly MemoryEvent[];
  readonly belief: WorldState;
  readonly snapshots: readonly WorldState[];
}

/**
 * Fold one observed value into the accumulator under the given merge op. When `acc` is
 * `undefined` (the feature has never been observed), the incoming value SEEDS the fold for
 * every op — this is what makes `min`/`max`/`sum` behave correctly over observed values
 * instead of being dragged toward the implicit 0 of an absent feature.
 */
export function foldValue(op: MergeOp, acc: number | undefined, incoming: number): number {
  if (acc === undefined) return incoming;
  switch (op) {
    case 'last':
      return incoming;
    case 'max':
      return Math.max(acc, incoming);
    case 'min':
      return Math.min(acc, incoming);
    case 'sum':
      return acc + incoming;
  }
}

/** Merge `source` into `target` in place under `op` (last-write-wins / extremum / sum). */
export function mergeStates(target: WorldState, source: WorldState, op: MergeOp): WorldState {
  for (const k in source) {
    const incoming = toNumber(source[k]);
    const acc = target[k] === undefined ? undefined : toNumber(target[k]);
    target[k] = foldValue(op, acc, incoming);
  }
  return target;
}

/**
 * A deterministic agent memory: bounded episodic ring buffer + accumulated semantic belief
 * + a snapshot stack for speculative reasoning.
 */
export class MemoryStore {
  private readonly cap: number;
  private op: MergeOp;
  private events: MemoryEvent[] = [];
  private belief: WorldState = {};
  private stack: WorldState[] = [];
  private seqN = 0;

  /**
   * @param capacity maximum number of recent events retained (ring buffer size). Must be >= 1.
   * @param op       how observed states fold into the long-term belief. Default `'last'`
   *                 (latest observation wins per feature).
   */
  constructor(capacity = 64, op: MergeOp = 'last') {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new Error('MemoryStore: capacity must be a positive integer');
    }
    this.cap = capacity;
    this.op = op;
  }

  /** Ring buffer capacity. */
  get capacity(): number {
    return this.cap;
  }

  /** Active belief merge operator. */
  get mergeOp(): MergeOp {
    return this.op;
  }

  /** Number of events currently held in the ring buffer. */
  get count(): number {
    return this.events.length;
  }

  /** Next seq value that will be assigned (also the total number of records so far). */
  get nextSeq(): number {
    return this.seqN;
  }

  /** Number of belief snapshots currently on the stack. */
  get snapshotCount(): number {
    return this.stack.length;
  }

  /**
   * Record one observation. Assigns the next `seq`, appends to the ring buffer (dropping the
   * oldest entry when over capacity), and folds the state into the long-term belief.
   * Returns the recorded event (a stable handle for tests/inspection).
   */
  record(kind: string, state: WorldState): MemoryEvent {
    const ev: MemoryEvent = { kind, state: cloneState(state), seq: this.seqN++ };
    this.events.push(ev);
    if (this.events.length > this.cap) this.events.shift();
    mergeStates(this.belief, state, this.op);
    return ev;
  }

  /**
   * The retained episodic events in insertion order. With `n` given, returns the last `n`
   * (or fewer when fewer exist). Returns a copy — the internal buffer is never exposed.
   */
  recent(n?: number): readonly MemoryEvent[] {
    if (n === undefined) return this.events.map((e) => ({ kind: e.kind, state: cloneState(e.state), seq: e.seq }));
    if (n <= 0) return [];
    return this.events
      .slice(Math.max(0, this.events.length - n))
      .map((e) => ({ kind: e.kind, state: cloneState(e.state), seq: e.seq }));
  }

  /** The long-term belief (semantic memory) as a flat WorldState. */
  getBelief(): WorldState {
    return cloneState(this.belief);
  }

  /**
   * The belief exposed as a GOAP {@link WorldState} so the planner can use memory as an
   * additional state source. Identity of intent with {@link getBelief}; separate name for
   * readability at call sites that feed the planner.
   */
  asWorldState(): WorldState {
    return this.getBelief();
  }

  /** Push a deep copy of the current belief onto the snapshot stack (checkpoint). */
  pushSnapshot(): void {
    this.stack.push(cloneState(this.belief));
  }

  /**
   * Pop the most recent belief snapshot and restore the belief to it. Returns the popped
   * snapshot (or null if the stack was empty). After a pop, the store's belief equals the
   * rolled-back value, exactly as if later records had never happened.
   */
  popSnapshot(): WorldState | null {
    const s = this.stack.pop();
    if (s === undefined) return null;
    this.belief = cloneState(s);
    return cloneState(s);
  }

  /** Peek the top of the snapshot stack without popping (null if empty). */
  peekSnapshot(): WorldState | null {
    return this.stack.length ? cloneState(this.stack[this.stack.length - 1]) : null;
  }

  /** Reset all memory (events, belief, stack, seq). Capacity and merge op are kept. */
  clear(): void {
    this.events = [];
    this.belief = {};
    this.stack = [];
    this.seqN = 0;
  }

  /** Full serializable dump (for save/load and deterministic equality checks). */
  serialize(): MemorySnapshot {
    return {
      capacity: this.cap,
      op: this.op,
      seq: this.seqN,
      events: this.events.map((e) => ({ kind: e.kind, state: cloneState(e.state), seq: e.seq })),
      belief: cloneState(this.belief),
      snapshots: this.stack.map((s) => cloneState(s)),
    };
  }

  /** Rebuild a store byte-for-byte from a {@link serialize} blob. */
  static fromSnapshot(s: MemorySnapshot): MemoryStore {
    const m = new MemoryStore(s.capacity, s.op);
    m.seqN = s.seq;
    m.events = s.events.map((e) => ({ kind: e.kind, state: cloneState(e.state), seq: e.seq }));
    m.belief = cloneState(s.belief);
    m.stack = s.snapshots.map((x) => cloneState(x));
    return m;
  }
}
