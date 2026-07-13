import { StrictMode, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Vec3 } from '@omega/engine-math';
import { raymarchClouds } from '@omega/render-pbr';
import { Camera, defaultPbrMaterial, defaultSun, defaultEnvironment, selectLodLevel, defaultThresholds } from '@omega/render';
import { TerrainMaterial, TerrainSun } from './renderer';
import { createDemo, buildTerrain, buildCoarseMesh, buildPbrTerrain, type Demo } from './engine';
import { TerrainRenderer } from './renderer';
import { ModdingPanel } from './modding-panel';
import { ReplayPanel } from './replay-panel';
import { buildSharePayload, payloadToJson, shareLink, seedFromUrl, jsonToPayload, recordingFromPayload } from './share';

const TERRAIN_SIZE = 40;

/** Extract the camera right vector (world space) from its view matrix. */
function cameraRight(cam: Camera): Vec3 {
  const v = cam.getView().m;
  return new Vec3(v[0], v[4], v[8]);
}

/** Project a world point to canvas pixel space; returns null if behind camera. */
function projectToScreen(
  vp: Float32Array,
  p: Vec3,
  w: number,
  h: number,
): { x: number; y: number } | null {
  const m = vp;
  const cw = m[3] * p.x + m[7] * p.y + m[11] * p.z + m[15];
  if (cw <= 0.0001) return null;
  const ndcx = (m[0] * p.x + m[4] * p.y + m[8] * p.z + m[12]) / cw;
  const ndcy = (m[1] * p.x + m[5] * p.y + m[9] * p.z + m[13]) / cw;
  return { x: (ndcx * 0.5 + 0.5) * w, y: (1 - (ndcy * 0.5 + 0.5)) * h };
}

function App() {
  const [seed, setSeed] = useState(seedFromUrl() ?? 'omega-demo');
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState('idle');
  const [shareMsg, setShareMsg] = useState('');
  const [metrics, setMetrics] = useState({
    physTick: 0,
    netTick: 0,
    bodies: 0,
    netConverged: true,
    fps: 0,
    agents: 0,
    delivered: 0,
    lodLevel: 0,
    particles: 0,
    cloudMean: 0,
    // --- Colony-Sim (Step 1b) ---
    veg: 0,
    herbivores: 0,
    carnivores: 0,
    population: 0,
    burning: 0,
    tradeFlows: 0,
    seed: 'omega-demo',
  });

  const terrainCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const terrainRef = useRef<TerrainRenderer | null>(null);
  const demoRef = useRef<Demo | null>(null);
  const camRef = useRef(new Camera());
  const pbrTerrainRef = useRef<ReturnType<typeof buildPbrTerrain> | null>(null);
  const rafRef = useRef(0);
  const lastTsRef = useRef(0);
  const accRef = useRef(0);
  const angleRef = useRef(0.6);
  const runningRef = useRef(false);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);

  runningRef.current = running;

  function regenerate(newSeed: string) {
    setStatus('initializing deterministic demo…');
    requestAnimationFrame(() => {
      const terrain = buildTerrain(newSeed, TERRAIN_SIZE);
      const canvas = terrainCanvasRef.current!;
      if (terrainRef.current) {
        terrainRef.current = new TerrainRenderer(canvas, {
          positions: terrain.mesh.positions,
          normals: terrain.normals,
          colors: terrain.colors,
          indices: terrain.mesh.indices,
        });
      } else {
        terrainRef.current = new TerrainRenderer(canvas, {
          positions: terrain.mesh.positions,
          normals: terrain.normals,
          colors: terrain.colors,
          indices: terrain.mesh.indices,
        });
      }
      // Roadmap §8 NEXT: wire the real PBR (Cook-Torrance GGX) shader into the
      // browser TerrainRenderer, driven by the same deterministic material +
      // sun the engine's PBR pipeline uses. The rendered terrain is now a pure
      // function of the seed (no clock, no RNG) — same seed ⇒ same pixels.
      const mat: TerrainMaterial = {
        albedo: [0.42, 0.46, 0.5],
        roughness: 0.78,
        metallic: 0.02,
        emissive: [0, 0, 0],
      };
      const sunDef = defaultSun();
      const env = defaultEnvironment();
      const sun: TerrainSun = {
        direction: sunDef.direction,
        color: sunDef.color,
        intensity: sunDef.intensity,
        ambientTop: env.ambientTop,
        ambientBottom: env.ambientBottom,
        ambientIntensity: env.ambientIntensity,
      };
      terrainRef.current.enablePbr(mat, sun);
      // Roadmap §20: 3-level LOD chain (fine/coarse/coarsest) for weak HW — the
      // orbit camera drops to fewer vertices at distance. Deterministic (pure
      // function of seed + size).
      const base = terrain.mesh;
      const coarse = buildCoarseMesh(terrain.terrain.heights, terrain.terrain.width, terrain.terrain.height, 2);
      const coarsest = buildCoarseMesh(terrain.terrain.heights, terrain.terrain.width, terrain.terrain.height, 4);
      terrainRef.current.setLodMeshes([
        { positions: base.positions, normals: terrain.normals, colors: terrain.colors, indices: base.indices },
        coarse,
        coarsest,
      ]);
      const demo = createDemo({ seed: newSeed, terrainSize: TERRAIN_SIZE });
      demoRef.current = demo;
      // Build the PBR terrain view (material + LOD chain + shadow cascades)
      // and stash it for the PBR LOD draw path in the render loop.
      pbrTerrainRef.current = buildPbrTerrain(newSeed, TERRAIN_SIZE);
      accRef.current = 0;
      lastTsRef.current = 0;
      setSeed(newSeed);
      setMetrics((m) => ({ ...m, seed: newSeed }));
      setStatus(
        `seeded "${newSeed}" — ${demo.physicsPositions().length} physics bodies, ` +
          `${demo.netPositionsServer().length} net entities, deterministic fixed-step`,
      );
    });
  }

  /** Step 3 (§18 $0): copy a world-only share link (just the seed) to the clipboard. */
  function shareWorldLink() {
    const link = shareLink(seed);
    // Clipboard can be denied (insecure context / no permission); fall back to
    // showing the link in the status line so the button never hard-crashes.
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        void navigator.clipboard.writeText(link).catch(() => {});
      }
    } catch {
      /* clipboard unavailable — link is still shown below */
    }
    setShareMsg(`World link: ${link} — same seed ⇒ same world on any client ($0, no server).`);
  }

  /** Step 3 (§18 $0): export the current seed + recorded replay as a JSON file. */
  function exportReplay() {
    const demo = demoRef.current;
    if (!demo) return;
    const payload = buildSharePayload(demo, seed);
    const json = payloadToJson(payload);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `omega-${seed}.replay.json`;
    a.click();
    URL.revokeObjectURL(url);
    setShareMsg('Replay exported — load it on another client to reproduce the exact run.');
  }

  /** Step 3 (§18 $0): load a shared replay JSON and rebuild the same world. */
  function loadReplayFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const payload = jsonToPayload(String(reader.result));
        // (a) world: same seed ⇒ same procgen + sim on any client.
        regenerate(payload.seed);
        // (b) replay bytes are reconstructable for parity/inspection (see opt/replay tests).
        void recordingFromPayload(payload);
        setShareMsg(`Loaded seed "${payload.seed}" — world reproduced deterministically.`);
      } catch {
        setShareMsg('Invalid replay file.');
      }
    };
    reader.readAsText(file);
  }

  // Render + fixed-timestep loop driving the demo (scheduler is the tick source).
  useEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay) return;
    ctxRef.current = overlay.getContext('2d');
    const loop = (ts: number) => {
      const dt = lastTsRef.current ? (ts - lastTsRef.current) / 1000 : 0;
      lastTsRef.current = ts;
      const demo = demoRef.current;
      if (demo) {
        // Fixed-timestep via @omega/time-core scheduler (decoupled from FPS).
        if (runningRef.current) {
          demo.scheduler.step(dt, () => demo.step());
          // Advance the deterministic GPU particle system one tick.
          demo.stepParticles();
        }

        // Camera orbit.
        const canvas = terrainCanvasRef.current!;
        const a = (angleRef.current += dt * (runningRef.current ? 0.25 : 0.08));
        const span = TERRAIN_SIZE / 2;
        const cam = camRef.current;
        cam.perspective(55, canvas.width / canvas.height, 0.1, 500);
        cam.orbit(a, 0.5, span * 2.2, new Vec3(span, 0, span));

        // --- Roadmap §8 render upgrades (deterministic, same-world =>
        //     same encodings) -----------------------------------------------
        const camPos = cam.getPosition();
        const camFwd = Vec3.sub(cam.getCenter(), camPos).normalize();
        // PBR terrain via LOD dispatch (level chosen by camera distance).
        const pbr = pbrTerrainRef.current;
        let lodLevel = 0;
        let cloudMean = 0;
        if (pbr) {
          const dx = camPos.x - pbr.lod.center.x;
          const dy = camPos.y - pbr.lod.center.y;
          const dz = camPos.z - pbr.lod.center.z;
          const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
          lodLevel = selectLodLevel(dist, defaultThresholds(pbr.lod.levels.length), pbr.lod.levels.length);
          // Volumetric cloud raymarch along the camera forward ray.
          const cloud = raymarchClouds(demo.clouds, camPos, camFwd, 48, 1.5);
          cloudMean = cloud.meanDensity;
        }
        void defaultPbrMaterial; void defaultSun; void defaultEnvironment;

        // Drive the LOD chain (§20) from the camera distance before drawing.
        terrainRef.current?.setLodLevel(lodLevel);

        // Draw terrain through the real WebGL2 renderer.
        const vp = cam.getViewProjection().m;
        terrainRef.current?.render(vp);

        // Overlay physics + net bodies via the deterministic draw list.
        const ctx = ctxRef.current;
        const right = cameraRight(cam);
        if (ctx) {
          ctx.clearRect(0, 0, overlay.width, overlay.height);
          for (const item of demo.drawList()) {
            const m = item.transform.m;
            const center = new Vec3(m[12], m[13], m[14]);
            const sp = projectToScreen(vp, center, overlay.width, overlay.height);
            if (!sp) continue;
            const r = demo.radiusOf(item.entity);
            const edge = projectToScreen(
              vp,
              center.addScaled(right, r),
              overlay.width,
              overlay.height,
            );
            const rad = edge ? Math.hypot(edge.x - sp.x, edge.y - sp.y) : r * 4;
            const c = item.color;
            ctx.beginPath();
            ctx.arc(sp.x, sp.y, Math.max(2, rad), 0, Math.PI * 2);
            ctx.fillStyle = `rgba(${c[0]},${c[1]},${c[2]},${c[3] / 255})`;
            ctx.fill();
            ctx.lineWidth = 1.5;
            ctx.strokeStyle = 'rgba(255,255,255,0.35)';
            ctx.stroke();
          }

          // GOAP agents: draw as small squares at their tile centre. Colour
          // shifts green once the agent has delivered (goal reached).
          for (const a of demo.agentPositions()) {
            const center = new Vec3(a.tx + 0.5, 0.6, a.tz + 0.5);
            const sp = projectToScreen(vp, center, overlay.width, overlay.height);
            if (!sp) continue;
            ctx.beginPath();
            ctx.rect(sp.x - 5, sp.y - 5, 10, 10);
            ctx.fillStyle = a.delivered ? 'rgba(120,255,140,0.95)' : 'rgba(255,235,120,0.95)';
            ctx.fill();
            ctx.lineWidth = 1.5;
            ctx.strokeStyle = 'rgba(0,0,0,0.6)';
            ctx.stroke();
          }

          // --- GPU particle overlay (deterministic positions) ----------
          if (demo) {
            const live = demo.particles.live();
            for (const p of live) {
              const sp = projectToScreen(vp, p.pos, overlay.width, overlay.height);
              if (!sp) continue;
              const r = Math.max(1, p.life * 4);
              ctx.beginPath();
              ctx.arc(sp.x, sp.y, r, 0, Math.PI * 2);
              ctx.fillStyle = `rgba(255,${Math.round(180 - p.life * 120)},90,${0.5 * p.life + 0.15})`;
              ctx.fill();
            }
          }
        }

        // HUD metrics.
        const s = demo.netPositionsServer();
        const c = demo.netPositionsClient();
        let converged = s.length === c.length;
        for (let i = 0; i < s.length && converged; i++) {
          const a = s[i]!;
          const b = c[i]!;
          if (Math.abs(a.x - b.x) > 1e-4 || Math.abs(a.y - b.y) > 1e-4 || Math.abs(a.z - b.z) > 1e-4) {
            converged = false;
          }
        }
        const eco = demo.simSpine.eco;
        let veg = 0; let herb = 0; let carn = 0;
        if (eco) {
          for (let i = 0; i < eco.vegetation.length; i++) {
            veg += eco.vegetation[i]!;
            herb += eco.herbivores[i]!;
            carn += eco.carnivores[i]!;
          }
          const n = eco.vegetation.length || 1;
          veg /= n; herb /= n; carn /= n;
        }
        setMetrics({
          physTick: demo.coreWorld.tick,
          netTick: demo.server.tick,
          bodies: demo.physicsPositions().length,
          netConverged: converged,
          fps: dt > 0 ? Math.round(1 / dt) : 0,
          agents: demo.agentPositions().length,
          delivered: demo.agentPositions().filter((a) => a.delivered === 1).length,
          lodLevel,
          particles: demo.particles.live().length,
          cloudMean: Math.round(cloudMean * 1000) / 1000,
          // --- Colony-Sim (Step 1b) ---
          veg: Math.round(veg * 1000) / 1000,
          herbivores: Math.round(herb * 1000) / 1000,
          carnivores: Math.round(carn * 1000) / 1000,
          population: demo.agentPositions().length + demo.wandererPositions().length,
          burning: demo.simSpine.burning(),
          tradeFlows: demo.simSpine.tradeFlows(),
          seed: metrics.seed,
        });
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <header style={{ padding: '10px 16px', borderBottom: '1px solid #1b2735', display: 'flex', gap: 10, alignItems: 'center' }}>
        <strong style={{ fontSize: 15 }}>PROJECT OMEGA</strong>
        <span style={{ color: '#5b6b7d', fontSize: 12 }}>deterministic integration demo</span>
        <div style={{ flex: 1 }} />
        <input
          value={seed}
          onChange={(e) => setSeed(e.target.value)}
          style={{ background: '#0d1620', color: '#d8e0ea', border: '1px solid #1b2735', padding: '4px 8px', borderRadius: 4 }}
        />
        <button onClick={() => regenerate(seed)} style={btn}>Generate</button>
        <button onClick={() => setRunning((r) => !r)} style={btn}>{running ? '⏸ Pause' : '▶ Run'}</button>
        <button onClick={() => regenerate(seed)} style={btn}>↺ Reset</button>
        <button onClick={shareWorldLink} style={btn}>🔗 Share world</button>
        <button onClick={exportReplay} style={btn}>⤓ Export replay</button>
        <label style={{ ...btn, display: 'inline-flex', alignItems: 'center', cursor: 'pointer' }}>
          ⤒ Load replay
          <input
            type="file"
            accept="application/json"
            style={{ display: 'none' }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) loadReplayFile(f); }}
          />
        </label>
      </header>
      {shareMsg ? (
        <div style={{ padding: '6px 16px', background: '#0d1620', color: '#7fd6a0', fontSize: 12, borderBottom: '1px solid #1b2735' }}>
          {shareMsg}
        </div>
      ) : null}

      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <div style={{ position: 'relative', flex: 1, background: '#0a0e14' }}>
          <canvas ref={terrainCanvasRef} width={960} height={720} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />
          <canvas ref={overlayRef} width={960} height={720} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }} />
        </div>
        <aside style={{ width: 300, borderLeft: '1px solid #1b2735', padding: 16, fontSize: 12, overflow: 'auto' }}>
          <h3 style={{ marginTop: 0 }}>Status</h3>
          <div style={{ color: '#8fa3b8' }}>{status}</div>
          <h3 style={{ marginTop: 24 }}>Live metrics</h3>
          <Metric label="Physics tick" value={String(metrics.physTick)} />
          <Metric label="Net tick (server)" value={String(metrics.netTick)} />
          <Metric label="Physics bodies" value={String(metrics.bodies)} />
          <Metric label="Client = Server" value={metrics.netConverged ? 'CONVERGED ✓' : 'diverged ✗'} />
          <Metric label="Render FPS" value={String(metrics.fps)} />
          <Metric label="GOAP agents" value={String(metrics.agents)} />
          <Metric label="Delivered (goal)" value={`${metrics.delivered}/${metrics.agents}`} />
          <Metric label="Terrain LOD level" value={String(metrics.lodLevel)} />
          <Metric label="Live particles" value={String(metrics.particles)} />
          <Metric label="Cloud mean density" value={metrics.cloudMean.toFixed(3)} />
          <Metric label="Seed" value={metrics.seed} />
          <h3 style={{ marginTop: 24 }}>Colony-Sim (procgen world)</h3>
          <Metric label="Population (agents+wanderers)" value={String(metrics.population)} />
          <Metric label="Vegetation (mean)" value={metrics.veg.toFixed(3)} />
          <Metric label="Herbivores (mean)" value={metrics.herbivores.toFixed(3)} />
          <Metric label="Carnivores (mean)" value={metrics.carnivores.toFixed(3)} />
          <Metric label="Burning cells" value={String(metrics.burning)} />
          <Metric label="Trade flows" value={String(metrics.tradeFlows)} />
          <Metric label="Eco LOD lanes (§20 job)" value={String(demoRef.current?.ecoJob?.lanes ?? 0)} />
          <ColonyAgentPanel demoRef={demoRef} />
          <h3 style={{ marginTop: 24 }}>What this proves</h3>
          <ul style={{ color: '#8fa3b8', paddingLeft: 16, lineHeight: 1.5 }}>
            <li><b>physics-integration</b>: deterministic fixed-step rigid bodies on a seeded World</li>
            <li><b>render-ecs</b>: id-ordered draw list (cyan/orange = physics, magenta/green = net)</li>
            <li><b>net-replication</b>: server-authoritative sim over a LoopbackTransport; client prediction + reconciliation converges to the server bit-for-bit</li>
            <li>Headless determinism test: same seed → same end state</li>
          </ul>
          <ul style={{ color: '#8fa3b8', paddingLeft: 16, lineHeight: 1.5 }}>
            <li><b>physics-integration</b>: deterministic fixed-step rigid bodies on a seeded World</li>
            <li><b>render-ecs</b>: id-ordered draw list (cyan/orange = physics, magenta/green = net)</li>
            <li><b>net-replication</b>: server-authoritative sim over a LoopbackTransport; client prediction + reconciliation converges to the server bit-for-bit</li>
            <li><b>input-core</b>: live DOM input source → deterministic InputFrame → command payload</li>
            <li><b>time-core</b>: fixed-timestep scheduler is the tick source (FPS-decoupled)</li>
            <li><b>replay</b>: optional Recorder snapshots each tick; Playback rebuilds the world deterministically</li>
            <li><b>ai-goap</b>: agents plan (deliver a resource) via forward A* GOAP — same state ⇒ same plan</li>
            <li><b>nav-core</b>: agents navigate a biome-derived grid via A*/flow-field — same world ⇒ same path</li>
            <li>Headless determinism test: same seed → same end state; input→record→replay→play identity</li>
          </ul>
          <ModdingPanel demoRef={demoRef} />
          <ReplayPanel demoRef={demoRef} />
        </aside>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', borderBottom: '1px solid #131c27' }}>
      <span style={{ color: '#5b6b7d' }}>{label}</span>
      <span>{value}</span>
    </div>
  );
}

/**
 * Colony-Sim agent roster: each agent's deterministic persona (traits), its
 * current chained goal, and its best ally in the shared social network. This
 * is the §14 AI-stack made visible — the same data that proves the engine's
 * determinism, surfaced for the build-in-public demo (screenshot/recordable).
 */
function ColonyAgentPanel({ demoRef }: { demoRef: React.MutableRefObject<Demo | null> }) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 500);
    return () => clearInterval(id);
  }, []);
  const demo = demoRef.current;
  if (!demo) return <div style={{ color: '#5b6b7d', fontSize: 11 }}>no colony yet</div>;
  const views = demo.aiStackViews();
  void tick;
  return (
    <div style={{ marginTop: 10 }}>
      {views.map((v) => {
        const ally = demo.bestAlly(v.entity);
        const traits = Object.entries(v.traits)
          .map(([k, val]) => `${k[0]}:${(val as number).toFixed(2)}`)
          .join(' ');
        return (
          <div key={v.entity} style={{ padding: '3px 0', borderBottom: '1px solid #131c27', fontSize: 11 }}>
            <div style={{ color: '#d8e0ea' }}>
              agent {v.entity} · goal <b style={{ color: '#7fd0ff' }}>{v.goal ?? '—'}</b>
            </div>
            <div style={{ color: '#8fa3b8' }}>{traits}</div>
            <div style={{ color: '#8fa3b8' }}>ally: {ally ?? '—'} · mem:{v.memoryCount}</div>
          </div>
        );
      })}
    </div>
  );
}

const btn: React.CSSProperties = {
  background: '#13202e', color: '#d8e0ea', border: '1px solid #25384c',
  padding: '5px 10px', borderRadius: 4, cursor: 'pointer', fontSize: 12,
};

const root = createRoot(document.getElementById('root')!);
root.render(
  <StrictMode>
    <App />
  </StrictMode>,
);
