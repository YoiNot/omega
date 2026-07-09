# ADR 0001: Determinism from seed

## Status
Accepted (2026-07-09)

## Context
The brief requires every generated world and simulation to be deterministic from seed.
Non-determinism sources: wall-clock time, unordered `Map` iteration, ambient `Math.random`,
object-property enumeration order, float nondeterminism across platforms.

## Decision
- All randomness flows through a single seeded PRNG (`xoshiro256**` seeded via `splitmix64`).
- Noise/generation take an explicit `Rng` instance; no module-level mutable RNG.
- Entities are iterated by ascending id; component stores use arrays indexed by id.
- Sim uses a fixed-timestep accumulator; render interpolation is purely cosmetic.
- Float math is IEEE-754 double (JS default); cross-platform determinism is assumed at the
  double level (true for all modern engines). WASM fast-math is forbidden for sim code.

## Consequences
- Equal seed + equal input sequence => bit-identical worlds. Enables replay, save/load,
  and server-authoritative networking later.
- Slightly more verbose code (explicit Rng passing) — accepted as the price of correctness.
