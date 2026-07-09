/**
 * @omega/procgen — deterministic RNG access.
 *
 * This package does NOT reimplement a PRNG. It re-exports the shared,
 * bit-stable {@link Rng} from @omega/engine-core (splitmix64 seed expansion +
 * xoshiro256**) so every consumer agrees on the exact same stream — a
 * prerequisite for seed-driven reproducibility across the engine.
 */

export { Rng, hashString64 } from '@omega/engine-core';

import { Rng } from '@omega/engine-core';

/**
 * Convenience constructor. Accepts the same seed vocabulary as {@link Rng}
 * (number | bigint | string) and returns a fresh, seeded generator.
 */
export function makeRng(seed: number | bigint | string = 0): Rng {
  return new Rng(seed);
}
