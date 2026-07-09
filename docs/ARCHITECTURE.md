# Architecture

PROJECT OMEGA is built around three non-negotiable principles drawn from the brief:

1. **Determinism from seed.** Every generated world and simulation is a pure function of
   a 64-bit seed plus discrete inputs. No wall-clock time, no unordered hash maps, no
   ambient randomness in simulation code.
2. **Composition over inheritance.** Game state lives in an Entity-Component-System;
   systems are plain functions/classes scheduled by a deterministic scheduler.
3. **Node-testable by default.** Subsystems that do not need a browser are written so
   they run and are tested under Node. Browser-only code (GL context) is isolated behind
   an interface and exercised by the demo app, not by faking it in tests.

## Layered dependency graph

```
engine-math  <-- engine-core <--+-- world-gen
                                |-- physics
                                |-- sim
render <-- (browser)            |-- save
apps/web <-- render + sim + world-gen + save
```

`engine-core` depends only on `engine-math`. `world-gen`, `physics`, `sim` depend on
`engine-core`. `render` is self-contained (only `engine-math`) and browser-optional.
`save` depends on `engine-core` for ECS snapshots. `apps/web` wires everything together.

## Key modules

### ECS (`@omega/engine-core`)
- `World` owns entity ids, component stores, and the system scheduler.
- `ComponentStore<C>` is a dense, typed column keyed by entity id; supports add/remove/get/query.
- Systems are registered with a `SystemStage` (PreUpdate, Update, PostUpdate, Render, Save)
  and a deterministic order. See `docs/adr/0002-ecs-design.md`.

### Determinism (`@omega/engine-core`)
- `splitmix64` for seed expansion, `xoshiro256**` for the runtime PRNG.
- `Hash` utilities for stable grid hashing. See `docs/adr/0001-determinism.md`.

### World generation (`@omega/world-gen`)
- Value/Perlin-style gradient noise with FBM, all seeded.
- Terrain -> biome -> planet -> star system -> galaxy -> universe, each deterministic.

### Simulation (`@omega/sim`)
- Fixed-timestep accumulator loop (default 60 Hz sim, decoupled render).
- Drives registered ECS systems; records ticks for replay/save.

## Patterns in force

- Monorepo with npm workspaces + TypeScript project references (composite build).
- Git Flow: `develop` is the integration branch; features branch from it.
- Conventional Commits; one logical change per commit.
- Vitest with a coverage floor enforced in CI.
- No TODO placeholders in committed code; if a real feature is deferred, it is an ADR +
  roadmap item, not a `// TODO`.
