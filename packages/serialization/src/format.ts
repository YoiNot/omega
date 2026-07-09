import { Encoder } from './encoder.js';
import { Decoder } from './decoder.js';
import { Vec3 } from '@omega/engine-math';

/** A single entity record in a minimal world snapshot. */
export interface EntityRecord {
  id: number;
  pos: Vec3;
  tag: string;
}

/** Minimal world state accepted by {@link encodeState}/{@link decodeState}. */
export interface WorldStateLike {
  entities: EntityRecord[];
}

/**
 * Deterministically serialize a world state to bytes.
 * Layout: u32 entity count, then per entity u32 id, 3× f32 pos, u32-len str tag.
 * Identical input always yields identical bytes.
 */
export function encodeState(state: WorldStateLike): Uint8Array {
  const enc = new Encoder();
  enc.u32(state.entities.length);
  for (const e of state.entities) {
    enc.u32(e.id);
    enc.vec3(e.pos);
    enc.str(e.tag);
  }
  return enc.bytes();
}

/**
 * Inverse of {@link encodeState}. Throws {@link RangeError} on a malformed
 * (too-short or truncated) buffer.
 */
export function decodeState(buf: Uint8Array): WorldStateLike {
  const dec = new Decoder(buf);
  const count = dec.u32();
  const entities: EntityRecord[] = new Array(count);
  for (let i = 0; i < count; i++) {
    const id = dec.u32();
    const pos = dec.vec3();
    const tag = dec.str();
    entities[i] = { id, pos, tag };
  }
  return { entities };
}
