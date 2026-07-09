import { describe, it, expect } from 'vitest';
import { Encoder } from './encoder.js';
import { Vec3 } from '@omega/engine-math';

describe('Encoder', () => {
  it('writes little-endian primitives with exact byte layout', () => {
    const enc = new Encoder();
    enc.u8(0xff);
    enc.u16(0x0102);
    enc.u32(0x01020304);
    enc.i32(-2);
    enc.f32(1.5);
    enc.f64(3.141592653589793);
    const out = enc.bytes();

    // u8
    expect(out[0]).toBe(0xff);
    // u16 LE
    expect(out[1]).toBe(0x02);
    expect(out[2]).toBe(0x01);
    // u32 LE
    expect([...out.slice(3, 7)]).toEqual([0x04, 0x03, 0x02, 0x01]);
    // i32 LE -2 -> 0xfffffffe
    expect([...out.slice(7, 11)]).toEqual([0xfe, 0xff, 0xff, 0xff]);
    // f32 1.5
    expect([...out.slice(11, 15)]).toEqual([0x00, 0x00, 0xc0, 0x3f]);
    // f64 pi
    expect([...out.slice(15, 23)]).toEqual(
      [0x18, 0x2d, 0x44, 0x54, 0xfb, 0x21, 0x09, 0x40],
    );
    expect(out.length).toBe(23);
  });

  it('writes str as u32 length-prefixed UTF-8', () => {
    const enc = new Encoder();
    enc.str('héllo');
    const out = enc.bytes();
    // length prefix = 6 (h,é,l,l,o) where é is 2 bytes -> 6 bytes total
    expect([...out.slice(0, 4)]).toEqual([6, 0, 0, 0]);
    expect(new TextDecoder().decode(out.slice(4))).toBe('héllo');
  });

  it('writes bytes as u32 length-prefixed', () => {
    const enc = new Encoder();
    enc.bytes(Uint8Array.from([1, 2, 3, 255]));
    const out = enc.bytes();
    expect([...out.slice(0, 4)]).toEqual([4, 0, 0, 0]);
    expect([...out.slice(4)]).toEqual([1, 2, 3, 255]);
  });

  it('writes vec3 as three f32', () => {
    const enc = new Encoder();
    enc.vec3(new Vec3(1.5, -2.5, 0.0));
    const out = enc.bytes();
    expect(out.length).toBe(12);
    expect([...out.slice(0, 4)]).toEqual([0x00, 0x00, 0xc0, 0x3f]);
    expect([...out.slice(4, 8)]).toEqual([0x00, 0x00, 0x20, 0xc0]);
    expect([...out.slice(8, 12)]).toEqual([0x00, 0x00, 0x00, 0x00]);
  });

  it('supports method chaining', () => {
    const enc = new Encoder();
    const ret = enc.u8(1).u16(2).u32(3).str('x').bytes(Uint8Array.from([9]));
    expect(ret).toBe(enc);
  });

  it('bytes() returns exact length with no trailing capacity', () => {
    const enc = new Encoder(1024); // big initial capacity
    enc.u8(1).u8(2);
    const out = enc.bytes();
    expect(out.length).toBe(2);
    expect(out.byteLength).toBe(2);
  });

  it('grows the buffer past initial capacity', () => {
    const enc = new Encoder(2);
    for (let i = 0; i < 100; i++) enc.u8(i & 0xff);
    const out = enc.bytes();
    expect(out.length).toBe(100);
    expect([...out]).toEqual(Array.from({ length: 100 }, (_, i) => i & 0xff));
  });
});
