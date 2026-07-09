import { describe, it, expect } from 'vitest';
import { Rng } from '@omega/engine-core';
import { compress, decompress } from './compress.js';

describe('compress/decompress', () => {
  it('round-trips an empty array', () => {
    const x = new Uint8Array(0);
    expect([...decompress(compress(x))]).toEqual([...x]);
  });

  it('round-trips an all-same run (longer than 255)', () => {
    const x = new Uint8Array(1000).fill(7);
    const c = compress(x);
    expect([...decompress(c)]).toEqual([...x]);
    expect(c.length).toBeLessThan(x.length);
  });

  it('round-trips seeded random bytes', () => {
    const rng = new Rng(0xdeadbeefn);
    const x = new Uint8Array(2048);
    for (let i = 0; i < x.length; i++) x[i] = Math.floor(rng.nextF64() * 256) & 0xff;
    expect([...decompress(compress(x))]).toEqual([...x]);
  });

  it('round-trips structured arrays with mixed runs', () => {
    const parts: number[] = [];
    for (let v = 0; v < 10; v++) for (let k = 0; k < v * 30 + 1; k++) parts.push(v);
    const x = Uint8Array.from(parts);
    expect([...decompress(compress(x))]).toEqual([...x]);
  });

  it('throws on malformed (odd-length) input', () => {
    expect(() => decompress(Uint8Array.from([1, 2, 3]))).toThrow(RangeError);
  });
});
