import { describe, it, expect } from 'vitest';
import { Encoder } from './encoder.js';
import { Decoder } from './decoder.js';
import { Vec3 } from '@omega/engine-math';

describe('Decoder', () => {
  it('reads back exactly what the Encoder wrote', () => {
    const buf = new Encoder()
      .u8(200)
      .u16(60000)
      .u32(4000000000)
      .i32(-123456)
      .f32(1.5)
      .f64(Math.PI)
      .str('héllo ω')
      .bytes(Uint8Array.from([1, 2, 3, 255]))
      .vec3(new Vec3(1.0, 2.0, 3.0))
      .bytes();

    const dec = new Decoder(buf);
    expect(dec.u8()).toBe(200);
    expect(dec.u16()).toBe(60000);
    expect(dec.u32()).toBe(4000000000);
    expect(dec.i32()).toBe(-123456);
    expect(dec.f32()).toBeCloseTo(1.5, 6);
    expect(dec.f64()).toBe(Math.PI);
    expect(dec.str()).toBe('héllo ω');
    expect([...dec.bytes()]).toEqual([1, 2, 3, 255]);
    const v = dec.vec3();
    expect([v.x, v.y, v.z]).toEqual([1.0, 2.0, 3.0]);
    expect(dec.offset).toBe(buf.length);
  });

  it('throws RangeError on integer overrun', () => {
    const dec = new Decoder(new Uint8Array([1]));
    expect(dec.u8()).toBe(1);
    expect(() => dec.u32()).toThrow(RangeError);
  });

  it('throws RangeError when string length prefix exceeds buffer', () => {
    // claims a 100-byte string but provides none
    const dec = new Decoder(new Uint8Array([100, 0, 0, 0]));
    expect(() => dec.str()).toThrow(RangeError);
  });

  it('throws RangeError when bytes length prefix exceeds buffer', () => {
    const dec = new Decoder(new Uint8Array([5, 0, 0, 0, 1]));
    expect(() => dec.bytes()).toThrow(RangeError);
  });

  it('is deterministic: same input -> identical bytes', () => {
    const make = () =>
      new Encoder().u32(7).i32(-1).f32(0.5).str('abc').bytes();
    expect([...make()]).toEqual([...make()]);
  });
});
