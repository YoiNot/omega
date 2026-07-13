# Deep-Research: UI & Graphics für PROJECT OMEGA

Gefiltert auf: deterministisch, $0 (kein Server/keine Assets), Browser (WebGL2),
schwache HW. Weggefiltert: WebGPU-Deferred, Ray-Traced GI, Path Tracer
(experimentell / zu teuer / bricht "$0 läuft überall").

## 1. DAS KERN-RISIKO: deterministisches Rendering
Unser $0-Multiplayer-lite-Claim ist "gleicher Seed ⇒ gleiche Welt". Die SIM
ist deterministisch (bewiesen). Aber das *gerenderte Bild* ist es NICHT
automatisch — das ist die Lücke, die niemand sieht, bis man sie behauptet.

- **forge3d / TERRA-DETERMINATA (PR #100)** — die relevanteste Quelle.
  dx12 vs vulkan waren byte-verschieden wegen per-API f32-Precision-Contracts
  (D3D = correctly-rounded divide/sqrt; Vulkan erlaubt ~2.5 ULP). Fix:
  `det_rcp / det_div / det_sqrt / det_inverse_sqrt` (bit-trick seed + gepinntes
  Newton-Raphson, nur barred mul/add) → beide Backends hash-identisch.
  → Für UNS: im TerrainRenderer-Shader `1.0/x`, `sqrt`, `inversesqrt`, `pow`
  gegen deterministische Pins tauschen. Reines Shader-Math, $0, keine Infra.
  Hebt den Claim von "gleiche Sim" auf "gleiches Bild über GPUs/Backends".

- **WebGL fingerprinting research** (Rendered Private, USENIX'19; whatsmy.fyi):
  GPU-Float-Divergenz ist real — transcendentals (sin/cos/pow/exp) sind über
  GPU-Hersteller NICHT bit-exakt. SwiftShader (headless CI) produziert andere
  Pixel als echte GPU. Unser `raymarchClouds` nutzt transcendentals → auf
  verschiedenen Clients visuell leicht anders. Für "same world" (Sim) egal;
  für "pixel-identical replay" muss man Pins setzen.

- **arxiv 2408.05148** (FP non-associativity): parallele Reductions + atomics
  auf GPU nicht-deterministisch. BEI UNS: eco-job ist zell-lokal (keine
  cross-cell-Reduction) → sicher. Nur relevant, falls wir später echte
  worker-Parallelität im Browser nutzen (nicht jetzt).

→ Empfehlung: den "pixel-identical"-Claim NICHT leichtfertig aufstellen. Entweder
  (a) Claim auf "gleiche Sim/World-State" begrenzen (stimmt schon), oder
  (b) `det_*`-Shader-Pins nachrüsten (kleiner Aufwand, $0) für echte
  Bild-Parität. (b) ist der saubere Move, weil wir's eh "deterministisch" nennen.

## 2. GRAFIK-QUALITÄT: was hebt es über Demo-Niveau
Aktueller Zustand: PBR-Terrain ohne AO sieht laut Fachliteratur (acko.net)
"like early 2000s OpenGL" — fehlende AO/Direkt-Light-Bounce ist der Hauptgrund.

- **GTAO** (Jimenez et al. 2016, Activision; XeGTAO = MIT-Implementierung):
  Ground-Truth Ambient Occlusion, radiometrisch korrekt, **0.5 ms @ PS4 1080p**.
  Braucht nur depth + normals (beide im TerrainRenderer vorhanden). Erweiterbar
  zu GTSO (specular occlusion) + **SSIL** (indirect lighting via visibility
  bitmask, arxiv 2301.11376). Das "verbindet" die Szene visuell.
  → Höchster ROI aller Grafik-Upgrades. $0, schwach-HW-freundlich.

- **IBL** (image-based lighting, prefiltered env map): braucht eine
  Environment-Map. Wir haben `defaultEnvironment()` — eine *procedurale*,
  seed-deterministische Sky/Env-Map generieren würde die PBR ohne Assets
  deutlich realistischer machen. $0 (kein HDRI-Asset nötig).

- **TAA** (temporal accumulation + reprojection): kostet motion vectors +
  history buffer. Bei statischer Terrain-Orbit sehr stabil, deutlich weniger
  Aliasing. Aber: größte Pipeline-Änderung der drei. Erst GTAO + IBL, TAA
  danach (optional).

- **SSAO vs GTAO**: GTAO > SSAO (radiometrisch korrekt, weniger Haloing).
  Klare Empfehlung: GTAO, nicht SSAO.

→ Empfehlung: (1) GTAO-Pass, (2) procedurale Env-Map für IBL, (3) optional TAA.
  Das ist die "PBR sieht endlich wie PBR aus"-Lücke.

## 3. UI/UX: Simulation & Replay sichtbar machen
Unser §18 Replay-Share exportiert JSON, aber es gibt keinen VIEWER. Das ist
die größte UX-Lücke — der $0-Multiplayer-lite ist unsichtbar ohne Player.

- **Replay-Timeline-Viewer** (Vorbilder: openturn inspector, muesli-studio,
  novaaiops, bugnet.io): horizontale Timeline, scrub/seek, single-frame step,
  variable speed (0.25x–8x), Diff-Panel, Input-Overlay. Unser
  `recordingToBytes` liefert already die Tick-Daten → nur ein Viewer fehlt.
  → Macht das $0-Multiplayer-lite *sichtbar* + debuggbar. Hoher Demo-Wert.

- **Performance HUD** (FrankenTUI, SimVX): togglebar (Ctrl+P), p50/p95/p99
  frame time, degradation tier. Wir haben schon Live-metrics — ein kompakteres,
  togglebares HUD wäre professioneller (und für build-in-public-Clips nützlich).

- **Session Replay fürs Debugging** (bugnet.io): inputs + seed recorden,
  snapshots alle N ticks. Wir HABEN das recording-Konzept schon (deterministisch).
  Ein Viewer + "scrub to tick N" schließt den Kreis.

→ Empfehlung: Replay-Timeline-Viewer bauen (das ist das fehlende Puzzleteil für
  §18). Performance-HUD als optionaler toggle.

## 4. ROADMAP-VORSCHLAG (priorisiert, alle $0)
| # | Vertiefung | ROI | Aufwand | Stärkt Constraint |
|---|---|---|---|---|
| A | `det_*`-Shader-Pins (pixel-parity) | mittel | klein | Determ.-Claim |
| B | GTAO-Pass | hoch | mittel | $0 / schwach-HW |
| C | Procedurale Env-Map (IBL) | hoch | mittel | $0 (kein Asset) |
| D | Replay-Timeline-Viewer | hoch | mittel | §18 sichtbar |
| E | TAA (optional) | mittel | hoch | $0 (Pipeline) |
| F | Performance-HUD toggle | niedrig | klein | UX-Politur |

B + C + D sind die "das sieht endlich aus wie ein Produkt"-Trio.
A ist der "wir meinen deterministisch ernst"-Move.
E + F sind optional/poliert.

## 5. QUELLEN (für Tiefen-Tauchgang)
- forge3d TERRA-DETERMINATA PR #100 (byte-exact cross-backend)
- Rendered Private, USENIX'19 (GPU float divergence root-cause)
- Jimenez et al. 2016 "Practical Realtime Strategies for Accurate Indirect
  Occlusion" (GTAO) + XeGTAO (MIT impl) + arxiv 2301.11376 (SSIL bitmask)
- arxiv 2408.05148 (FP non-associativity, reproducibility)
- openturn/inspector-ui, muesli-studio (Replay-Timeline-UI Patterns)
- bugnet.io "Session Replay System for Game Debugging"
- NeURIPS 2023 numerical deviations (runtime algo selection ≠ deterministic)
