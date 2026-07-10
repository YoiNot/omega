import { describe, it, expect } from 'vitest';
import { World, Rng } from '@omega/engine-core';
import { Recorder, Playback, serializeRecording, loadRecording } from './index.js';

// Component types mirrored from packages/ecs/src/world.test.ts fixtures.
const Pos = 'Position';
const Vel = 'Velocity';
const Hp = 'Health';
const COMPONENT_NAMES = [Pos, Vel, Hp];

/** Build a deterministic world from a seeded RNG (no Math.random / Date.now). */
function makeWorld(seed: number | string, ticks: number, dt: number): World {
  const rng = new Rng(seed);
  const w = new World();
  for (let i = 0; i < 8; i++) {
    const id = w.createEntity();
    w.addComponent(Pos, id, {
      x: Math.round(rng.nextRange(-100, 100)),
      y: Math.round(rng.nextRange(-100, 100)),
    });
    if (rng.bool(0.6)) {
      w.addComponent(Vel, id, {
        dx: rng.nextRange(-5, 5),
        dy: rng.nextRange(-5, 5),
      });
    }
    if (rng.bool(0.5)) {
      w.addComponent(Hp, id, { hp: Math.round(rng.nextRange(1, 50)) });
    }
  }
  // Integrate a deterministic movement system for `ticks` steps.
  for (let t = 0; t < ticks; t++) {
    w.query(Pos, Vel).ids.forEach((id) => {
      const v = w.getComponent<{ dx: number; dy: number }>(Vel, id)!;
      const p = w.getComponent<{ x: number; y: number }>(Pos, id)!;
      p.x += v.dx * dt;
      p.y += v.dy * dt;
    });
  }
  return w;
}

/** Snapshot the full world state as a comparable JSON structure. */
function worldToJSON(w: World): unknown {
  const out: Array<{ id: number; components: Record<string, unknown> }> = [];
  for (const name of COMPONENT_NAMES) {
    const store = w.store(name);
    for (const id of store.keys()) {
      const comp = w.getComponent(name, id);
      if (comp === undefined) continue;
      let entry = out.find((e) => e.id === id);
      if (!entry) {
        entry = { id, components: {} };
        out.push(entry);
      }
      entry.components[name] = comp;
    }
  }
  out.sort((a, b) => a.id - b.id);
  return out;
}

describe('replay — deterministic record/serialize/load/play', () => {
  it('record -> serialize -> load -> playTo yields identical world tick-for-tick', () => {
    const dt = 1 / 60;
    const rec = new Recorder(COMPONENT_NAMES, { seedLow: 7n, seedHigh: 42n });

    // Record 10 frames.
    const reference: Array<{ tick: number; state: unknown }> = [];
    for (let tick = 0; tick < 10; tick++) {
      const w = makeWorld('omega-replay-seed', tick, dt);
      rec.recordFrame(w, tick, dt);
      reference.push({ tick, state: worldToJSON(w) });
    }

    const recording = rec.toRecording();
    const bytes = serializeRecording(recording, 0); // createdAt explicit (deterministic)
    const loaded = loadRecording(bytes);

    // Byte output is reproducible for the same inputs.
    const bytes2 = serializeRecording(rec.toRecording(), 0);
    expect([...bytes2]).toEqual([...bytes]);

    // Replay tick-by-tick and compare to the reference states.
    const playbackWorld = new World();
    const pb = new Playback(loaded, playbackWorld, COMPONENT_NAMES);
    for (const { tick, state } of reference) {
      pb.playTo(tick);
      expect(worldToJSON(playbackWorld)).toEqual(state);
      expect(pb.currentTick).toBe(tick);
    }
  });

  it('seed carried through the recording header', () => {
    const rec = new Recorder(COMPONENT_NAMES, { seedLow: 11n, seedHigh: 22n });
    const w = makeWorld('seed-a', 3, 1 / 60);
    rec.recordFrame(w, 0, 1 / 60);
    const loaded = loadRecording(serializeRecording(rec.toRecording(), 0));
    expect(loaded.seedLow).toBe('11');
    expect(loaded.seedHigh).toBe('22');
    expect(loaded.componentNames).toEqual(COMPONENT_NAMES);
  });

  it('rejects a recording with mismatched component names', () => {
    const rec = new Recorder(COMPONENT_NAMES);
    rec.recordFrame(makeWorld('x', 1, 1 / 60), 0, 1 / 60);
    const loaded = loadRecording(serializeRecording(rec.toRecording(), 0));
    const w = new World();
    expect(() => new Playback(loaded, w, ['Position'])).toThrow(/component names/);
  });

  it('rejects bytes with the wrong magic / version', () => {
    expect(() => loadRecording(new Uint8Array([0, 0, 0, 0]))).toThrow(/magic/);
  });

  it('no nondeterministic state: two recordings from identical inputs are byte-equal', () => {
    function run(): Uint8Array {
      const r = new Recorder(COMPONENT_NAMES);
      for (let tick = 0; tick < 5; tick++) {
        r.recordFrame(makeWorld('det', tick, 1 / 60), tick, 1 / 60);
      }
      return serializeRecording(r.toRecording(), 12345);
    }
    expect([...run()]).toEqual([...run()]);
  });

  it('RNG state checkpoint round-trips and is retrievable by tick', () => {
    const r = new Recorder(COMPONENT_NAMES);
    const rng = new Rng('rng-seed');
    for (let tick = 0; tick < 3; tick++) {
      const w = makeWorld('rng-world', tick, 1 / 60);
      r.recordFrameWithRng(w, tick, 1 / 60, rng.state());
      rng.nextU64(); // advance so each checkpoint differs
    }
    const loaded = loadRecording(serializeRecording(r.toRecording(), 0));
    const pb = new Playback(loaded, new World(), COMPONENT_NAMES);
    expect(pb.rngStateAt(0)).toEqual(new Rng('rng-seed').state());
    expect(pb.rngStateAt(2)).not.toEqual(pb.rngStateAt(0));
  });
});
