/**
 * @omega/engine-core — deterministic pseudo-random number generator.
 *
 * Seed expansion uses splitmix64; the sequence generator is xoshiro256**.
 * Both operate on full 64-bit state via BigInt so results are identical across
 * platforms (no 53-bit integer truncation). See docs/adr/0001-determinism.md.
 *
 * The RNG state can be snapshotted (state()/setState) so a simulation can be
 * checkpointed and resumed bit-for-bit.
 */

const MASK64 = (1n << 64n) - 1n;
const SPLITMIX_INCREMENT = 0x9e3779b97f4a7c15n;
const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;

function rotl(x: bigint, k: number): bigint {
  return ((x << BigInt(k)) & MASK64) | (x >> BigInt(64 - k));
}

function splitmix64Next(zRef: { z: bigint }): bigint {
  zRef.z = (zRef.z + SPLITMIX_INCREMENT) & MASK64;
  let r = zRef.z;
  r = ((r ^ (r >> 30n)) * 0xbf58476d1ce4e5b9n) & MASK64;
  r = ((r ^ (r >> 27n)) * 0x94d049bb133111ebn) & MASK64;
  return (r ^ (r >> 31n)) & MASK64;
}

/** Hash an arbitrary string to a 64-bit value (FNV-1a 64-bit). */
export function hashString64(s: string): bigint {
  let h = FNV_OFFSET;
  for (let i = 0; i < s.length; i++) {
    h = (h ^ BigInt(s.charCodeAt(i))) & MASK64;
    h = (h * FNV_PRIME) & MASK64;
  }
  return h;
}

/** Convert any seed input to a 64-bit integer. */
function seedToBigInt(seed: bigint | number | string): bigint {
  if (typeof seed === 'bigint') return seed & MASK64;
  if (typeof seed === 'number') {
    if (!Number.isFinite(seed)) return 0n;
    // Use the integer bits of the double to avoid float->int surprises.
    return BigInt(Math.trunc(seed)) & MASK64;
  }
  return hashString64(seed);
}

export class Rng {
  private s0: bigint;
  private s1: bigint;
  private s2: bigint;
  private s3: bigint;

  constructor(seed: bigint | number | string = 0) {
    const z = seedToBigInt(seed);
    const ref = { z };
    this.s0 = splitmix64Next(ref);
    this.s1 = splitmix64Next(ref);
    this.s2 = splitmix64Next(ref);
    this.s3 = splitmix64Next(ref);
  }

  /** Next raw 64-bit unsigned integer. */
  nextU64(): bigint {
    const result = (rotl((this.s1 * 5n) & MASK64, 7) * 9n) & MASK64;
    const t = (this.s1 << 17n) & MASK64;
    this.s2 ^= this.s0;
    this.s3 ^= this.s1;
    this.s1 ^= this.s2;
    this.s0 ^= this.s3;
    this.s2 ^= t;
    this.s3 = rotl(this.s3, 45);
    return result;
  }

  /** Next double in [0, 1), using the top 53 bits (safe for JS Number). */
  nextF64(): number {
    return Number(this.nextU64() >> 11n) / 9007199254740992; // 2^53
  }

  /** Float in [lo, hi). */
  nextRange(lo: number, hi: number): number {
    return lo + this.nextF64() * (hi - lo);
  }

  /** Integer in [lo, hi] inclusive. */
  nextInt(lo: number, hi: number): number {
    if (hi < lo) [lo, hi] = [hi, lo];
    const span = hi - lo + 1;
    return lo + Math.floor(this.nextF64() * span);
  }

  /** Boolean true with probability p (default 0.5). */
  bool(p = 0.5): boolean {
    return this.nextF64() < p;
  }

  /** Uniformly pick one element. */
  pick<T>(arr: readonly T[]): T {
    if (arr.length === 0) throw new Error('Rng.pick: empty array');
    return arr[this.nextInt(0, arr.length - 1)];
  }

  /** Fisher–Yates shuffle in place; returns the same array for convenience. */
  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.nextInt(0, i);
      const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  /** Snapshot internal state as decimal strings (JSON-serializable). */
  state(): string[] {
    return [this.s0.toString(), this.s1.toString(), this.s2.toString(), this.s3.toString()];
  }

  /** Restore internal state from a snapshot produced by state(). */
  setState(s: string[]): void {
    if (s.length !== 4) throw new Error('Rng.setState: expected 4 state words');
    this.s0 = BigInt(s[0]) & MASK64;
    this.s1 = BigInt(s[1]) & MASK64;
    this.s2 = BigInt(s[2]) & MASK64;
    this.s3 = BigInt(s[3]) & MASK64;
  }
}
