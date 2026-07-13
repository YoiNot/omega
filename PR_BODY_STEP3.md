## Phase B Step 3 — Multiplayer-lite: Same-Seed + Replay-Sharing (Roadmap §18, $0)

Ships the $0 multiplayer-lite path: two clients reproduce the exact same deterministic world/sim by sharing a seed (or a replay file) — no server, no hosting cost. This is the build-in-public reach lever: "send a link, your friend sees the same world."

### Changes (all in `apps/web/`, no package touched)
- **share.ts** (§18 $0): pure serialization layer. `buildSharePayload` captures the deterministic recording (base64) + seed; `payloadToJson`/`jsonToPayload` round-trip it; `shareLink` embeds the seed in the URL (the $0 world-share path); `seedFromUrl` reads it back. Portable base64 (browser `btoa` + Node `Buffer` fallback) so it runs in tests.
- **main.tsx**: "Share world" copies a `?seed=` link (same seed ⇒ same world on any client, $0, no server); "Export replay" downloads seed + recording as JSON; "Load replay" rebuilds the world from a shared JSON on another client; initial seed reads `?seed=` from the URL when present.
- **mp.test.ts**: prove two fresh demos with the same seed yield byte-identical procgen + sim + AI stack (no server); share payload round-trips (JSON ⇄ recording bytes); world-only payload reconstructs to null.

### Verification (GATE PASS)
- `npx tsc -b apps/web` → 0
- `npx tsc -b` (whole repo) → 0
- `npx vitest run --config vitest.apps.config.ts` → 107 passed (14 files), mp 5/5

### Destroy-Diff
Only `apps/web/` changed (261 insertions / 1 deletion). No `packages/*` deleted or emptied.
