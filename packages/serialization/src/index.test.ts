import { describe, it, expect } from 'vitest';
import * as ser from './index.js';
import { Vec3 } from '@omega/engine-math';

describe('index exports', () => {
  it('exposes Encoder and Decoder', () => {
    expect(typeof ser.Encoder).toBe('function');
    expect(typeof ser.Decoder).toBe('function');
  });

  it('exposes encodeState and decodeState', () => {
    expect(typeof ser.encodeState).toBe('function');
    expect(typeof ser.decodeState).toBe('function');
  });

  it('round-trips through public API', () => {
    const buf = ser.encodeState({
      entities: [
        { id: 1, pos: new Vec3(1, 2, 3), tag: 'a' },
        { id: 2, pos: new Vec3(0, 0, 0), tag: 'b' },
      ],
    });
    const out = ser.decodeState(buf);
    expect(out.entities).toHaveLength(2);
    expect(out.entities[0]).toMatchObject({ id: 1, tag: 'a' });
    expect(out.entities[1]).toMatchObject({ id: 2, tag: 'b' });
  });
});
