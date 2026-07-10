/**
 * @omega/net-delta — deterministic ECS snapshot delta compression.
 *
 * Diffs two ECS worlds (projected through @omega/net-replication's `Codec` into
 * an encoder-agnostic `LogicalSnapshot`) and emits a wire-efficient delta that
 * carries only what changed between frames: entities created, components
 * updated, and entities removed.
 *
 * Determinism contract
 * --------------------
 * Given the same `before`/`after` pair, `encodeDelta(computeDelta(...))` always
 * produces byte-identical output, and `applyDeltaTo(base, delta)` reconstructs a
 * world that serializes identically to `after`. No clocks, no RNG, no ordering
 * ambiguity: every collection is emitted in ascending id (then ascending wire
 * id) order.
 */

import { World } from '@omega/ecs';
import {
  BinaryReader,
  BinaryWriter,
  Codec,
  type EntityId,
  type LogicalComponent,
  type LogicalEntity,
  type LogicalSnapshot,
  type WorldSnapshot,
} from '@omega/net-replication';

/** A set of changed components on an existing entity. */
export interface UpdatedEntity {
  readonly id: EntityId;
  readonly comps: LogicalComponent[];
}

/** A full or partial state transition between two ticks. */
export interface Delta {
  /** Target tick of the `after` snapshot this delta reconstructs. */
  readonly tick: number;
  /**
   * When true, `created` holds the *complete* entity set of `after` and
   * `removed`/`updated` are empty. Used for the very first frame (no base) and
   * for periodic full re-syncs. `apply` rebuilds the world from scratch.
   */
  readonly full: boolean;
  /** Entities to materialize (all of their replicated components included). */
  readonly created: LogicalEntity[];
  /** Existing entities with one or more changed components (only the changed comps). */
  readonly updated: UpdatedEntity[];
  /** Entity ids to destroy. */
  readonly removed: EntityId[];
}

/** Identity-free byte comparison for two component payloads. */
function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * Pure logical diff between two snapshots. `before`/`after` must be produced by
 * the same `Codec` (same component registry order) so wire ids line up. The
 * result is fully ordered and deterministic.
 */
export function computeDelta(before: LogicalSnapshot, after: LogicalSnapshot, tick: number): Delta {
  const beforeById = new Map<number, LogicalEntity>();
  for (const e of before.entities) beforeById.set(e.id, e);

  const created: LogicalEntity[] = [];
  const updated: UpdatedEntity[] = [];

  for (const e of after.entities) {
    const prev = beforeById.get(e.id);
    if (!prev) {
      created.push(e);
      continue;
    }
    // Compare component-by-component (both lists are ascending by cid).
    const prevByCid = new Map<number, LogicalComponent>();
    for (const c of prev.comps) prevByCid.set(c.cid, c);
    const changed: LogicalComponent[] = [];
    for (const c of e.comps) {
      const was = prevByCid.get(c.cid);
      if (!was || !bytesEqual(was.bytes, c.bytes)) changed.push(c);
    }
    if (changed.length > 0) updated.push({ id: e.id, comps: changed });
  }

  const afterById = new Set<number>(after.entities.map((e) => e.id));
  const removed: EntityId[] = [];
  for (const e of before.entities) {
    if (!afterById.has(e.id)) removed.push(e.id);
  }

  created.sort((a, b) => a.id - b.id);
  updated.sort((a, b) => a.id - b.id);
  removed.sort((a, b) => a - b);

  return { tick, full: false, created, updated, removed };
}

/**
 * Build a *full* delta that carries the entire `after` snapshot (used when there
 * is no shared base to diff against, e.g. the first frame sent to a client).
 */
export function fullDelta(after: LogicalSnapshot, tick: number): Delta {
  const created = after.entities.slice().sort((a, b) => a.id - b.id);
  return { tick, full: true, created, updated: [], removed: [] };
}

/**
 * Encode a `Delta` to a deterministic little-endian byte frame:
 *
 *   u32 tick | u8 mode | body
 *
 * mode = 0: empty delta (no changes) — body empty.
 * mode = 1: partial delta — created/updated/removed sections.
 * mode = 2: full delta — only the created section (entire world).
 *
 * Each component blob is emitted as `u32 cid | u32 byteLen | byteLen bytes`.
 */
export function encodeDelta(d: Delta): Uint8Array {
  const w = new BinaryWriter();
  w.u32(d.tick >>> 0);

  if (d.created.length + d.updated.length + d.removed.length === 0) {
    w.u8(0);
    return w.toUint8Array();
  }

  w.u8(d.full ? 2 : 1);

  // created
  w.u32(d.created.length);
  for (const e of d.created) {
    w.i32(e.id);
    w.u32(e.comps.length);
    for (const c of e.comps) writeComp(w, c);
  }

  if (!d.full) {
    // updated
    w.u32(d.updated.length);
    for (const u of d.updated) {
      w.i32(u.id);
      w.u32(u.comps.length);
      for (const c of u.comps) writeComp(w, c);
    }
    // removed
    w.u32(d.removed.length);
    for (const id of d.removed) w.i32(id);
  }

  return w.toUint8Array();
}

function writeComp(w: BinaryWriter, c: LogicalComponent): void {
  w.u32(c.cid);
  w.u32(c.bytes.length);
  for (const b of c.bytes) w.u8(b);
}

/** Inverse of {@link encodeDelta}. Throws on truncated/malformed input. */
export function decodeDelta(bytes: Uint8Array): Delta {
  const r = new BinaryReader(bytes);
  const tick = r.u32();
  const mode = r.u8();
  if (mode === 0) return { tick, full: false, created: [], updated: [], removed: [] };

  const created = readEntities(r);
  if (mode === 2) return { tick, full: true, created, updated: [], removed: [] };

  // mode === 1
  const updated: UpdatedEntity[] = [];
  const uCount = r.u32();
  for (let i = 0; i < uCount; i++) {
    const id = r.i32();
    const cCount = r.u32();
    const comps: LogicalComponent[] = [];
    for (let j = 0; j < cCount; j++) comps.push(readComp(r));
    updated.push({ id, comps });
  }
  const removed: EntityId[] = [];
  const rCount = r.u32();
  for (let i = 0; i < rCount; i++) removed.push(r.i32());

  return { tick, full: false, created, updated, removed };
}

function readEntities(r: BinaryReader): LogicalEntity[] {
  const out: LogicalEntity[] = [];
  const n = r.u32();
  for (let i = 0; i < n; i++) {
    const id = r.i32();
    const cCount = r.u32();
    const comps: LogicalComponent[] = [];
    for (let j = 0; j < cCount; j++) comps.push(readComp(r));
    out.push({ id, comps });
  }
  return out;
}

function readComp(r: BinaryReader): LogicalComponent {
  const cid = r.u32();
  const len = r.u32();
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = r.u8();
  return { cid, bytes };
}

/**
 * Apply `delta` onto `world`, starting from `base` (a `WorldSnapshot` of the
 * `before` state), and return the resulting `after` snapshot.
 *
 * The world is first reset to `base` via the codec, so the operation is a pure
 * function of `base` + `delta` regardless of `world`'s prior contents. For a
 * `full` delta, the world is cleared and rebuilt from the created section.
 *
 * Determinism: the reconstructed world serializes byte-identically to the
 * `after` snapshot that the delta was computed against.
 */
export function applyDeltaTo(
  world: World,
  base: WorldSnapshot,
  delta: Delta,
  codec: Codec,
): WorldSnapshot {
  if (delta.full) {
    world.clear();
    for (const e of delta.created) materialize(world, e, codec);
    return { tick: delta.tick, data: codec.serialize(world) };
  }

  // Reset to base deterministically.
  codec.deserialize(base.data, world);
  // Removed first (ascending ids — allocator stays aligned).
  for (const id of delta.removed) {
    if (world.isAlive(id)) world.destroyEntity(id);
  }
  // Created.
  for (const e of delta.created) {
    if (!world.isAlive(e.id)) codec.ensureEntity(world, e.id);
    for (const c of e.comps) attach(world, e.id, c, codec);
  }
  // Updated (existing entities).
  for (const u of delta.updated) {
    for (const c of u.comps) attach(world, u.id, c, codec);
  }
  return { tick: delta.tick, data: codec.serialize(world) };
}

function materialize(world: World, e: LogicalEntity, codec: Codec): void {
  codec.ensureEntity(world, e.id);
  for (const c of e.comps) attach(world, e.id, c, codec);
}

function attach(world: World, id: EntityId, c: LogicalComponent, codec: Codec): void {
  const def = codec.componentDefFor(c.cid);
  if (!def) throw new RangeError(`net-delta: unknown wire component id ${c.cid}`);
  const value = codec.decodeComponentValue(c.cid, c.bytes);
  if (world.hasComponent(id, def)) {
    world.setComponent(id, def, value);
  } else {
    world.addComponent(id, def, value);
  }
}

/**
 * Stateful per-connection compressor. Retains the last `WorldSnapshot` so each
 * call to `encodeNext` diffs against the previous frame, and each `applyNext`
 * reconstructs its own `after` from its own retained base. Sender and receiver
 * each hold their own instance; both start against the same initial snapshot.
 */
export class DeltaCompressor {
  private last?: WorldSnapshot;
  private lastLogical?: LogicalSnapshot;

  /** The snapshot this endpoint currently considers authoritative (its base). */
  get base(): WorldSnapshot | undefined {
    return this.last;
  }

  /**
   * Advance the sender to `next`. Returns a delta frame: the first call emits a
   * full delta (no shared base), subsequent calls emit partial deltas.
   */
  encodeNext(next: WorldSnapshot, codec: Codec): Uint8Array {
    const holder = new World();
    codec.deserialize(next.data, holder);
    const nextLogical = codec.toLogical(holder);
    let delta: Delta;
    if (!this.lastLogical) {
      delta = fullDelta(nextLogical, next.tick);
    } else {
      delta = computeDelta(this.lastLogical, nextLogical, next.tick);
    }
    this.last = next;
    this.lastLogical = nextLogical;
    return encodeDelta(delta);
  }

  /**
   * Receiver side: apply a delta frame to `world` (which must already reflect
   * this endpoint's retained base), updating the base to the reconstructed
   * `after`. Returns the resulting `after` snapshot.
   */
  applyNext(world: World, codec: Codec, frame: Uint8Array): WorldSnapshot {
    const delta = decodeDelta(frame);
    if (!this.last) {
      // First frame must be a full delta; rebuild from scratch.
      const result = applyDeltaTo(world, { tick: 0, data: new Uint8Array(0) }, delta, codec);
      this.last = result;
      const holder = new World();
      codec.deserialize(result.data, holder);
      this.lastLogical = codec.toLogical(holder);
      return result;
    }
    const result = applyDeltaTo(world, this.last, delta, codec);
    this.last = result;
    const holder2 = new World();
    codec.deserialize(result.data, holder2);
    this.lastLogical = codec.toLogical(holder2);
    return result;
  }
}
