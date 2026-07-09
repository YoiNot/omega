import { describe, it, expect } from 'vitest';
import { BinaryWriter, BinaryReader } from './encoder.js';

describe('BinaryWriter/BinaryReader', () => {
  it('round-trips all primitive types and string/bytes', () => {
    const w = new BinaryWriter(4); // small initial cap to exercise growth
    w.writeU8(200);
    w.writeU16(60000);
    w.writeU32(4000000000);
    w.writeU64(0x0123456789abcdefn);
    w.writeF32(1.5);
    w.writeF64(Math.PI);
    w.writeString('héllo ω');
    w.writeBytes(Uint8Array.from([1, 2, 3, 255]));

    const r = new BinaryReader(w.toUint8Array());
    expect(r.readU8()).toBe(200);
    expect(r.readU16()).toBe(60000);
    expect(r.readU32()).toBe(4000000000);
    expect(r.readU64()).toBe(0x0123456789abcdefn);
    expect(r.readF32()).toBeCloseTo(1.5, 5);
    expect(r.readF64()).toBe(Math.PI);
    expect(r.readString()).toBe('héllo ω');
    expect([...r.readBytes(4)]).toEqual([1, 2, 3, 255]);
  });

  it('throws on read past end (overflow guard)', () => {
    const w = new BinaryWriter();
    w.writeU8(1);
    const r = new BinaryReader(w.toUint8Array());
    expect(r.readU8()).toBe(1);
    expect(() => r.readU32()).toThrow(RangeError);
  });

  it('tracks offset', () => {
    const w = new BinaryWriter();
    w.writeU32(1);
    w.writeU16(2);
    const r = new BinaryReader(w.toUint8Array());
    r.readU32();
    expect(r.offset).toBe(4);
    r.readU16();
    expect(r.offset).toBe(6);
  });
});
