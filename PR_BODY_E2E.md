## Fix: browser-runtime bugs found by a real Playwright e2e pass

The headless unit suite was green, but a real-browser Playwright smoke test
(`playwright-smoke.cjs`) caught three bugs that never surfaced in Node:

### 1. CRITICAL — app crashed on load (blank page, no UI)
`@omega/job`'s index statically binds its Node `worker_threads` backend.
Importing it from `apps/web` made Vite externalize `worker_threads`, which
threw on load and crashed the whole demo before any UI rendered.

**Fix:** `eco-job.ts` no longer imports `@omega/job`. The three small shard
helpers (`partition` / `mergeResult` / the per-item reducer context) are
mirrored locally with **identical math**, so the determinism contract (shard
boundaries + per-item RNG) is preserved — without pulling `worker_threads`
into the browser bundle. The real inline==worker gate stays in `opt.test.ts`
under Node, where it is safe.

### 2. PBR terrain rendered black in captures
`gl.readPixels` / canvas screenshots came back empty because the backbuffer is
cleared after compositing. **Fix:** `preserveDrawingBuffer: true` on the
terrain WebGL2 context (also needed for build-in-public clips).

### 3. Share-world button hard-crashed
`navigator.clipboard.writeText` can reject (insecure context / no permission),
surfacing as an unhandled pageerror. **Fix:** swallow the rejection + show the
link in the status line instead.

### Verification (GATE PASS)
- `npx tsc -b` → 0
- `npx vitest run --config vitest.apps.config.ts` → 107 passed (14 files)
- `node apps/web/playwright-smoke.cjs` → 8/8 passed, 0 console errors, 0 page errors (real Chromium, swiftshader WebGL2)

### Destroy-Diff
Only `apps/web/` changed (194 insertions / 45 deletions). No `packages/*`
deleted or emptied.
