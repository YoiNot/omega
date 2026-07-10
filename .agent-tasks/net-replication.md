# Task: ECS snapshot replication over @omega/net (new @omega/net-replication)

You are one of several autonomous engineers building PROJECT OMEGA, a deterministic
browser-game engine (npm-workspaces + TS project references monorepo). The repo is
checked out for you in an ISOLATED GIT WORKTREE — you are already inside it (cwd =
the worktree root). WORK RELATIVE TO CWD. NEVER use absolute paths like
/Users/yoi/omega/...; always use ./packages/net-replication/... etc.

Create a NEW package `./packages/net-replication`. This is an INTEGRATION package: it
replicates an @omega/ecs `World` over the @omega/net server-authoritative layer, by
serializing the ECS state into the `WorldSnapshot` the net layer already consumes, and
reconciling remote snapshots back onto a client World. It does NOT re-implement transport,
commands, or reconciliation — it adapts @omega/ecs + @omega/sim for @omega/net.

## HARD PRE-PR GATE (you MUST satisfy ALL before the orchestrator opens the PR)
Run from the worktree root, ALL must succeed:
1. `npx tsc -b packages/net-replication` -> exit 0
2. `npx tsc -b`                          -> exit 0  (whole repo stays clean)
3. `npx vitest run packages/net-replication` -> ALL green, NO flags. Hangs/deadlocks
   under default parallelism are REAL BUGS — fix the root cause, never mask with a
   parallelism workaround.
4. Commits are SMALL, one concern each, precise Conventional Commit types.
If ANY gate fails: FIX IT. Do not push, do not claim done. Stop & report after >2 failed
attempts on a hang.

## Commit discipline (user wants SMALL commits)
- `feat(net-replication): ECS <-> WorldSnapshot (de)serialization`
- `feat(net-replication): authoritative server tick driven by net layer`
- `feat(net-replication): client prediction + snapshot reconciliation`
- `test(net-replication): server/client converge + replay determinism`
Each commit = one concern.

## Hard constraints
- Create ONLY files under ./packages/net-replication/ and register in ROOT
  ./tsconfig.json `references` (add { "path": "./packages/net-replication" }). Do NOT
  edit root package.json. Minimal root edits; do NOT touch other package sources.
- Deterministic: NO Math.random / Date.now in core logic. Use @omega/engine-core `Rng`
  for any test data. Ticks are PASSED IN.
- ESM with `.js` relative imports. noUnusedLocals/Parameters = true.
- Real implementation, NO mocks for the replication logic.

## Existing context — REAL exported APIs you must build against
- @omega/ecs `World` (packages/ecs): `world.createEntity()`, `world.addComponent(id, def,
  value)`, `world.getComponent(id, def)`, `world.hasComponent(id, def)`,
  `world.query(...defs)`, `world.entities()`, `world.entityCount`, `world.tick(dt)`,
  `world.registerSystem(fn, priority?, name?)`, `defineComponent<T>(name)`,
  `ComponentDef`, `EntityId`.
- @omega/net (packages/net):
    `WorldSnapshot = { tick: number; data: Uint8Array }` (from snapshot.js),
    `ServerAuthoritativeSim` (from reconcile.js): ctor
    `new ServerAuthoritativeSim(stepFn, initialSnapshot, opts?)`;
    SERVER: `.receiveCommand(cmd)`, `.step() -> WorldSnapshot` (advances authoritative
    tick, applies the command for `serverTick`);
    CLIENT: `.queueCommand(payload: Uint8Array) -> InputCommand`,
    `.applySnapshot(s: WorldSnapshot) -> WorldSnapshot` (reconciles predicted state by
    replaying in-flight commands via an optional `seed` hook), `.getState()`,
    `.getAuthoritative()`, `.currentTick`, `.pendingCommands()`.
    `InputCommand = { tick: number; seq: number; payload: Uint8Array }` (commands.js).
    `LoopbackTransport` (transport.js) for Node-testable in-process messaging.
    `SnapshotBuffer`, `interpolate(a, b, alpha)`, `encodeSnapshot`/`decodeSnapshot`
    (snapshot.js).
- @omega/engine-core: `Rng`.
- OPTIONAL: @omega/sim `Simulation` if you want to drive the server step function from a
  registered ECS system (mirrors the physics-integration pattern). Keep coupling light.

## What to implement (packages/net-replication)
1. `src/codec.ts` — `serializeWorld(world): Uint8Array` and `deserializeWorld(bytes, world)`
   that faithfully (de)serialize the full ECS state: every live entity + every attached
   component value (you may restrict the component set to the ones you register for
   replication, but the codec must be deterministic and lossless for those). Provide a
   `registerComponent(def)` allow-list so only replicated components cross the wire.
   Prefer a simple length-prefixed binary writer (reuse the pattern from net's snapshot
   encoder) — do NOT pull in @omega/save unless it simplifies things.
   `worldToSnapshot(world, tick): WorldSnapshot` / `snapshotToWorld(s, world): void`.
2. `src/server.ts` — `class ReplicatedServer`:
   - ctor `new ReplicatedServer(world, opts?)`, builds a `ServerAuthoritativeSim` whose
     `stepFn(cmd, dt)` applies the incoming command payload to the world (e.g. a movement
     intent) via a registered system, steps the world, and returns
     `worldToSnapshot(world, newTick)`.
   - `onCommand(cmd)` -> `.receiveCommand(cmd)`; `tick()` -> `.step()` returns the
     authoritative snapshot to broadcast.
3. `src/client.ts` — `class ReplicatedClient`:
   - ctor `new ReplicatedClient(world, opts?)` builds a `ServerAuthoritativeSim` with a
     `seed` hook that `snapshotToWorld`s the authoritative base back onto the local world
     before replaying in-flight commands (so prediction converges to the server view).
   - `sendIntent(payload) -> InputCommand` (queues + locally predicts),
     `onSnapshot(s)` -> `.applySnapshot(s)` (reconcile), `state() -> WorldSnapshot`.
4. `src/index.ts` re-exporting everything + types.
5. `package.json` (name @omega/net-replication, type module, main ./src/index.ts, deps
   @omega/ecs @omega/net @omega/engine-core, optional @omega/sim, build `tsc -b`) and
   `tsconfig.json` (extends ../../tsconfig.base.json, outDir ./dist, rootDir ./src,
   references ../ecs ../net ../engine-core [../sim], include src/**/*.ts).

## Tests (vitest)
- codec.test.ts: round-trip a world through serialize->deserialize is lossless for the
  registered components; deterministic (same world -> same bytes).
- server.test.ts: server applies a command on the correct tick and returns a snapshot
  reflecting it; tick advances monotonically.
- client.test.ts: client predicts locally, then on `applySnapshot` reconciles to the
  server's authoritative state (converges). Two clients with the same input script + same
  server snapshots end identically.
- convergence.test.ts: a scripted server+client over LoopbackTransport, after N ticks,
  client's world equals server's world (modulo interpolation buffer) — determinism proof.
- index.test.ts: exports present.

## Verify before finishing (worktree root)
- npx tsc -b packages/net-replication -> exit 0
- npx tsc -b -> whole repo clean
- npx vitest run packages/net-replication -> ALL pass, NO flags
Report: files created, commit list (small!), test count, and explicitly:
"GATE: tsc exit0, vitest all-green no-flags".

## When done (PR)
Branch is already `feat/net-replication`. After passing the gate, commit in SMALL units,
push. The orchestrator opens the PR automatically (re-runs gate, rebases onto latest main,
opens it). You do NOT run `gh pr create` yourself.
