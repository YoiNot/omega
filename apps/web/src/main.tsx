import { StrictMode, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Vec3 } from '@omega/engine-math';
import { Camera } from '@omega/render';
import { createGame, saveGame, loadGame, type GameState } from './engine';
import { TerrainRenderer } from './renderer';

const TERRAIN_SIZE = 48;

function App() {
  const [seed, setSeed] = useState('omega-1');
  const [state, setState] = useState<GameState | null>(null);
  const [running, setRunning] = useState(false);
  const [savedBytes, setSavedBytes] = useState<number | null>(null);
  const [status, setStatus] = useState('idle');
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rendererRef = useRef<TerrainRenderer | null>(null);
  const camRef = useRef(new Camera());
  const stateRef = useRef<GameState | null>(null);
  const rafRef = useRef(0);
  const lastTsRef = useRef(0);
  const angleRef = useRef(0);

  stateRef.current = state;

  function generate(newSeed: string) {
    setStatus('generating…');
    // Defer to allow the status paint.
    requestAnimationFrame(() => {
      const s = createGame(newSeed, TERRAIN_SIZE);
      setState(s);
      setRunning(false);
      setSavedBytes(null);
      setStatus(`generated seed "${newSeed}" — universe catalog ready`);

      const canvas = canvasRef.current!;
      const scene = {
        positions: s.mesh.positions,
        normals: s.normals,
        colors: s.colors,
        indices: s.mesh.indices,
      };
      if (rendererRef.current) {
        // Rebuild renderer with new scene.
        rendererRef.current = new TerrainRenderer(canvas, scene);
      } else {
        rendererRef.current = new TerrainRenderer(canvas, scene);
      }
    });
  }

  // Render loop.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const loop = (ts: number) => {
      const dt = lastTsRef.current ? (ts - lastTsRef.current) / 1000 : 0;
      lastTsRef.current = ts;

      const s = stateRef.current;
      const renderer = rendererRef.current;
      if (s && renderer) {
        // Advance simulation if running.
        if (running) s.sim.advance(Math.min(dt, 0.1));

        // Orbit camera around terrain center.
        angleRef.current += dt * (running ? 0.3 : 0.1);
        const cam = camRef.current;
        const span = TERRAIN_SIZE / 2;
        cam.perspective(55, canvas.width / canvas.height, 0.1, 500);
        cam.orbit(angleRef.current, 0.6, span * 2.2, new Vec3(span, 0, span));
        const vp = cam.getViewProjection().m;
        renderer.resize(canvas.width, canvas.height);
        renderer.render(vp);
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running]);

  function toggleRun() {
    if (!state) return;
    if (running) {
      state.sim.pause();
      setRunning(false);
      setStatus('paused');
    } else {
      state.sim.play();
      setRunning(true);
      setStatus('running simulation (agents wander, eat, live, die)');
    }
  }

  function autosave() {
    if (!state) return;
    const bytes = saveGame(state, 1_700_000_000_000);
    setSavedBytes(bytes.length);
    setStatus(`autosaved ${bytes.length} bytes (deterministic OMEG format v1)`);
  }

  function reload() {
    if (!state || savedBytes == null) return;
    // Re-save then reload to prove round-trip.
    const bytes = saveGame(state, 1_700_000_000_000);
    const reloaded = loadGame(bytes, TERRAIN_SIZE);
    setState(reloaded);
    setStatus(`reloaded from save — ${reloaded.agentCount} living agents restored`);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <header style={{ padding: '10px 16px', borderBottom: '1px solid #1b2735', display: 'flex', gap: 10, alignItems: 'center' }}>
        <strong style={{ fontSize: 15 }}>PROJECT OMEGA</strong>
        <span style={{ color: '#5b6b7d', fontSize: 12 }}>autonomous engine demo</span>
        <div style={{ flex: 1 }} />
        <input
          value={seed}
          onChange={(e) => setSeed(e.target.value)}
          style={{ background: '#0d1620', color: '#d8e0ea', border: '1px solid #1b2735', padding: '4px 8px', borderRadius: 4 }}
        />
        <button onClick={() => generate(seed)} style={btn}>Generate</button>
        <button onClick={toggleRun} disabled={!state} style={btn}>▶/⏸ Run</button>
        <button onClick={autosave} disabled={!state} style={btn}>Autosave</button>
        <button onClick={reload} disabled={savedBytes == null} style={btn}>Reload</button>
      </header>

      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <canvas ref={canvasRef} width={960} height={720} style={{ flex: 1, display: 'block', background: '#0a0e14' }} />
        <aside style={{ width: 280, borderLeft: '1px solid #1b2735', padding: 16, fontSize: 12, overflow: 'auto' }}>
          <h3 style={{ marginTop: 0 }}>Status</h3>
          <div style={{ color: '#8fa3b8' }}>{status}</div>
          {state && (
            <div style={{ marginTop: 16 }}>
              <Metric label="Seed" value={state.seed} />
              <Metric label="Terrain" value={`${state.terrain.width}×${state.terrain.height}`} />
              <Metric label="Vertices" value={String(state.mesh.vertexCount)} />
              <Metric label="Triangles" value={String(state.mesh.indexCount / 3)} />
              <Metric label="Living agents" value={String(state.agentCount)} />
              <Metric label="Sim tick" value={String(state.sim.world.tick)} />
              <Metric label="Save bytes" value={savedBytes != null ? String(savedBytes) : '—'} />
            </div>
          )}
          <h3 style={{ marginTop: 24 }}>What this proves</h3>
          <ul style={{ color: '#8fa3b8', paddingLeft: 16, lineHeight: 1.5 }}>
            <li>Deterministic seeded universe + terrain (ADR 0001)</li>
            <li>Real WebGL2 PBR-ish terrain render</li>
            <li>ECS colony sim (move/eat/die) on a fixed timestep</li>
            <li>Binary save + migration-ready format, round-trips</li>
          </ul>
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
