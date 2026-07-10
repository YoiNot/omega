/**
 * @omega/job — Node worker lane (self-contained ES module).
 *
 * This is plain JavaScript on purpose: it is spawned via Node's native
 * `worker_threads` `new Worker()` (which requires a real JS file, not TS), and
 * it must run without importing the TS source tree. To stay deterministic and
 * transport-safe, it embeds its own copy of the exact xoshiro256** RNG used by
 * `@omega/engine-core` (splitmix64 seed expansion, 64-bit BigInt math), plus
 * the per-item seed-mix the scheduler uses. `worker.test.ts` proves, bit for
 * bit, that this embedded RNG produces the identical sequence as the engine's
 * `Rng` for the same seed — that is what keeps the parallel job deterministic.
 *
 * Each lane processes a contiguous shard [start, end) and writes ONLY into its
 * own item slots of the shared result buffer. Shards are disjoint, so lane
 * scheduling order cannot change the final bytes.
 *
 * The user reducer arrives as source text (functions can't cross the
 * structuredClone boundary); we rebuild it with `new Function`.
 */

import { parentPort, workerData, isMainThread } from 'node:worker_threads';

const MASK64 = (1n << 64n) - 1n;
const SPLITMIX_INCREMENT = 0x9e3779b97f4a7c15n;

function rotl(x, k) {
  return ((x << BigInt(k)) & MASK64) | (x >> BigInt(64 - k));
}

function splitmix64Next(zRef) {
  zRef.z = (zRef.z + SPLITMIX_INCREMENT) & MASK64;
  let r = zRef.z;
  r = ((r ^ (r >> 30n)) * 0xbf58476d1ce4e5b9n) & MASK64;
  r = ((r ^ (r >> 27n)) * 0x94d049bb133111ebn) & MASK64;
  return (r ^ (r >> 31n)) & MASK64;
}

// Mirrors @omega/engine-core Rng constructor: seed -> 4 state words via splitmix64.
function makeState(seed) {
  let z = BigInt(seed) & MASK64;
  const ref = { z };
  return {
    s0: splitmix64Next(ref),
    s1: splitmix64Next(ref),
    s2: splitmix64Next(ref),
    s3: splitmix64Next(ref),
  };
}

// Mirrors @omega/engine-core Rng.nextU64 (xoshiro256**).
function nextU64(s) {
  const result = (rotl((s.s1 * 5n) & MASK64, 7) * 9n) & MASK64;
  const t = (s.s1 << 17n) & MASK64;
  s.s2 ^= s.s0;
  s.s3 ^= s.s1;
  s.s1 ^= s.s2;
  s.s0 ^= s.s3;
  s.s2 ^= t;
  s.s3 = rotl(s.s3, 45);
  return result;
}

// Per-item RNG: identical seed-mix to the scheduler / inline / browser lanes.
function makeRngFor(seed, item) {
  const s = makeState((BigInt(seed) ^ (BigInt(item) * 0x9e3779b97f4a7c15n)) & MASK64);
  return {
    nextF64() {
      return Number(nextU64(s) >> 11n) / 9007199254740992;
    },
  };
}

// Rebuild the user reducer from source text (transport-safe across threads).
function buildReducer(src) {
  // eslint-disable-next-line no-new-func
  return new Function(`return (${src})`)();
}

function runLane(desc) {
  const reducer = buildReducer(desc.reducerSrc);
  const buffer = desc.buffer;
  const floatsPerItem = desc.blockSize / 8;

  const view = (item) => new Float64Array(buffer, item * desc.blockSize, floatsPerItem);
  const rngFor = (item) => makeRngFor(desc.seed, item);

  const ctx = {
    typeId: desc.typeId,
    typeName: desc.typeName,
    count: desc.count,
    seed: desc.seed,
    blockSize: desc.blockSize,
    buffer,
    view,
    rngFor,
  };

  // Shards are disjoint: each item writes only its own slot, so lane ordering
  // cannot affect the final buffer. This is the determinism guarantee.
  for (let item = desc.start; item < desc.end; item++) reducer(item, ctx);

  if (desc.barrier) {
    const b = new Int32Array(desc.barrier);
    Atomics.add(b, 0, 1);
    Atomics.notify(b, 0);
  }
  parentPort?.postMessage({ done: true });
}

if (!isMainThread && parentPort && workerData) {
  runLane(workerData);
}
