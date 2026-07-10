# Roadmap

Milestones are ordered per the brief's development order. Items marked [DONE] are
implemented and tested in this foundation. Items marked [NEXT] are the immediate next
engineering increments.

> **Note on drift:** this roadmap predates the integration/adapter layer that now exists
> in `main`. Sections below are updated to reflect what is *actually* merged (see git
> history PR #24–#39). Entries added beyond the original brief are tagged `[ADDED]`.

## 1. Vision — [DONE]
- README, VISION, ARCHITECTURE.

## 2. Requirements — [DONE]
- Deterministic seed contract; layered package boundaries; test + coverage floor.

## 3. Architecture — [DONE]
- Monorepo, TS project references, Git Flow, ECS/scheduler/event design (ADRs 0001–0003).

## 4. Engine — [PARTIAL]
- [DONE] math, PRNG, ECS, scheduler, event bus.
- [ADDED][DONE] `@omega/time-core` — deterministic fixed-timestep scheduler (drives all demos).
- [ADDED][DONE] `@omega/input-core` — frame-stable, replay-safe input snapshots.
- [NEXT] job system (parallel ECS via Web Workers + SharedArrayBuffer), memory pools,
  reflection/type registry, resource manager, asset database, streaming, hot reload.

## 5. Tooling — [PARTIAL]
- [DONE] vitest, tsc build, CI matrix.
- [NEXT] benchmarking dashboards, fuzz harness, profiler hooks.

## 6. CI/CD — [DONE]
- GitHub Actions: typecheck + test + coverage gate.

## 7. Testing infra — [DONE]
- Vitest suite with coverage thresholds; deterministic-seed test helpers.

## 8. Rendering — [DONE]
- [DONE] heightfield mesh builder + command encoding (Node-tested); WebGL2 clear+draw.
- [ADDED][DONE] `@omega/render-pbr` — PBR (Cook-Torrance GGX), cascaded shadow maps,
  GPU particles (ParticleSystem), volumetric clouds (CloudField/raymarch), distance LOD
  dispatch over the existing WebGPU path (PR #39).
- [NEXT] PBR shader wired into the browser TerrainRenderer GLSL (legacy gradient path
  still used by the demo), additional cloud cascades, further LOD tiers.

## 9. Networking — [PARTIAL]
- [ADDED][DONE] `@omega/net-replication` — ECS snapshot replication over a server-authoritative
  loopback transport (PR #26).
- [NEXT] delta compression, interest management, rollback, real transport (WebSocket/WebRTC).

## 10. Save system — [PARTIAL]
- [DONE] versioned binary serializer with migration.
- [ADDED][DONE] `@omega/replay` — record/playback over `@omega/save` + `@omega/net` codec
  (PR #28); wired into apps/web as a Replay UI (record/save/load/play, PR #37).
- [NEXT] incremental snapshots, cloud sync, recovery.

## 11. Physics — [PARTIAL]
- [DONE] semi-implicit rigid bodies, AABB broadphase, sphere/sphere + sphere/ground.
- [ADDED][DONE] `@omega/physics-integration` — deterministic ECS↔physics↔sim pipeline (PR #24).
- [NEXT] soft bodies, constraints (rope/cloth), fluids, fracture, orbital mechanics.

## 12. Procedural generation — [PARTIAL]
- [DONE] noise/FBM, terrain+biome grid, planet, star system, galaxy, universe catalog.
- [NEXT] plate tectonics, erosion/sedimentation, hydrology, weather, climate, seasons.

## 13. Simulation — [PARTIAL]
- [DONE] fixed-timestep loop driving ECS systems; tick recording.
- [ADDED][DONE] apps/web seed-able, deterministic gameplay scenario with entity types
  (resource / dynamic blocker / wanderer), biome/terrain cost rules, emergent behaviour
  (PR #38).
- [NEXT] temperature/humidity/pressure fields, fire spread, ecosystems, economy, trade.

## 14. AI — [PARTIAL]
- [ADDED][DONE] `@omega/ai-goap` — deterministic GOAP planner (WorldState/Action/Goal/Plan),
  wired into apps/web demo agents (plan + navigate, PR #34, PR #37).
- [NEXT] memory, goals, personality, relationships, learning.

## 15. Gameplay — [PARTIAL]
- [ADDED][DONE] apps/web Vertical Slice (PR #37): ai-goap + nav-core + replay + modding
  wired into a playable, deterministic demo; gameplay content (PR #38).
- [NEXT] player controller, interaction, crafting, construction.

## 16. Multimedia — [ADDED][PARTIAL]
- [ADDED][DONE] `@omega/audio-spatial` — deterministic 3D audio params (gain/pan/distance),
  decoupled from WebAudio playback (PR #31).
- [NEXT] WebAudio playback layer, spatial mixdown, audio assets.

## 17. Modding — [ADDED][PARTIAL]
- [ADDED][DONE] `@omega/modding` — deterministic rule/content patches (ModManifest, applyMod,
  load/save, PR #32); ModdingPanel UI in apps/web (PR #36).
- [NEXT] manifest validation UI, content marketplace, sandboxing.

## 18–22. Multiplayer / Editors / Optimization / Polish / Vertical Slices — [FUTURE]
- Listed for traceability; each is a major workstream begun after its dependencies land.
- Current vertical slice: `apps/web` (deterministic, playable: physics + render + net +
  input + time + replay + modding + ai-goap + nav-core + audio-spatial + PBR/particles/LOD).

Every future item, when started, opens its own `feature/*` branch and an ADR.
