# Roadmap

Milestones are ordered per the brief's development order. Items marked [DONE] are
implemented and tested in this foundation. Items marked [NEXT] are the immediate next
engineering increments.

## 1. Vision — [DONE]
- README, VISION, ARCHITECTURE.

## 2. Requirements — [DONE]
- Deterministic seed contract; layered package boundaries; test + coverage floor.

## 3. Architecture — [DONE]
- Monorepo, TS project references, Git Flow, ECS/scheduler/event design (ADRs 0001–0003).

## 4. Engine — [PARTIAL]
- [DONE] math, PRNG, ECS, scheduler, event bus.
- [NEXT] job system (parallel ECS via Web Workers + SharedArrayBuffer), memory pools,
  reflection/type registry, resource manager, asset database, streaming, hot reload.

## 5. Tooling — [PARTIAL]
- [DONE] vitest, tsc build, CI matrix.
- [NEXT] benchmarking dashboards, fuzz harness, profiler hooks.

## 6. CI/CD — [DONE]
- GitHub Actions: typecheck + test + coverage gate.

## 7. Testing infra — [DONE]
- Vitest suite with coverage thresholds; deterministic-seed test helpers.

## 8. Rendering — [PARTIAL]
- [DONE] heightfield mesh builder + command encoding (Node-tested); WebGL2 clear+draw.
- [NEXT] WebGPU backend, PBR, cascaded shadows, volumetric clouds, GPU particles, LOD.

## 9. Networking — [NEXT]
- Server-authoritative loop, delta compression, interest management, rollback.

## 10. Save system — [PARTIAL]
- [DONE] versioned binary serializer with migration.
- [NEXT] incremental snapshots, replay recording/playback, cloud sync, recovery.

## 11. Physics — [PARTIAL]
- [DONE] semi-implicit rigid bodies, AABB broadphase, sphere/sphere + sphere/ground.
- [NEXT] soft bodies, constraints (rope/cloth), fluids, fracture, orbital mechanics.

## 12. Procedural generation — [PARTIAL]
- [DONE] noise/FBM, terrain+biome grid, planet, star system, galaxy, universe catalog.
- [NEXT] plate tectonics, erosion/sedimentation, hydrology, weather, climate, seasons.

## 13. Simulation — [PARTIAL]
- [DONE] fixed-timestep loop driving ECS systems; tick recording.
- [NEXT] temperature/humidity/pressure fields, fire spread, ecosystems, economy, trade.

## 14. AI — [NEXT]
- Autonomous agents: memory, goals, GOAP, personality, relationships, learning.

## 15. Gameplay — [NEXT]
- Player controller, interaction, crafting, construction.

## 16–20. Multiplayer / Editors / Modding / Optimization / Polish — [FUTURE]
- Listed for traceability; each is a major workstream begun after its dependencies land.

Every future item, when started, opens its own `feature/*` branch and an ADR.
