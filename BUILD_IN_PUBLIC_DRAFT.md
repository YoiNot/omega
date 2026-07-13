# PROJECT OMEGA — build-in-public Launch-Draft (Deutsch)

Kontext: deterministisches Browser-Game-Engine-Monorepo (npm workspaces + TS
project references, ESM). 48 Pakete, alles deterministic (gleicher Seed ⇒
gleiches Spiel). Schwache HW, $0 Budget, 0 Follower — daher: alles, was man
zeigen kann, muss auf einem Laptop laufen und nichts kosten.

---

## POST 1 — Der Hook (ca. 220 Zeichen)

PROJECT OMEGA läuft. Eine deterministic Browser-Engine (48 Pakete, gleicher
Seed ⇒ gleiches Spiel) — und du kannst meine Welt sehen, indem du einen Link
anklickst. Kein Server, $0. Thread ↓

---

## POST 2 — Was es ist

PROJECT OMEGA ist eine deterministische Game-Engine, gebaut als Monorepo.
Physik, Sim, AI, Procgen, Net, Save — alles eigene Pakete, alles
deterministisch. Kein `Date.now()`, keine Runtime-RNG im Sim-Pfad.

Warum deterministic? Weil es den teuersten Teil vom Multiplayer/Replay
kostenlos macht: die Welt ist eine reine Funktion des Seeds.

---

## POST 3 — Der sichtbare Slice (Colony-Sim)

Auf der Procgen-Welt läuft eine Colony-Sim:
- sim-eco: Lotka-Volterra Populationsmodell (Vegetation/Herbivore/Carnivore)
- AI-Stack: GOAP-Goals + Persönlichkeit + soziale Beziehungen zwischen Agenten
- PBR-Terrain (Cook-Torrance GGX) im Browser, reines Determinisum aus dem Seed
- ein HUD, das die lebende Simulation live zeigt

Alles getickt in einer fixed-step time-core-Schleife.

---

## POST 4 — $0 Multiplayer-lite

Statt einen Server zu mieten: zwei Clients reproduzieren dieselbe Welt, indem
sie einen SEED teilen. Ein Link mit `?seed=` öffnet auf dem anderen Rechner
exakt dieselbe Welt + Sim. Optional: Replay-JSON exportieren/importieren →
exakt derselbe Verlauf, inkl. Input.

Kein Hosting, keine Kosten. Das ist der Determinismus-Vorteil in einem Tweet.

---

## POST 5 — Läuft auf schwacher HW

§20: die Sim läuft über @omega/job's deterministisches Sharding, und der
Terrain-Render hat 3 LOD-Stufen (fine/coarse/coarsest). Beim Orbiten zieht die
Kamera auf weniger Vertices runter — damit es auf einem Laptop in Echtzeit
tickt und ich Clips davon aufnehmen kann.

---

## POST 6 — Beweis (Commits)

4 PRs, alle gemergt, alle auf main, alle mit grünem Gate (tsc 0, 107 Tests grün):

- #53 full vertical slice (alle Systeme in der Demo verdrahtet)
- #54 Colony-Sim: PBR-Terrain (§8 NEXT) + Colony-HUD
- #55 Optimization: job-sharded Sim + 3-Level LOD (§20)
- #56 Multiplayer-lite: Same-Seed + Replay-Sharing (§18, $0)

Jeder PR: kleine ein-Concern-Commits, Destroy-Diff-Check (kein fremdes Paket
angelassen). Reproduzierbar.

---

## POST 7 — Nächster Schritt / Call

Was als Nächstes? Echter Server (§18) und World-Editor (§19) sind die
nächsten Roadmap-Punkte — aber die brechen die $0-Regel. Bis dahin: probier
den Seed-Link, sag mir, welche Welt du siehst.

Feedback willkommen. Wir bauen das öffentlich.

---

## GITHUB RELEASE NOTE (alternative Langfassung)

### PROJECT OMEGA — Phase B: sichtbarer, teilbarer, deterministischer Colony-Sim

Diese Phase macht die Engine sichtbar und teilbar, ohne Infrastruktur-Kosten:

1. **PBR-Terrain (§8 NEXT)** — der Browser-TerrainRenderer nutzt jetzt den
   echten Cook-Torrance-GGX-Shader mit deterministischem Material + Sonne.
   Gleicher Seed ⇒ gleiche Pixel.
2. **Colony-HUD** — sim-eco (Vegetation/Herbivore/Carnivore), brennende Zellen,
   Trade-Flows, Population + AI-Agenten mit Persönlichkeit, aktuellem Goal und
   bestem Verbündeten.
3. **Optimization (§20)** — sim-eco über @omega/job's deterministisches Sharding
   (inline==worker byte-identisch bewiesen) + 3-Level LOD-Chain im Renderer für
   schwache HW.
4. **Multiplayer-lite (§18, $0)** — Same-Seed-Share per `?seed=`-Link + Replay-
   Export/Import. Zwei Clients reproduzieren dieselbe Welt ohne Server.

**Verification:** `npx tsc -b` (0) + `npx vitest run --config
vitest.apps.config.ts` (107 passed). Determinismus-Proofs als Tests.

**PRs:** #54, #55, #56 (auf #53 aufbauend).

---

## HASHTAGS (sparsam)
#gamedev #buildinpublic #typescript #deterministic #webgpu (→ webgl2)
