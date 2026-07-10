import { StrictMode, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Vec3 } from '@omega/engine-math';
import { Camera } from '@omega/render';
import { createDemo, buildTerrain, type Demo } from './engine';
import { TerrainRenderer } from './renderer';
import { ModdingPanel } from './modding-panel';

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
  const [seed, setSeed] = useState('omega-demo');
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState('idle');
  const [metrics, setMetrics] = useState({
    physTick: 0,
    netTick: 0,
    bodies: 0,
    netConverged: true,
    fps: 0,
  });

  const terrainCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const terrainRef = useRef<TerrainRenderer | null>(null);
  const demoRef = useRef<Demo | null>(null);
  const camRef = useRef(new Camera());
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
      const demo = createDemo({ seed: newSeed, terrainSize: TERRAIN_SIZE });
      demoRef.current = demo;
      accRef.current = 0;
      lastTsRef.current = 0;
      setStatus(
        `seeded "${newSeed}" — ${demo.physicsPositions().length} physics bodies, ` +
          `${demo.netPositionsServer().length} net entities, deterministic fixed-step`,
      );
    });
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
        if (runningRef.current) demo.scheduler.step(dt, () => demo.step());


        // Camera orbit.
        const canvas = terrainCanvasRef.current!;
        const a = (angleRef.current += dt * (runningRef.current ? 0.25 : 0.08));
        const span = TERRAIN_SIZE / 2;
        const cam = camRef.current;
        cam.perspective(55, canvas.width / canvas.height, 0.1, 500);
        cam.orbit(a, 0.5, span * 2.2, new Vec3(span, 0, span));

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
        setMetrics({
          physTick: demo.coreWorld.tick,
          netTick: demo.server.tick,
          bodies: demo.physicsPositions().length,
          netConverged: converged,
          fps: dt > 0 ? Math.round(1 / dt) : 0,
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
      </header>

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
            <li>Headless determinism test: same seed → same end state; input→record→replay→play identity</li>
          </ul>
          <ModdingPanel demoRef={demoRef} />
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
