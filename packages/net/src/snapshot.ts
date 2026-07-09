/**
 * @omega/net — world snapshots, buffering, interpolation, and (de)serialization.
 *
 * A `WorldSnapshot` is a single authoritative frame of simulation state. We treat
 * `data` as a flat `Float32Array` of entity state (positions, velocities, ...).
 * The exact byte layout is owned by the simulation; this module only moves and
 * blends the floats element-wise.
 *
 * Determinism: interpolation is a pure lerp with clamped alpha. Serialization is
 * a fixed, length-prefixed little-endian format. No randomness, no timestamps
 * generated internally (a tick is passed in by the caller).
 */

import { clamp } from '@omega/engine-math';

/** A single authoritative frame of the world at simulation tick `tick`. */
export interface WorldSnapshot {
  readonly tick: number;
  /** Flat Float32 entity-state field (length is implicit in the buffer). */
  readonly data: Uint8Array;
}

/** Allocate a `WorldSnapshot` from a Float32Array (or a number[]). */
export function makeSnapshot(tick: number, field: Float32Array | number[]): WorldSnapshot {
  if (Array.isArray(field)) field = Float32Array.from(field);
  return { tick, data: new Uint8Array(field.buffer, field.byteOffset, field.byteLength) };
}

/** View the raw bytes of a snapshot as a Float32Array without copying. */
export function asFloat32(s: WorldSnapshot): Float32Array {
  return new Float32Array(s.data.buffer, s.data.byteOffset, s.data.byteLength / 4);
}

/**
 * Ring buffer of recent snapshots, kept for client-side interpolation.
 *
 * Capacity is fixed at construction. Inserting beyond capacity overwrites the
 * oldest entry. Lookups are by age (0 = newest). Snapshots are copied on insert
 * so the buffer owns stable memory.
 */
export class SnapshotBuffer {
  private readonly capacity: number;
  private readonly ring: WorldSnapshot[] = [];
  private count = 0;

  constructor(capacity = 8) {
    if (capacity < 1) throw new RangeError('SnapshotBuffer capacity must be >= 1');
    this.capacity = capacity;
  }

  /** Push a snapshot, copying its data so external mutation can't leak in. */
  push(s: WorldSnapshot): void {
    const copy: WorldSnapshot = { tick: s.tick, data: s.data.slice() };
    if (this.count < this.capacity) {
      this.ring.push(copy);
      this.count += 1;
    } else {
      // Overwrite oldest (ring[0]); rotate so newest is last.
      this.ring.shift();
      this.ring.push(copy);
    }
  }

  /** Snapshot at age `i` (0 = newest, count-1 = oldest). Undefined if out of range. */
  at(age: number): WorldSnapshot | undefined {
    if (age < 0 || age >= this.count) return undefined;
    return this.ring[this.count - 1 - age];
  }

  /** Newest snapshot, or undefined if empty. */
  latest(): WorldSnapshot | undefined {
    return this.count === 0 ? undefined : this.ring[this.count - 1];
  }

  /** Oldest retained snapshot, or undefined if empty. */
  oldest(): WorldSnapshot | undefined {
    return this.count === 0 ? undefined : this.ring[0];
  }

  get size(): number {
    return this.count;
  }
}

/**
 * Interpolate element-wise between two snapshots at blend factor `alpha`.
 *
 * `alpha` is clamped to [0,1]. The result is a fresh `WorldSnapshot` whose data
 * length equals `min(a, b)` element count (we lerp only the common prefix so
 * mismatched lengths cannot read past either buffer). `a` and `b` may have
 * different tick values; only their float fields are blended.
 */
export function interpolate(a: WorldSnapshot, b: WorldSnapshot, alpha: number): WorldSnapshot {
  const av = asFloat32(a);
  const bv = asFloat32(b);
  const n = Math.min(av.length, bv.length);
  const t = clamp(alpha, 0, 1);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = av[i] + (bv[i] - av[i]) * t;
  }
  return makeSnapshot(b.tick, out);
}

/**
 * Wire format: u32 tick (LE) | u32 float-count (LE) | float-count * f32 (LE).
 * Deterministic and self-describing (length prefixed) so decoders need no
 * prior schema. Built on top of @omega/save's BinaryWriter/Reader when present,
 * but we implement a tiny standalone writer to avoid a hard dependency.
 */
export function encodeSnapshot(s: WorldSnapshot): Uint8Array {
  const f = asFloat32(s);
  const out = new Uint8Array(8 + f.length * 4);
  const view = new DataView(out.buffer);
  view.setUint32(0, s.tick >>> 0, true);
  view.setUint32(4, f.length, true);
  for (let i = 0; i < f.length; i++) {
    view.setFloat32(8 + i * 4, f[i], true);
  }
  return out;
}

/** Inverse of {@link encodeSnapshot}. Throws on malformed input. */
export function decodeSnapshot(bytes: Uint8Array): WorldSnapshot {
  if (bytes.length < 8) throw new RangeError('snapshot frame too short');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tick = view.getUint32(0, true);
  const count = view.getUint32(4, true);
  const need = 8 + count * 4;
  if (bytes.length < need) throw new RangeError('snapshot frame truncated');
  const f = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    f[i] = view.getFloat32(8 + i * 4, true);
  }
  return { tick, data: new Uint8Array(f.buffer) };
}
