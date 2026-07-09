# ADR 0002: ECS design

## Status
Accepted (2026-07-09)

## Context
Need a data-oriented, cache-friendly, testable entity model that scales from a handful of
entities in tests to (eventually) large worlds, without a commercial engine dependency.

## Decision
- Archetype-free **structure-of-arrays** ECS: each component type is a dense
  `ComponentStore<C>` mapping `EntityId -> C` (plain object/array).
- `World` owns entity id allocation (monotonic counter), free-list reuse, component stores,
  and the system scheduler.
- Systems are plain functions/classes registered to a `SystemStage` with an explicit order.
- Queries return typed views over entities that have a required component set; iteration is
  ascending-id and therefore deterministic.
- No inheritance in component types; behavior lives in systems, not entities.

## Consequences
- Easy to test: construct a `World`, add components, run a system, assert state.
- Parallelization (future job system) is tractable because stores are columnar and systems
  can be scheduled with dependency metadata.
- Slightly more boilerplate than an OOP entity; accepted.
