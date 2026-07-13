## Phase B Step 2 — Optimization (Roadmap §20)

Makes the Colony-Sim tractable on weak HW and proves the engine's parallel path is deterministic.

### Changes (all in `apps/web/`, no package touched)
- **eco-job.ts** (§20): drive the §13 sim-eco Lotka–Volterra integration through `@omega/job`'s deterministic sharding. Owns the result buffer (packed v/h/c/temp/hum/dt), drives it with `partition` + `makeContext` so the per-cell step is order-independent. `jobSystemDeterministic()` gates the package's inline==worker byte-identical guarantee.
- **engine.ts**: wire the sharded eco step as a per-frame parity check against the engine-core serial tick (same reducer/formula, no change to the authoritative sim). Add `buildCoarseMesh()` for LOD tiers.
- **renderer.ts** (§20): replace the single VAO with a 3-level LOD chain (fine/coarse/coarsest). `setLodMeshes()` rebuilds it, `setLodLevel()` swaps the active VAO per frame — distant orbit views draw fewer vertices (the real weak-HW win).
- **main.tsx**: build + drive the LOD chain from camera distance; Colony HUD shows the sharded eco lane count.
- **opt.test.ts**: prove job order-independence, sharded eco == serial formula, and deterministic LOD meshes.

### Verification (GATE PASS)
- `npx tsc -b apps/web` → 0
- `npx tsc -b` (whole repo) → 0
- `npx vitest run --config vitest.apps.config.ts` → 102 passed (13 files), opt 4/4

### Destroy-Diff
Only `apps/web/` changed (384 insertions / 11 deletions). No `packages/*` deleted or emptied.
