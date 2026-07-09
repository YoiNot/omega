const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

/** Growable little-endian binary writer. */
export class BinaryWriter {
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
    while (cap < needed) cap *= 2;
    const next = new Uint8Array(cap);
    next.set(this.buf.subarray(0, this.pos));
    this.buf = next;
    this.view = new DataView(this.buf.buffer);
  }

  writeU8(v: number): void {
    this.ensure(1);
    this.view.setUint8(this.pos, v);
    this.pos += 1;
  }

  writeU16(v: number): void {
    this.ensure(2);
    this.view.setUint16(this.pos, v, true);
    this.pos += 2;
  }

  writeU32(v: number): void {
    this.ensure(4);
    this.view.setUint32(this.pos, v >>> 0, true);
    this.pos += 4;
  }

  /** 64-bit unsigned via two little-endian u32 writes (low then high). */
  writeU64(v: bigint): void {
    const mask = 0xffffffffn;
    const low = Number(v & mask) >>> 0;
    const high = Number((v >> 32n) & mask) >>> 0;
    this.writeU32(low);
    this.writeU32(high);
  }

  writeF32(v: number): void {
    this.ensure(4);
    this.view.setFloat32(this.pos, v, true);
    this.pos += 4;
  }

  writeF64(v: number): void {
    this.ensure(8);
    this.view.setFloat64(this.pos, v, true);
    this.pos += 8;
  }

  writeBytes(bytes: Uint8Array): void {
    this.ensure(bytes.length);
    this.buf.set(bytes, this.pos);
    this.pos += bytes.length;
  }

  /** u32 length-prefixed UTF-8 string. */
  writeString(s: string): void {
    const enc = textEncoder.encode(s);
    this.writeU32(enc.length);
    this.writeBytes(enc);
  }

  toUint8Array(): Uint8Array {
    return this.buf.slice(0, this.pos);
  }
}

/** Little-endian binary reader with bounds checking. */
export class BinaryReader {
  private view: DataView;
  private pos = 0;

  constructor(private readonly buf: Uint8Array) {
    this.view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  }

  get offset(): number {
    return this.pos;
  }

  private check(n: number): void {
    if (this.pos + n > this.buf.length) {
      throw new RangeError(
        `BinaryReader overflow: need ${n} bytes at offset ${this.pos}, length ${this.buf.length}`,
      );
    }
  }

  readU8(): number {
    this.check(1);
    const v = this.view.getUint8(this.pos);
    this.pos += 1;
    return v;
  }

  readU16(): number {
    this.check(2);
    const v = this.view.getUint16(this.pos, true);
    this.pos += 2;
    return v;
  }

  readU32(): number {
    this.check(4);
    const v = this.view.getUint32(this.pos, true);
    this.pos += 4;
    return v;
  }

  readU64(): bigint {
    const low = BigInt(this.readU32());
    const high = BigInt(this.readU32());
    return (high << 32n) | low;
  }

  readF32(): number {
    this.check(4);
    const v = this.view.getFloat32(this.pos, true);
    this.pos += 4;
    return v;
  }

  readF64(): number {
    this.check(8);
    const v = this.view.getFloat64(this.pos, true);
    this.pos += 8;
    return v;
  }

  readBytes(n: number): Uint8Array {
    this.check(n);
    const out = this.buf.slice(this.pos, this.pos + n);
    this.pos += n;
    return out;
  }

  readString(): string {
    const len = this.readU32();
    const bytes = this.readBytes(len);
    return textDecoder.decode(bytes);
  }
}
