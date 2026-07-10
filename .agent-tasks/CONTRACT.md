# PROJECT OMEGA — Autonomous Agent Contract

You are an autonomous engineer building PROJECT OMEGA (a deterministic browser-game
engine: an npm-workspaces TypeScript monorepo). You run INSIDE an isolated git
worktree. The orchestrator injects this contract into every task. Follow it exactly.

## 1. Worktree & paths (isolation — this is how we parallelize safely)
- You are already `cd`'d into the worktree. Work RELATIVE to the current directory.
- NEVER use absolute paths like `/Users/yoi/omega/...`. Use `./packages/<x>/...`.
- Touch ONLY your own package directory. For ROOT registration: you ONLY ever add one
  line `{ "path": "./packages/<x>" }` to the `references` array in `tsconfig.json`
  (TS project references require this). You do NOT need to touch `package.json` at all
  — its `workspaces` already uses `packages/*`, which globs every package. Never edit
  other packages or other root files.

## 2. Determinism (hard rule)
- NO `Math.random`, NO `Date.now()` in engine logic. Use `@omega/engine-core` `Rng`
  for any needed randomness (tests / data generation only).
- Time, tick, and frame numbers are PASSED IN as parameters — never read from a clock.

## 3. Code style
- ESM with `.js` relative imports (`import { x } from './y.js'`).
- `noUnusedLocals` / `noUnusedParameters` = true → no unused imports or variables
  (a TS6133 fails the build).
- Real implementations. NO mocks for core logic.

## 4. Commits (small + conventional)
Commit OFTEN — one logical unit per commit — with a precise Conventional-Commit type:
`feat(<pkg>): ...`, `fix(<pkg>): ...`, `refactor(<pkg>): ...`, `test(<pkg>): ...`,
`perf(<pkg>): ...`, `build(<pkg>): ...`. Each commit = one concern.

## 5. PRE-PR GATE (mandatory — never open or hand off a red PR)
Before the orchestrator opens a PR, ALL must pass (run from the worktree root):
- `npx tsc -b packages/<your-pkg>`  -> exit 0
- `npx tsc -b`                      -> exit 0  (whole repo stays clean)
- `npx vitest run packages/<your-pkg>` -> ALL green, NO flags
  - If the suite HANGS or DEADLOCKS under default parallelism, that is a REAL BUG.
    Find and fix the root cause. Do NOT mask it with `--no-file-parallelism` or any
    parallelism workaround. (The usual cause is a cross-file shared state-key
    collision or a mutable module-level object one test mutates and another reads,
    making a search/loop unbounded.)
If ANY gate fails: FIX IT. Do not report done, do not assume the harness will save you.

## 6. Stuck? Stop & report
If you cannot pass the gate after 2 serious attempts (especially a hang you cannot
root-cause), STOP. Write the root cause + what you tried to the log and report. Do NOT
loop forever burning CPU — an unbounded test loop is a bug, not progress.

## 7. When done
The branch is already `feat/<slug>`. After the gate passes, commit in small units and
push. The orchestrator opens the PR automatically (it re-runs the gate, rebases onto
latest `main`, and opens it). You do not need to run `gh pr create` yourself.
