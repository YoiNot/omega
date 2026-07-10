# Task: Render↔ECS bridge for PROJECT OMEGA (new @omega/render-ecs)

You are one of several autonomous engineers building PROJECT OMEGA, a deterministic
browser-game engine (npm-workspaces + TS project references monorepo). The repo is
checked out for you in an ISOLATED GIT WORKTREE — you are already inside it (cwd =
the worktree root). WORK RELATIVE TO CWD. NEVER use absolute paths like
/Users/yoi/omega/...; always use ./packages/render-ecs/... etc.

Create a NEW package `./packages/render-ecs`. This is an INTEGRATION package: it makes
the @omega/render `Renderer` consume an @omega/ecs `World` — queries over renderable
components produce draw calls, deterministically, tick after tick. It does NOT implement
a renderer; it composes @omega/render + @omega/ecs + @omega/engine-math.

## HARD PRE-PR GATE (you MUST satisfy ALL before the orchestrator opens the PR)
Run from the worktree root, ALL must succeed:
1. `npx tsc -b packages/render-ecs` -> exit 0
2. `npx tsc -b`                       -> exit 0  (whole repo stays clean)
3. `npx vitest run packages/render-ecs` -> ALL green, NO flags. Hangs/deadlocks under
   default parallelism are REAL BUGS — fix the root cause, never mask with a parallelism
   workaround.
4. Commits are SMALL, one concern each, precise Conventional Commit types.
If ANY gate fails: FIX IT. Do not push, do not claim done. Stop & report after >2 failed
attempts on a hang.

## Commit discipline (user wants SMALL commits)
- `feat(render-ecs): Renderable component + draw-list extraction`
- `feat(render-ecs): EcsRenderer consumes World each tick`
- `feat(render-ecs): camera + transform projection`
- `test(render-ecs): draw-list determinism + camera transform`
Each commit = one concern.

## Hard constraints
- Create ONLY files under ./packages/render-ecs/ and register in ROOT ./tsconfig.json
  `references` (add { "path": "./packages/render-ecs" }). Do NOT edit root package.json.
  Minimal root edits; do NOT touch other package sources.
- Deterministic: NO Math.random / Date.now in core logic. Entity iteration MUST be
  id-sorted (use world.query which already returns ascending-id order).
- ESM with `.js` relative imports. noUnusedLocals/Parameters = true.
- Real implementation, NO mocks for the bridge logic.

## Existing context — REAL exported APIs you must build against
- @omega/ecs `World` (packages/ecs): see physics-integration task. Key:
  `world.query(def).each((id, comp) => void)` (ascending id), `defineComponent<T>(name)`,
  `world.createEntity()`, `world.addComponent(id, def, value)`, `world.entities()`.
- @omega/render (packages/render):
    `createRenderer(canvas: CanvasLike | null, opts?: RendererOptions): Renderer`
      where RendererOptions = { gl?: GLLike; gpu?: GPUContextLike }.
    `interface Renderer` (from renderer-types.js) — the backend-agnostic draw surface.
    `Mesh`, `Color`, `Camera` (from mesh.js / color.js / camera.js), `CanvasLike`.
    NOTE: `createRenderer` is pure/Node-testable: in tests pass a fake `gl` (GLLike) so
    no real WebGL/WebGPU is needed. Inspect the Renderer interface in
    packages/render/src/renderer-types.ts to learn the exact draw method signatures
    (e.g. `draw(mesh, transform)` / `clear()` / `present()` — adapt to what actually
    exists; do NOT invent methods that are not there).
- @omega/engine-math: `Vec3`, `Mat4`/`Mat3` (whichever exists — check engine-math
  exports), `clamp`, `lerp`. Inspect packages/engine-math/src/index.ts for real names.

## What to implement (packages/render-ecs)
1. `src/components.ts` — `export const Renderable = defineComponent<RenderableData>(
   'Renderable')` where `RenderableData = { meshId: string; color: Color; visible?:
   boolean }`. Re-export `Mesh`/`Color`/`Camera` types from @omega/render as needed.
2. `src/drawlist.ts` — `extractDrawList(world): DrawItem[]`: query `Renderable`
   components, project each entity's transform (combine a `Transform` component if present
   — define `Transform = defineComponent<{ pos: Vec3; rot?: Vec3; scale?: Vec3 }>
   ('Transform')`) into view space using a supplied `Camera`, and return a deterministic
   list (ascending entity id, only `visible !== false`). `DrawItem = { entity: EntityId;
   meshId: string; color: Color; transform: Mat4 }`.
3. `src/ecs-renderer.ts` — `class EcsRenderer`:
   - ctor `new EcsRenderer(world, renderer: Renderer, camera: Camera)`.
   - `render()`: `renderer.clear()` -> build draw list via `extractDrawList` -> for each
     item `renderer.draw(mesh, transform, color)` (use the REAL Renderer signature) ->
     `renderer.present()`. Must be a pure function of (world state, camera) — same state
     => identical draw sequence.
   - `setCamera(cam)`.
4. `src/index.ts` re-exporting everything + types.
5. `package.json` (name @omega/render-ecs, type module, main ./src/index.ts, deps
   @omega/ecs @omega/render @omega/engine-math, build `tsc -b`) and `tsconfig.json`
   (extends ../../tsconfig.base.json, outDir ./dist, rootDir ./src, references
   ../ecs ../render ../engine-math, include src/**/*.ts).

## Tests (vitest)
- drawlist.test.ts: two runs over the same world produce byte-identical DrawItem
  sequences (id order); hidden (`visible:false`) entities are excluded; missing Transform
  defaults to identity.
- ecs-renderer.test.ts: feed a fake `GLLike` implementing the Renderer interface; assert
  render() issues clear -> draw*(n) -> present in deterministic order; identical world =>
  identical draw call sequence; moving the camera changes only projected transforms.
- camera.test.ts: a Transform + Camera produces the expected view-space matrix (use
  engine-math Mat4).
- index.test.ts: exports present.

## Verify before finishing (worktree root)
- npx tsc -b packages/render-ecs -> exit 0
- npx tsc -b -> whole repo clean
- npx vitest run packages/render-ecs -> ALL pass, NO flags
Report: files created, commit list (small!), test count, and explicitly:
"GATE: tsc exit0, vitest all-green no-flags".

## When done (PR)
Branch is already `feat/render-ecs`. After passing the gate, commit in SMALL units, push.
The orchestrator opens the PR automatically (re-runs gate, rebases onto latest main,
opens it). You do NOT run `gh pr create` yourself.
