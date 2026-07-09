/**
 * Byte-level run-length encoding (RLE).
 *
 * Stream of tokens: [count: u8 in 1..255][value: u8].
 * Each token expands to `count` copies of `value`. Runs longer than 255 are
 * split across multiple tokens. This is deliberately simple: it always
 * round-trips exactly for any input (correctness over ratio).
 */
export function compress(bytes: Uint8Array): Uint8Array {
  const out: number[] = [];
  let i = 0;
  const n = bytes.length;
  while (i < n) {
    const value = bytes[i];
    let run = 1;
    while (i + run < n && bytes[i + run] === value && run < 255) run++;
    out.push(run, value);
    i += run;
  }
  return Uint8Array.from(out);
}

export function decompress(bytes: Uint8Array): Uint8Array {
  if (bytes.length % 2 !== 0) {
    throw new RangeError('RLE decompress: input length must be even');
  }
  let total = 0;
  for (let i = 0; i < bytes.length; i += 2) total += bytes[i];
  const out = new Uint8Array(total);
  let o = 0;
  for (let i = 0; i < bytes.length; i += 2) {
    const count = bytes[i];
    const value = bytes[i + 1];
    for (let k = 0; k < count; k++) out[o++] = value;
  }
  return out;
}
