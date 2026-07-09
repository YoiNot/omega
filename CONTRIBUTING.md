# Contributing to PROJECT OMEGA

This repository follows the process mandated by the brief. Read this before opening a
pull request.

## Branch strategy (Git Flow)

- `main` — protected, production. Never commit directly.
- `develop` — integration branch. Most work lands here via PR.
- `feature/<short-slug>` — one logical feature per branch.
- `release/<version>`, `hotfix/<slug>`, `experiment/<slug>` — as needed.

Never work on `main` or `develop` directly.

## Commits — Conventional Commits, exactly

```
feat(scope): short summary
fix(scope): short summary
perf(scope): short summary
refactor(scope): short summary
docs(scope): short summary
test(scope): short summary
build(scope): short summary
ci(scope): short summary
chore(scope): short summary
style(scope): short summary
```

Rules:
- One logical change per commit. Do not mix unrelated changes.
- Scope is the package/subsystem (renderer, world, ai, network, save, ui, …).
- Imperative mood ("implement", not "implemented").
- No `Co-Authored-By` lines on commits.

## Pull requests

Every PR must include: Summary, Architecture notes, Performance impact, Security review,
Backward compatibility, Migration notes, Benchmarks, Updated docs, and confirm CI + tests
are green. Use the template in `.github/PULL_REQUEST_TEMPLATE.md` (to be added).

## Testing

- Vitest. `npm test` runs the whole suite. `npx vitest run packages/<pkg>` scopes it.
- No mocking of real logic. Browser-only code is isolated behind interfaces and tested via
  fakes/test-doubles for the encoding path only.
- Coverage floor is enforced in CI (currently 60%; target 95% as the project matures).
- Fuzz/property tests live next to unit tests (`*.test.ts`).

## Determinism contract

Every generated world and simulation MUST be a pure function of its seed plus its input
sequence. See `docs/adr/0001-determinism.md`. Never introduce ambient randomness
(`Math.random`, `Date.now`) into generation or simulation code.

## No TODO placeholders

Committed code must be complete. If a real feature is deferred, record it as an ADR +
roadmap item instead of a `// TODO`.

## Architecture

Layered, dependency-injected, ECS-based. See `docs/ARCHITECTURE.md` and the per-package
API docs under each `packages/*/README.md`.
