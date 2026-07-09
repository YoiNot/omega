import type { Vec3 } from '@omega/engine-math';

const textEncoder = new TextEncoder();

/**
 * Growable little-endian binary writer for engine data types.
 * Methods that write a value return `this` to allow chaining; the no-arg
 * `bytes()` overload returns the exact-length buffer.
 */
export class Encoder {
  private buf: Uint8Array;
  private view: DataView;
  private pos = 0;

  constructor(initialCapacity = 64) {
    this.buf = new Uint8Array(initialCapacity);
    this.view = new DataView(this.buf.buffer);
  }

  private ensure(extra: number): void {
    const needed = this.pos + extra;
    if (needed <= this.buf.length) return;
    let cap = this.buf.length * 2;
    if (cap < 64) cap = 64;
    while (cap < needed) cap *= 2;
    const next = new Uint8Array(cap);
    next.set(this.buf.subarray(0, this.pos));
    this.buf = next;
    this.view = new DataView(this.buf.buffer);
  }

  u8(v: number): this {
    this.ensure(1);
    this.view.setUint8(this.pos, v);
    this.pos += 1;
    return this;
  }

  u16(v: number): this {
    this.ensure(2);
    this.view.setUint16(this.pos, v, true);
    this.pos += 2;
    return this;
  }

  u32(v: number): this {
    this.ensure(4);
    this.view.setUint32(this.pos, v >>> 0, true);
    this.pos += 4;
    return this;
  }

  i32(v: number): this {
    this.ensure(4);
    this.view.setInt32(this.pos, v | 0, true);
    this.pos += 4;
    return this;
  }

  f32(v: number): this {
    this.ensure(4);
    this.view.setFloat32(this.pos, v, true);
    this.pos += 4;
    return this;
  }

  f64(v: number): this {
    this.ensure(8);
    this.view.setFloat64(this.pos, v, true);
    this.pos += 8;
    return this;
  }

  /** u32 length-prefixed UTF-8 string (deterministic byte layout). */
  str(s: string): this {
    const enc = textEncoder.encode(s);
    this.u32(enc.length);
    this.ensure(enc.length);
    this.buf.set(enc, this.pos);
    this.pos += enc.length;
    return this;
  }

  /** u32 length-prefixed raw bytes. */
  bytes(b: Uint8Array): this;
  /** Exact-length snapshot of everything written so far. */
  bytes(): Uint8Array;
  bytes(b?: Uint8Array): this | Uint8Array {
    if (b === undefined) return this.buf.slice(0, this.pos);
    this.u32(b.length);
    this.ensure(b.length);
    this.buf.set(b, this.pos);
    this.pos += b.length;
    return this;
  }

  /** Three f32 components (x, y, z). */
  vec3(v: Vec3): this {
    return this.f32(v.x).f32(v.y).f32(v.z);
  }
}
