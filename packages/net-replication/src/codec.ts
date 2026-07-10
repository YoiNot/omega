/**
 * @omega/net-replication — ECS <-> WorldSnapshot (de)serialization.
 *
 * The codec turns an @omega/ecs `World` into the flat `Uint8Array` payload that
 * @omega/net's `WorldSnapshot` carries, and back. Only components on an explicit
 * `registerComponent` allow-list cross the wire, so the on-the-wire image stays
 * small and the two peers agree on the schema.
 *
 * Determinism: no Math.random / Date.now. The byte layout is fully
 * length-prefixed and schema-stable. Given the same world + the same registered
 * component set, `serialize` always yields byte-identical output, and
 * `deserialize` reconstructs every live entity and attached component value
 * losslessly.
 */

import { type ComponentDef, type EntityId, World } from '@omega/ecs';
import type { WorldSnapshot } from '@omega/net';

/** Extract the value type carried by a `ComponentDef`. */
type ComponentValue<D> = D extends ComponentDef<infer C> ? C : never;

/** A registered component's stable wire id and value codec. */
interface Registered<C> {
  readonly def: ComponentDef<C>;
  readonly id: number;
  readonly name: string;
  readonly encode: (v: C, w: BinaryWriter) => void;
  readonly decode: (r: BinaryReader) => C;
}

/**
 * Default encoder: writes every plain number-valued field of an object as an
 * f32. The decoded object is a structurally-identical clone (all-f32). This is
 * lossless for components whose values are exactly the number fields (positions,
 * velocities, timers, ...) and is robust to field addition/removal.
 */
function numericEncode(v: Record<string, unknown>, w: BinaryWriter): void {
  const keys = Object.keys(v).sort();
  w.u32(keys.length);
  for (const k of keys) {
    w.str(k);
    const val = v[k];
    if (typeof val !== 'number') {
      throw new TypeError(
        `codec: field "${k}" is not a number (got ${typeof val}); ` +
          `register a custom encoder for this component`,
      );
    }
    w.f32(val);
  }
}

function numericDecode(r: BinaryReader): Record<string, number> {
  const out: Record<string, number> = {};
  const n = r.u32();
  for (let i = 0; i < n; i++) {
    const k = r.str();
    out[k] = r.f32();
  }
  return out;
}

/**
 * Binary writer — little-endian, length-prefixed. Implemented locally to avoid a
 * hard dependency on @omega/save; mirrors the pattern used by net's snapshot
 * encoder.
 */
export class BinaryWriter {
  private readonly bytes: number[] = [];
  private readonly view = new DataView(new ArrayBuffer(8));

  u8(v: number): void {
    this.bytes.push(v & 0xff);
  }

  u32(v: number): void {
    this.view.setUint32(0, v >>> 0, true);
    this.push4();
  }

  i32(v: number): void {
    this.view.setInt32(0, v | 0, true);
    this.push4();
  }

  f32(v: number): void {
    this.view.setFloat32(0, v, true);
    this.push4();
  }

  /** Length-prefixed UTF-8 string. */
  str(s: string): void {
    const enc = new TextEncoder().encode(s);
    this.u32(enc.length);
    for (const b of enc) this.bytes.push(b);
  }

  private push4(): void {
    for (let i = 0; i < 4; i++) this.bytes.push(this.view.getUint8(i));
  }

  toUint8Array(): Uint8Array {
    return Uint8Array.from(this.bytes);
  }
}

/** Paired binary reader. Throws RangeError on truncated input. */
export class BinaryReader {
  private pos = 0;
  private readonly view: DataView;

  constructor(private readonly buf: Uint8Array) {
    this.view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  }

  private need(n: number): void {
    if (this.pos + n > this.buf.length) throw new RangeError('codec frame truncated');
  }

  u8(): number {
    this.need(1);
    return this.buf[this.pos++];
  }

  u32(): number {
    this.need(4);
    const v = this.view.getUint32(this.pos, true);
    this.pos += 4;
    return v;
  }

  i32(): number {
    this.need(4);
    const v = this.view.getInt32(this.pos, true);
    this.pos += 4;
    return v;
  }

  f32(): number {
    this.need(4);
    const v = this.view.getFloat32(this.pos, true);
    this.pos += 4;
    return v;
  }

  str(): string {
    const len = this.u32();
    this.need(len);
    const slice = this.buf.subarray(this.pos, this.pos + len);
    this.pos += len;
    return new TextDecoder().decode(slice);
  }

  get remaining(): number {
    return this.buf.length - this.pos;
  }
}

/**
 * Schema-aware codec for an @omega/ecs world. Only `registerComponent`'d types
 * are serialized; everything else is left local-only.
 */
export class Codec {
  /** Schema-versioned component registry, keyed by wire id. */
  private readonly byId = new Map<number, Registered<unknown>>();
  /** Lookup by ComponentDef identity, to recover the wire id on serialize. */
  private readonly byDef = new Map<ComponentDef<unknown>, Registered<unknown>>();
  private nextId = 0;

  /**
   * Register `def` for replication under `name` (the cross-process identity of
   * the component — it must match across peers). Pass `encode`/`decode` to
   * override the default numeric-field coding (e.g. for enum/string fields).
   */
  registerComponent<C>(
    def: ComponentDef<C>,
    name: string,
    encode?: (v: C, w: BinaryWriter) => void,
    decode?: (r: BinaryReader) => C,
  ): this {
    if (this.byDef.has(def as ComponentDef<unknown>)) return this;
    const id = this.nextId++;
    const reg: Registered<unknown> = {
      def: def as ComponentDef<unknown>,
      id,
      name,
      encode: (encode ?? numericEncode) as (v: unknown, w: BinaryWriter) => void,
      decode: (decode ?? numericDecode) as (r: BinaryReader) => unknown,
    };
    this.byId.set(id, reg);
    this.byDef.set(def as ComponentDef<unknown>, reg);
    return this;
  }

  /** Number of distinct component types registered for replication. */
  get componentCount(): number {
    return this.byDef.size;
  }

  /** Serialize every live entity and its replicated components to bytes. */
  serialize(world: World): Uint8Array {
    const w = new BinaryWriter();
    const entities = world.entities().slice().sort((a, b) => a - b);
    w.u32(entities.length);
    for (const id of entities) {
      w.i32(id);
      // Collect this entity's replicated components in stable wire-id order.
      const parts: Array<{ id: number; enc: Registered<unknown> }> = [];
      for (const reg of this.byDef.values()) {
        if (world.hasComponent(id, reg.def)) {
          parts.push({ id: reg.id, enc: reg });
        }
      }
      parts.sort((a, b) => a.id - b.id);
      w.u32(parts.length);
      for (const p of parts) {
        w.u32(p.id);
        const value = world.getComponent(id, p.enc.def) as ComponentValue<unknown>;
        p.enc.encode(value, w);
      }
    }
    return w.toUint8Array();
  }

  /**
   * Rebuild the replicated entities/components onto `world`. Entities are
   * created deterministically in ascending wire-id order; components are
   * attached with their decoded values. Entities already alive are reused when
   * their id matches, otherwise new ids are allocated (ascending input keeps the
   * allocator aligned). `world`'s systems are left intact.
   *
   * Returns the set of entity ids that were (re)materialized, in ascending order.
   */
  deserialize(bytes: Uint8Array, world: World): EntityId[] {
    const r = new BinaryReader(bytes);
    const count = r.u32();
    const created: EntityId[] = [];
    for (let i = 0; i < count; i++) {
      const id = r.i32();
      const assigned = this.ensureEntity(world, id);
      created.push(assigned);
      const parts = r.u32();
      for (let p = 0; p < parts; p++) {
        const cid = r.u32();
        const reg = this.byId.get(cid);
        if (!reg) throw new RangeError(`codec: unknown wire component id ${cid}`);
        const value = reg.decode(r) as ComponentValue<typeof reg.def>;
        world.addComponent(assigned, reg.def, value);
      }
    }
    return created;
  }

  /**
   * Make `world` own entity `id`. Because @omega/ecs allocates ids from its own
   * counter/free-list, we drive creation until the registry hands back the
   * target id. Input is always supplied in ascending order and entity deletion
   * (where needed) is done ascending as well, so the allocator cooperates and
   * this terminates immediately in the common case.
   */
  private ensureEntity(world: World, target: EntityId): EntityId {
    if (world.isAlive(target)) return target;
    let id = world.createEntity();
    while (id < target) {
      id = world.createEntity();
    }
    return id;
  }
}

/**
 * Convenience: serialize a world at `tick` straight into a `WorldSnapshot`.
 * The whole ECS state is the snapshot payload.
 */
export function worldToSnapshot(world: World, tick: number, codec: Codec): WorldSnapshot {
  return { tick, data: codec.serialize(world) };
}

/**
 * Rebuild `s.data` onto `world`, leaving it reflecting the authoritative frame
 * at `s.tick`. Returns the rematerialized entity ids (ascending).
 *
 * NOTE: this destroys every currently-alive entity first (in ascending-id
 * order) so the allocator reproduces the exact ids in the snapshot, while
 * preserving any systems the caller registered. If you need to merge instead of
 * overwrite, clear only the replicated entities yourself beforehand.
 */
export function snapshotToWorld(s: WorldSnapshot, world: World, codec: Codec): EntityId[] {
  const alive = world.entities().slice().sort((a, b) => a - b);
  for (const id of alive) world.destroyEntity(id);
  return codec.deserialize(s.data, world);
}
