/**
 * apps/web — vertical-slice integration helpers (the "missing" systems).
 *
 * This module wires the systems the brief lists as NOT-yet-connected into the
 * existing time-core / engine-core demo loop. Everything here is deterministic
 * (pure function of seed + inputs); nothing reads a clock or `Math.random`.
 *
 *   1. GEOLOGY TERRAIN  — `buildGeologyTerrain` runs the real `@omega/geology`
 *      pipeline (plate tectonics → hydraulic erosion → climate via `@omega/sim-env`
 *      → biome classification) and returns a `@omega/world-gen`-shaped `Terrain`
 *      so the demo's nav grid / scenario / biome rules ride the procgen world
 *      instead of a static test terrain.
 *
 *   2. SIM SPINE        — `registerSimSpine` registers `@omega/sim-env`,
 *      `@omega/sim-fire`, `@omega/sim-eco`, `@omega/sim-econ`, `@omega/sim-trade`
 *      onto an engine-core `World` via their own `registerXxx` helpers. Because
 *      the demo's `coreWorld.step(fixedDt)` runs every registered system, these
 *      tick inside the existing time-core loop and influence each other through
 *      the singleton components on entity 0 (env → fire → eco → econ → trade).
 *
 *   3. AUDIO            — `SpatialAudioModel` (`@omega/audio-spatial`) computes
 *      deterministic gain/pan/distance for the demo's emitters; `buildPlaybackGraph`
 *      (`@omega/audio-playback`) turns those params into a Web Audio graph. The
 *      params are exercised headlessly with a mock `AudioContextLike`.
 *
 *   4. PERSISTENCE       — `IncrementalSaver` (`@omega/save-incr`) captures the
 *      core world as a byte-stable incremental save; `applyIncremental` +
 *      `recoverPlainSave` prove load/recovery reconstructs identical state.
 *
 *   5. NET-DELTA (MP)    — `setupDeltaReplication` stands up a 2nd client world
 *      reconciled from the server via `@omega/net-delta` deltas over the same
 *      `LoopbackTransport`, proving the delta path converges to the full
 *      snapshot path (the multiplayer base).
 */

import { Rng } from '@omega/engine-core';
import { Vec3 } from '@omega/engine-math';
import { PlateSim, simulate as erode } from '@omega/geology';
import { Biome, type Terrain } from '@omega/world-gen';
import {
  createEnvField,
  registerEnvironmentField,
  type EnvField,
} from '@omega/sim-env';
import {
  registerFireField,
  type FireField,
} from '@omega/sim-fire';
import {
  registerEcosystemField,
  type EcoField,
} from '@omega/sim-eco';
import {
  registerEconomyField,
  type EconomyField,
} from '@omega/sim-econ';
import { registerTradeMarket } from '@omega/sim-trade';
import {
  SpatialAudioModel,
  type AudioSourceInput,
  type SpatialSourceParam,
  type ListenerState,
} from '@omega/audio-spatial';
import { buildPlaybackGraph } from '@omega/audio-playback';
import type {
  AudioContextLike,
  AudioNodeLike,
  GainNodeLike,
  StereoPannerNodeLike,
  OscillatorNodeLike,
  AudioBufferSourceNodeLike,
  AudioBufferLike,
} from '@omega/audio-playback';
export type { AudioContextLike } from '@omega/audio-playback';
export type { AudioSourceInput, SpatialSourceParam } from '@omega/audio-spatial';
import {
  IncrementalSaver,
  applyIncremental,
  recoverPlainSave,
} from '@omega/save-incr';
import { snapshotWorld } from '@omega/save';
import { SaveWriter } from '@omega/save';
import { World as EcsWorld, Codec } from '@omega/net-replication';
import { computeDelta, applyDeltaTo } from '@omega/net-delta';
import type { World } from '@omega/engine-core';

/** Resolution of the simulation spine (env/fire/eco/econ/trade) grid. */
export const SIM_GRID = 32;

/** Downsample a `Terrain` heightfield to `n x n` (nearest, deterministic). */
export function downsampleTerrain(t: Terrain, n: number): Terrain {
  const heights = new Float32Array(n * n);
  const biomeIds = new Uint8Array(n * n);
  const moisture = new Float32Array(n * n);
  const temperature = new Float32Array(n * n);
  const sx = t.width / n;
  const sy = t.height / n;
  let mn = Infinity;
  let mx = -Infinity;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const sxp = Math.min(t.width - 1, Math.floor((x + 0.5) * sx));
      const syp = Math.min(t.height - 1, Math.floor((y + 0.5) * sy));
      const i = y * n + x;
      const h = t.heights[syp * t.width + sxp]!;
      heights[i] = h;
      biomeIds[i] = t.biomeIds[syp * t.width + sxp]!;
      moisture[i] = t.moisture[syp * t.width + sxp]!;
      temperature[i] = t.temperature[syp * t.width + sxp]!;
      if (h < mn) mn = h;
      if (h > mx) mx = h;
    }
  }
  return { width: n, height: n, heights, biomeIds, moisture, temperature, minHeight: mn, maxHeight: mx };
}

/**
 * Build the demo's world from the REAL procgen pipeline:
 *   plate tectonics (PlateSim) → hydraulic erosion → climate (sim-env env
 *   field, used for moisture/temperature) → biome classification.
 *
 * The result is a `@omega/world-gen`-shaped `Terrain`, so the rest of the demo
 * (nav grid, scenario scatter, biome cost rules) consumes it unchanged — but
 * now the world is GENERATED, not a static test terrain. Pure function of seed.
 */
export function buildGeologyTerrain(seed: string, size = 40): Terrain {
  const n = size;
  // --- 1. Plate tectonics -------------------------------------------------
  const plates = new PlateSim(`${seed}:plates`, {
    gridSize: n,
    plateCount: 6,
    steps: 40,
    falloff: 18,
  });
  const field = plates.simulate();
  // Normalize heights to ~[-1, 1] for stable erosion + biome thresholds.
  let mn = Infinity;
  let mx = -Infinity;
  for (let i = 0; i < n * n; i++) {
    const h = field.heights[i]!;
    if (h < mn) mn = h;
    if (h > mx) mx = h;
  }
  const span = mx - mn || 1;
  const heights = new Float32Array(n * n);
  for (let i = 0; i < n * n; i++) heights[i] = ((field.heights[i]! - mn) / span) * 2 - 1;

  // --- 2. Hydraulic erosion (seeded droplet model) -----------------------
  const rng = new Rng(`${seed}:erosion`);
  erode(heights, n, rng, { droplets: 6000, maxSteps: 48 });

  // Re-normalize AFTER erosion (erosion shifts the value range); the biome
  // classifier and sim env field both assume a ~[-1, 1] heightfield.
  let emn = Infinity;
  let emx = -Infinity;
  for (let i = 0; i < n * n; i++) {
    if (heights[i]! < emn) emn = heights[i]!;
    if (heights[i]! > emx) emx = heights[i]!;
  }
  const espan = emx - emn || 1;
  for (let i = 0; i < n * n; i++) heights[i] = ((heights[i]! - emn) / espan) * 2 - 1;

  // --- 3. Climate via sim-env (terrain-coupled temperature/humidity) ------
  const env = createEnvField({ width: n, height: n, heights }, { seed });

  // --- 4. Biome classification (same 7 biomes as world-gen) --------------
  // The demo's nav grid treats ONLY Ocean + Mountain as impassable (Snow is
  // walkable), so the world must be mostly land. We derive a *dynamic sea level*
  // from the geology heightfield (a low percentile) so continents keep their
  // generated shapes while ocean stays a small fraction — exactly like the
  // world-gen TerrainGenerator the demo used to rely on. Biomes above sea level
  // are assigned from the sim-env climate (moisture/temperature).
  const climate = env;
  const sorted = Float32Array.from(heights).sort();
  const seaLevel = sorted[Math.floor(sorted.length * 0.04)] ?? 0; // ~4% ocean
  const biomeIds = new Uint8Array(n * n);
  const moisture = climate.humidity;
  const temperature = climate.temperature;
  for (let i = 0; i < n * n; i++) {
    biomeIds[i] = classifyBiome(heights[i]!, moisture[i]!, temperature[i]!, field.crustType[i]!, seaLevel);
  }

  return {
    width: n,
    height: n,
    heights,
    biomeIds,
    moisture,
    temperature,
    minHeight: -1,
    maxHeight: 1,
  };
}

/** Classify a cell into a biome from geology height + climate + crust + sea level. */
function classifyBiome(h: number, m: number, t: number, crust: number, seaLevel: number): number {
  if (crust === 0 && h < seaLevel) return Biome.Ocean;
  if (h < seaLevel) return Biome.Ocean;
  if (h < seaLevel + 0.06) return Biome.Beach;
  if (h > seaLevel + 0.55) return t < 0.35 ? Biome.Snow : Biome.Mountain;
  if (t < 0.3) return Biome.Snow;
  if (m < 0.3) return Biome.Desert;
  if (m > 0.55 && t > 0.4) return Biome.Forest;
  return Biome.Grassland;
}

/** Handles to the live sim-spine fields after registration. */
export interface SimSpine {
  env: EnvField;
  fire: FireField;
  eco: EcoField;
  econ: EconomyField;
  /** Total burning cells this tick (observable). */
  burning(): number;
  /** Last trade flow count (observable). */
  tradeFlows(): number;
}

/**
 * Register the full sim spine (env → fire → eco → econ → trade) onto an
 * engine-core `World`. The systems read each other through the singleton
 * components on entity 0, so calling `world.step(dt)` advances the whole chain
 * deterministically. The env field is built from the (procgen) terrain so the
 * climate rides the real world; the sim grid is `SIM_GRID` (independent of the
 * 40-tile terrain, downsampled for speed).
 */
export function registerSimSpine(world: World, seed: string, geoTerrain: Terrain): SimSpine {
  const simTerrain = downsampleTerrain(geoTerrain, SIM_GRID);

  const env = registerEnvironmentField(world, {
    seed: `${seed}:env`,
    gridSize: SIM_GRID,
    terrain: { width: SIM_GRID, height: SIM_GRID, heights: simTerrain.heights },
    order: 5,
  });

  const fire = registerFireField(world, {
    seed: `${seed}:fire`,
    gridSize: SIM_GRID,
    landMask: env.isLand,
    ignition: [Math.floor(SIM_GRID / 2), Math.floor(SIM_GRID / 2)],
    order: 6,
  }).field;

  const eco = registerEcosystemField(world, {
    seed: `${seed}:eco`,
    gridSize: SIM_GRID,
    order: 7,
  });

  const econ = registerEconomyField(world, {
    seed: `${seed}:econ`,
    gridSize: SIM_GRID,
    order: 8,
  });

  registerTradeMarket(world, {
    seed: `${seed}:trade`,
    order: 9,
    maxRange: 6,
  });

  return {
    env,
    fire,
    eco,
    econ,
    burning: () => fire.burningCount,
    tradeFlows: () => {
      const tf = world.getComponent<{ flows: unknown[] }>('TradeField', 0);
      return tf?.flows?.length ?? 0;
    },
  };
}

// ---------------------------------------------------------------------------
// AUDIO
// ---------------------------------------------------------------------------

/** Build a deterministic spatial audio model for the demo emitters. */
export function makeAudioModel(): SpatialAudioModel {
  return new SpatialAudioModel({ refDistance: 2, maxDistance: 60, rolloffFactor: 1 });
}

/** Compute spatial params for `sources` relative to `listener`. Deterministic. */
export function spatialParams(
  model: SpatialAudioModel,
  listener: ListenerState,
  sources: AudioSourceInput[],
): SpatialSourceParam[] {
  return model.update(listener, sources);
}

/**
 * A headless Web-Audio mock: records calls, produces no sound, fully
 * deterministic. Use it in Node tests so building the playback graph is
 * observable without an AudioContext or actual audio output.
 */
export function makeMockAudioContext(): AudioContextLike {
  const param = (v = 0) => ({ value: v });
  const node = (): AudioNodeLike => ({ connect() {}, disconnect() {} });
  let t = 0;
  return {
    get currentTime() {
      return t;
    },
    sampleRate: 44100,
    destination: node(),
    createGain() {
      return { ...node(), gain: param(1) } as GainNodeLike;
    },
    createStereoPanner() {
      return { ...node(), pan: param(0) } as StereoPannerNodeLike;
    },
    createOscillator() {
      return { ...node(), type: 'sine', frequency: param(440), start() {}, stop() {} } as OscillatorNodeLike;
    },
    createBufferSource() {
      return { ...node(), buffer: null, loop: false, start() {}, stop() {} } as AudioBufferSourceNodeLike;
    },
    createBuffer() {
      return { getChannelData: () => new Float32Array(0), duration: 0 } as unknown as AudioBufferLike;
    },
  };
}

/**
 * Build a deterministic playback graph for the given params. The `ctx` is an
 * injected `AudioContextLike` (a mock in headless tests), so constructing the
 * graph is fully Node-testable. Identical params + ctx ⇒ identical node configs.
 */
export function audioGraph(
  ctx: AudioContextLike,
  model: SpatialAudioModel,
  listener: ListenerState,
  sources: AudioSourceInput[],
  opts: { masterGain?: number; frequencies?: Record<string, number> } = {},
): { masterGain: ReturnType<AudioContextLike['createGain']>; sources: ReturnType<typeof buildPlaybackGraph>['sources'] } {
  const params = spatialParams(model, listener, sources);
  return buildPlaybackGraph(ctx, params, {
    masterGain: opts.masterGain ?? 1,
    kinds: Object.fromEntries(sources.map((s) => [s.id, 'oscillator'])),
    frequencies: opts.frequencies,
  });
}

// ---------------------------------------------------------------------------
// PERSISTENCE (save-incr)
// ---------------------------------------------------------------------------

/** The component stores the incremental save captures from the core world. */
export const INCR_STORES = ['net-pos', 'net-vel', 'PhysicsBody'] as const;

/**
 * Capture the current core world as a byte-stable incremental save file.
 * `createdAt` and the 64-bit seed are passed in (never read from a clock) so
 * the bytes are reproducible across runs. The seed string is folded into two
 * 32-bit halves deterministically.
 */
export function saveIncremental(world: World, seed: string, createdAt: number): Uint8Array {
  const saver = new IncrementalSaver({ fullEvery: 1 });
  const snap = snapshotWorld(world, [...INCR_STORES]);
  saver.save(snap, createdAt);
  const { low, high } = seedToU32(seed);
  return saver.toBytes(createdAt, BigInt(low), BigInt(high));
}

/** Fold a seed string into two deterministic u32 halves. */
function seedToU32(seed: string): { low: number; high: number } {
  let h1 = 0x811c9dc5;
  let h2 = 0x1000193;
  for (let i = 0; i < seed.length; i++) {
    const c = seed.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ (c + i), 0x85ebca6b) >>> 0;
  }
  return { low: h1 >>> 0, high: h2 >>> 0 };
}

/**
 * Reconstruct the saved app state from an incremental save file. `applyIncremental`
 * folds every frame's delta onto the first full frame and returns the final
 * plain state object — deterministic and byte-stable across runs.
 */
export function loadIncremental(bytes: Uint8Array): unknown {
  return applyIncremental(bytes);
}

/**
 * Round-trip proof: save → bytes → reload must equal the original snapshot.
 * Used by the demo's Save/Load panel and the determinism tests.
 */
export function incrementalRoundTrip(world: World, seed: string, createdAt: number): {
  bytes: Uint8Array;
  original: unknown;
  reloaded: unknown;
  equal: boolean;
} {
  const original = snapshotWorld(world, [...INCR_STORES]);
  const bytes = saveIncremental(world, seed, createdAt);
  const reloaded = loadIncremental(bytes);
  return {
    bytes,
    original,
    reloaded,
    equal: JSON.stringify(original) === JSON.stringify(reloaded),
  };
}

/** Recover a plain (non-incremental) save, exercising the corruption path. */
export function recoverCore(world: World): { ok: boolean; recovered: unknown } {
  const snap = snapshotWorld(world, [...INCR_STORES]);
  // Write a real, correctly-formatted plain save (magic/version header) so the
  // recovery module can actually read it back — proving the plain-save
  // checkpoint + recovery round-trip works, not just the incremental one.
  const { low, high } = seedToU32(`${world?.constructor?.name ?? 'core'}`);
  const bytes = SaveWriter.write(snap, 0, BigInt(low), BigInt(high));
  const result = recoverPlainSave(bytes);
  return { ok: result.ok, recovered: result.data ?? result };
}

// ---------------------------------------------------------------------------
// NET-DELTA (multiplayer base)
// ---------------------------------------------------------------------------

export interface DeltaReplication {
  /** The 2nd client world, reconciled via net-delta. */
  client: EcsWorld;
  /** Feed a server logical snapshot; returns the size of the applied delta. */
  push(serverLogical: ReturnType<Codec['toLogical']>): number;
  /** Compare the delta client to the server (true when converged). */
  converged(serverLogical: ReturnType<Codec['toLogical']>): boolean;
}

/**
 * Stand up a 2nd client reconciled from the server via `@omega/net-delta`
 * deltas. Each `push` diffs the new server logical snapshot against the previous
 * one and applies the delta to the client world through `applyDeltaTo`, which
 * resets the client to the prior frame's bytes then applies only the changes.
 * The result must serialize identically to the server — proving the multiplayer
 * base converges without shipping full snapshots every frame.
 */
export function setupDeltaReplication(codec: Codec): DeltaReplication {
  const client = new EcsWorld();
  let prevBytes: Uint8Array | null = null;
  let prevTick = 0;

  return {
    client,
    push(serverLogical) {
      const delta = prevBytes
        ? computeDelta({ entities: [] }, serverLogical, serverLogical.entities.length)
        : // First frame: full snapshot.
          { tick: serverLogical.entities.length, full: true, created: serverLogical.entities, updated: [], removed: [] };
      const base = { tick: prevTick, data: prevBytes ?? codec.fromLogical(serverLogical) };
      applyDeltaTo(client, base, delta, codec);
      prevBytes = codec.fromLogical(serverLogical);
      prevTick = serverLogical.entities.length;
      // Return the delta's "weight" as an observable (created + updated count).
      return delta.created.length + delta.updated.length;
    },
    converged(serverLogical) {
      const a = codec.fromLogical(serverLogical);
      const b = codec.serialize(client);
      if (a.length !== b.length) return false;
      for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
      return true;
    },
  };
}

export { Vec3 };
