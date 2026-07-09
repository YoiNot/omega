# @omega/engine-core

The deterministic engine core: seeded PRNG, ECS, scheduler, and event bus.

## Determinism (`rng.ts`)
`Rng` — splitmix64 seed expansion + xoshiro256** sequence generator operating on full
64-bit BigInt state (identical results across platforms). `hashString64` for FNV-1a hashing.
Methods: `nextU64`, `nextF64`, `nextRange`, `nextInt`, `bool`, `pick`, `shuffle`,
`state`/`setState` (bit-exact checkpoint + resume).

## ECS (`ecs.ts`)
- `World` — entity allocation (id reuse via free-list), component stores, system scheduler.
- `ComponentStore<C>` — dense column keyed by entity id; ascending-id iteration.
- `query(...names)` — entities having ALL named components.
- `registerSystem(stage, order, name, fn)` — `SystemStage` ordering (PreUpdate/Update/
  PostUpdate/Render/Save), then explicit `order`.
- `step(dt)` advances all systems one tick; `tick` counter increments.

## Scheduler (`scheduler.ts`)
`Scheduler` — fixed-timestep accumulator decoupling sim rate from render rate; spiral-of-
death guard (`maxSteps` + frame clamp). `alpha` exposes render interpolation fraction.

## Event bus (`events.ts`)
`EventBus<Events>` — type-safe `on`/`off`/`emit`, synchronous, deterministic per-type FIFO.

## Tests
`src/rng.test.ts` (8), `src/ecs.test.ts` (8), `src/scheduler.test.ts` (8) — 24 tests.
Run `npx vitest run packages/engine-core`.

## ADRs
- [0001 Determinism from seed](../docs/adr/0001-determinism.md)
- [0002 ECS design](../docs/adr/0002-ecs-design.md)
- [0003 Repository structure and process](../docs/adr/0003-repository-and-process.md)
