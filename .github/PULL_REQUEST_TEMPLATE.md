<!--
PRs must satisfy every checklist item before merge. The brief mandates: Summary,
Architecture notes, Performance impact, Security review, Backward compatibility,
Migration notes, Benchmarks, Updated documentation, Passing CI, Passing tests,
Reviewer checklist.
-->

## Summary
<!-- What changed and why. One logical change per PR. -->

## Architecture notes
<!-- How it fits the layered engine design (docs/ARCHITECTURE.md). -->

## Performance impact
<!-- hz/ms before/after if relevant; reference docs/benchmarks. -->

## Security review
<!-- Especially for save/network/migration surfaces. -->

## Backward compatibility
<!-- Will existing saves/worlds still load? -->

## Migration notes
<!-- If a save version changed, list the migration. -->

## Benchmarks
<!-- Link to `npm run bench` output or the baseline table. -->

## Documentation
<!-- Confirmed ADRs / API docs / README updated. -->

## CI / Tests
- [ ] `npm run typecheck` passes
- [ ] `npm test` passes
- [ ] Coverage floor met

## Reviewer checklist
- [ ] No TODO placeholders committed
- [ ] Deterministic from seed (ADR 0001)
- [ ] Conventional Commits message
