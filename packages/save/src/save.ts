import { BinaryWriter, BinaryReader } from './encoder.js';
import { compress, decompress } from './compress.js';

/** 'OMEG' big-endian as a u32 constant. */
export const SAVE_MAGIC = 0x4f4d4547;
/** Current on-disk format version. */
export const SAVE_FORMAT_VERSION = 1;

export interface SaveHeader {
  magic: number;
  version: number;
  createdAt: number;
  seedLow: bigint;
  seedHigh: bigint;
}

export interface SaveFile<T = unknown> {
  header: SaveHeader;
  data: T;
}

const textEncoder = new TextEncoder();

export class SaveWriter {
  /**
   * Serialize a JSON-able snapshot. `createdAt` is passed in (never Date.now())
   * to keep serialization fully deterministic.
   */
  static write(
    data: unknown,
    createdAt: number,
    seedLow: bigint,
    seedHigh: bigint,
    version = SAVE_FORMAT_VERSION,
  ): Uint8Array {
    const w = new BinaryWriter();
    w.writeU32(SAVE_MAGIC);
    w.writeU32(version);
    w.writeF64(createdAt);
    w.writeU64(seedLow);
    w.writeU64(seedHigh);

    const json = JSON.stringify(data);
    const jsonBytes = textEncoder.encode(json);
    const compressed = compress(jsonBytes);
    w.writeU32(compressed.length);
    w.writeBytes(compressed);
    return w.toUint8Array();
  }
}

export class SaveReader {
  static read<T = unknown>(bytes: Uint8Array): SaveFile<T> {
    const r = new BinaryReader(bytes);
    const magic = r.readU32();
    if (magic !== SAVE_MAGIC) {
      throw new Error(
        `Bad save magic: expected 0x${SAVE_MAGIC.toString(16)}, got 0x${magic.toString(16)}`,
      );
    }
    const version = r.readU32();
    const createdAt = r.readF64();
    const seedLow = r.readU64();
    const seedHigh = r.readU64();

    const compressedLen = r.readU32();
    const compressed = r.readBytes(compressedLen);
    const jsonBytes = decompress(compressed);
    const json = new TextDecoder().decode(jsonBytes);
    const data = JSON.parse(json) as T;

    const header: SaveHeader = { magic, version, createdAt, seedLow, seedHigh };
    return { header, data };
  }
}
