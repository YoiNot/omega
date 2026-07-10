# Task: Physics↔ECS↔Sim integration layer for PROJECT OMEGA (new @omega/physics-integration)

You are one of several autonomous engineers building PROJECT OMEGA, a deterministic
browser-game engine (npm-workspaces + TS project references monorepo). The repo is
checked out for you in an ISOLATED GIT WORKTREE — you are already inside it (cwd =
the worktree root). WORK RELATIVE TO CWD. NEVER use absolute paths like
/Users/yoi/omega/...; always use ./packages/physics-integration/... etc.

Create a NEW package `./packages/physics-integration`. This is an INTEGRATION package:
it wires the existing @omega/physics, @omega/ecs, and @omega/sim packages into a single
deterministic, fixed-timestep physics step pipeline. It does NOT re-implement physics —
it composes what already exists.

## HARD PRE-PR GATE (you MUST satisfy ALL before the orchestrator opens the PR)
Run these from the worktree root and ALL must succeed:
1. `npx tsc -b packages/physics-integration` -> exit 0
2. `npx tsc -b`                              -> exit 0  (whole repo stays clean)
3. `npx vitest run packages/physics-integration` -> ALL green, NO flags. If it
   HANGS/DEADLOCKS under default parallelism, that is a REAL BUG — fix the root cause,
   do NOT mask it with --no-file-parallelism or any parallelism workaround.
4. Commits are SMALL (one logical unit each) with precise Conventional Commit types.
If ANY gate fails: FIX IT. Do not push, do not claim done. If stuck on a hang for >2
serious attempts, STOP and report the root cause — do NOT loop burning CPU.

## Commit discipline (user wants SMALL commits)
- `feat(physics-integration): deterministic PhysicsSimulation wrapper`
- `feat(physics-integration): body factory + ECS component binding`
- `feat(physics-integration): fixed-tick pipeline (sim.tick -> physics.step -> ecs sync)`
- `test(physics-integration): pipeline determinism + replay converge`
Each commit = one concern.

## Hard constraints
- Create ONLY files under ./packages/physics-integration/ and register it in ROOT
  ./tsconfig.json `references` (add { "path": "./packages/physics-integration" }).
  Do NOT edit root package.json (workspaces already globs packages/*). Minimal root
  edits; do NOT touch other package sources.
- Deterministic: NO Math.random / Date.now in core logic. Use @omega/engine-core `Rng`
  for any test data. Time/tick are PASSED IN as params.
- ESM with `.js` relative imports. noUnusedLocals/Parameters = true (a TS6133 fails build).
- Real implementation, NO mocks for core logic.

## Existing context — REAL exported APIs you must build against (do not invent)
- @omega/ecs `World` (packages/ecs):
    `new World()`, `world.createEntity() -> EntityId`,
    `world.addComponent(id, def, value)`, `world.getComponent(id, def)`,
    `world.hasComponent(id, def)`, `world.removeComponent(id, def)`,
    `world.query(...defs).each((id, ...comps) => void)` (ascending-id order),
    `world.registerSystem(fn: (world, dt, tick?) => void, priority?, name?)`,
    `world.tick(dt)`, `world.entityCount`, `world.entities()`, `world.tickCount`,
    `defineComponent<T>(name) -> ComponentDef<T>`.
- @omega/physics (packages/physics):
    `createBody(opts): RigidBody`, `PhysicsWorld` (ctor `new PhysicsWorld(opts)`,
    `.addBody(b)`, `.removeBody(id)`, `.step(dt)`), `PhysicsSystem` (ctor
    `new PhysicsSystem(world, opts)`, `.register()`, owns `.physics`),
    `PHYSICS_BODY_STORE = 'PhysicsBody'`, collision helpers
    `AabbBroadphase`, `detectSphereSphere`, `resolveSphereSphere`, `resolveSphereGround`.
    NOTE: PhysicsSystem already does ECS<->PhysicsWorld sync internally. Prefer composing
    it rather than duplicating its sync loop.
- @omega/sim `Simulation` (packages/sim):
    `new Simulation(world, opts?)` with `opts.fixedDt`, `opts.maxSteps`, `opts.recordLimit`;
    `.play()`, `.pause()`, `.isRunning`, `.advance(frameDt, input?) -> steps`,
    `.step(input?)`, `.history() -> SimTickRecord[]` (`{tick, input}`), `.reset()`,
    `.on(stage, order, name, fn)`, `.world`, `.scheduler`, `.fixedDt`, `.totalTicks`,
    `static Simulation.replay(builder, records, opts) -> Simulation`.
- @omega/engine-core: `Rng`, `EventBus`, `SystemStage` (use if needed), `Scheduler`.

## What to implement (packages/physics-integration)
1. `src/components.ts` — reuse `defineComponent` to declare integration-level components
   that bind physics bodies to the ECS, e.g.
   `export const PhysicsBody = defineComponent<RigidBody>('PhysicsBody')` (the same store
   name `PHYSICS_BODY_STORE` uses). Optionally a `Transform`/`Velocity` view component.
2. `src/factory.ts` — `createPhysicsEntity(world, bodyOpts)` that creates an entity,
   calls `createBody`, and `addComponent(world, PhysicsBody, body)`. Deterministic.
3. `src/pipeline.ts` — `class PhysicsSimulation`:
   - ctor `new PhysicsSimulation(world, opts?)` builds a `Simulation(world, opts)` and a
     `PhysicsSystem(world, physicsOpts)`, registers the physics system, returns the
     composed object.
   - exposes `.world`, `.sim`, `.physics` (the PhysicsSystem), `.play()/.pause()`,
     `.advance(frameDt, input?)`, `.step(input?)` (deterministic single step),
     `.tickCount`.
   - THE KEY DELIVERABLE: prove the pipeline is a deterministic function of
     (seed, initial state, input sequence). Two `PhysicsSimulation` instances fed the
     same scripted input sequence (e.g. via `.advance`/`.step` with a fixed `frameDt`)
     must yield byte-identical observable state (entity positions) after the same number
     of ticks. Document how you assert this in the test.
4. `src/replay.ts` — `function replayPhysics(records: SimTickRecord[], opts?)` that uses
   `Simulation.replay` with a builder that registers the physics system, so a recorded
   input sequence reproduces the same final state. Must converge to the same state as the
   live run (determinism guarantee).
5. `src/index.ts` re-exporting everything + types.
6. `package.json` (name @omega/physics-integration, type module, main ./src/index.ts,
   deps @omega/ecs @omega/physics @omega/sim @omega/engine-core, build `tsc -b`) and
   `tsconfig.json` (extends ../../tsconfig.base.json, outDir ./dist, rootDir ./src,
   references ../ecs ../physics ../sim ../engine-core, include src/**/*.ts).

## Tests (vitest)
- pipeline.test.ts: two identical runs (same input script) -> identical final entity
  positions; monotonic tick advance; pause() halts stepping.
- factory.test.ts: createPhysicsEntity yields a live entity with a PhysicsBody component
  whose id === entity id.
- replay.test.ts: a recorded run, replayed via Simulation.replay + physics registration,
  reproduces the live run's final positions exactly (determinism).
- determinism.test.ts: stepping with a seeded Rng for any randomized test data yields the
  same result across two runs.
- index.test.ts: exports present.

## Verify before finishing (worktree root)
- npx tsc -b packages/physics-integration -> exit 0
- npx tsc -b -> whole repo clean
- npx vitest run packages/physics-integration -> ALL pass, NO flags
Report: files created, commit list (small!), test count, and explicitly:
"GATE: tsc exit0, vitest all-green no-flags".

## When done (PR)
Branch is already `feat/physics-integration`. After passing the gate, commit in SMALL
units, push. The orchestrator opens the PR automatically (it re-runs the gate, rebases
onto latest main, and opens it). You do NOT run `gh pr create` yourself.
