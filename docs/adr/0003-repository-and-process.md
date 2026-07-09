# ADR 0003: Repository structure and process

## Status
Accepted (2026-07-09)

## Context
The brief mandates Git Flow, Conventional Commits, one logical change per commit, and
feature branches. An unbounded project needs a structure that does not rot.

## Decision
- npm workspaces monorepo; each package is independently buildable (TS composite).
- `main` is protected; `develop` is the integration branch. Features branch `feature/*`.
- Every commit message follows Conventional Commits (`feat(scope): ...`, `fix(scope): ...`,
  `perf`, `refactor`, `docs`, `test`, `build`, `ci`, `chore`, `style`).
- No TODO placeholders committed; deferred work is an ADR + roadmap item.
- Coverage floor enforced in CI (lines/functions/statements >= 60 at foundation; target 95).

## Consequences
- Traceable history; clean bisect; reviewable PRs.
- Slower than dumping everything in main — accepted as required discipline.
