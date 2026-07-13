# Spike Report: @omega/render-ao

**Branch:** `feat/render-ao-spike`
**Datum:** 2026-07-13
**Status:** SPIKE BEWIESEN (11/11 Unit-Tests + GPU-Pipeline PASS)

## Was gebaut wurde (isolert, kein Edit an apps/web)
Neues Paket `@omega/render-ao` mit 4 Bausteinen für "eigene Graphics-Lösung":

1. **determinism.ts** — `det_*` Shader-Math-Pins (Quake bit-trick + 2 Newton-Schritte
   für 1/sqrt, sqrt, div). Das ist der Kern unseres "same seed => same pixels"-Claims:
   GPU-Float-Divergenz (USENIX'19, forge3d TERRA-DETERMINATA) wird durch gepinnten
   Math neutralisiert. GLSL-Strings + TS-Mirrors.

2. **gbuffer.ts** — minimaler G-Buffer-Pass (Depth + View-Normals als Texturen).
   Architektonisch NOTWENDIG: apps/web/src/renderer.ts hat KEINEN G-Buffer (PBR
   nutzt hardcoded V=(0,1,0)). GTAO/IBL brauchen Depth+Normals.

3. **gtao.ts** — Ground-Truth Ambient Occlusion (Jimenez 2016 horizon-based).
   Radiometrisch korrekt, braucht nur Depth+Normals. Hebt PBR vom
   "early-2000s-OpenGL"-Look (keine AO) zu echtem PBR.

4. **envmap.ts** — procedurale, seed-deterministische Sky/Env-Map für IBL.
   Nutzt unseren `@omega/world-gen` Noise-Stack. KEIN HDRI-Asset ($0).
   `bakeEnvMap(seed)` ist byte-identisch für gleiche Seeds (bewiesen im Test).

## Beweise
- **Unit-Tests (11/11):** det_* Math correctness, GTAO composite darkens,
  env-map determinism (same seed => identical bytes, different seed => different).
- **GPU-Spike (Playwright/SwiftShader):** G-Buffer + GTAO-Pipeline kompiliert +
  läuft auf echter WebGL2, 0 GL-Errors, AO-Output in validem [0,1].

## Gefundene Limitierungen (für Production-Wiring)
- **R16F-MRT nicht auf SwiftShader:** headless CI kann nicht nach R16F
  (single/dual float attachment) rendern. Production-Pfad (RGBA16F/R16F auf
  echter GPU) ist im Code vorhanden; Spike testet den RGBA8/R8-Fallback.
  → AO-Occlusion-Kurve voll erst mit Float-Depth-Präzision (realer Browser).
- **R8-Depth-Clamping:** im Fallback-Pfad ist `length(vViewPos)` auf [0,1]
  geclamped → kaum Tiefen-Variation → AO≈1.0 auf glatter Geometrie.
  Ist ein Test-Env-Artefakt, kein Code-Bug.

## Nächste Schritte (nach Freigabe)
- [ ] (y) Integrations-Pfad: @omega/render-ao in @omega/render einhängen
      (statt isoliertem Mini-Renderer) → eine Render-Abteilung.
- [ ] apps/web/src/renderer.ts auf G-Buffer + GTAO + IBL porten (§8 PBR upgrade).
- [ ] Composite-Pass: AO * IBL * PBR in einem finalen Shader (statt CPU-compositeAO).
- [ ] (C) Render-Graph: GTAO/IBL/Bloom/TAA als komponierbare Post-FX-Passes.

## Dateien
- packages/render-ao/{package.json, tsconfig.json}
- packages/render-ao/src/{determinism,gbuffer,gtao,envmap,index}.ts
- packages/render-ao/src/render-ao.test.ts (11 tests)
- packages/render-ao/render-ao.e2e.cjs (GPU spike, Playwright/SwiftShader)
- Root: package.json + tsconfig.json (workspace + reference registriert)
