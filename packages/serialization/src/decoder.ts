import { Vec3 } from '@omega/engine-math';

const textDecoder = new TextDecoder();

/**
 * Little-endian binary reader symmetric to {@link Encoder}.
 * Every read checks bounds and throws a {@link RangeError} on overrun.
 */
export class Decoder {
  private view: DataView;
  private pos = 0;

  constructor(private readonly buf: Uint8Array) {
    this.view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  }

  /** Current read offset. */
  get offset(): number {
    return this.pos;
  }

  private check(n: number): void {
    if (this.pos + n > this.buf.length) {
      throw new RangeError(
        `Decoder overrun: need ${n} byte(s) at offset ${this.pos}, buffer length ${this.buf.length}`,
      );
    }
  }

  u8(): number {
    this.check(1);
    const v = this.view.getUint8(this.pos);
    this.pos += 1;
    return v;
  }

  u16(): number {
    this.check(2);
    const v = this.view.getUint16(this.pos, true);
    this.pos += 2;
    return v;
  }

  u32(): number {
    this.check(4);
    const v = this.view.getUint32(this.pos, true);
    this.pos += 4;
    return v;
  }

  i32(): number {
    this.check(4);
    const v = this.view.getInt32(this.pos, true);
    this.pos += 4;
    return v;
  }

  f32(): number {
    this.check(4);
    const v = this.view.getFloat32(this.pos, true);
    this.pos += 4;
    return v;
  }

  f64(): number {
    this.check(8);
    const v = this.view.getFloat64(this.pos, true);
    this.pos += 8;
    return v;
  }

  /** Reads a u32 length prefix then decodes that many UTF-8 bytes. */
  str(): string {
    const len = this.u32();
    this.check(len);
    const slice = this.buf.subarray(this.pos, this.pos + len);
    this.pos += len;
    return textDecoder.decode(slice);
  }

  /** Reads a u32 length prefix then that many raw bytes. */
  bytes(): Uint8Array {
    const len = this.u32();
    this.check(len);
    const slice = this.buf.slice(this.pos, this.pos + len);
    this.pos += len;
    return slice;
  }

  /** Reads three f32 components into a new {@link Vec3}. */
  vec3(): Vec3 {
    return new Vec3(this.f32(), this.f32(), this.f32());
  }
}
