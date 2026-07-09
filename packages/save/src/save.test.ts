import { describe, it, expect } from 'vitest';
import { SaveWriter, SaveReader, SAVE_MAGIC } from './save.js';

describe('SaveWriter/SaveReader', () => {
  const data = { name: 'omega', level: 42, items: ['a', 'b'], nested: { x: 1 } };

  it('round-trips header and payload deep-equal', () => {
    const bytes = SaveWriter.write(data, 123456789, 0xaaaan, 0xbbbbn);
    const save = SaveReader.read<typeof data>(bytes);
    expect(save.header.magic).toBe(SAVE_MAGIC);
    expect(save.header.version).toBe(1);
    expect(save.header.createdAt).toBe(123456789);
    expect(save.header.seedLow).toBe(0xaaaan);
    expect(save.header.seedHigh).toBe(0xbbbbn);
    expect(save.data).toEqual(data);
  });

  it('throws on wrong magic', () => {
    const bytes = SaveWriter.write(data, 1, 0n, 0n);
    bytes[0] = 0x00;
    expect(() => SaveReader.read(bytes)).toThrow(/magic/i);
  });

  it('is deterministic: same inputs produce byte-identical output', () => {
    const a = SaveWriter.write(data, 555, 1n, 2n);
    const b = SaveWriter.write(data, 555, 1n, 2n);
    expect([...a]).toEqual([...b]);
  });
});
