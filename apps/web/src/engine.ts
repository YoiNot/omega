/**
 * apps/web — deterministic integration core.
 *
 * Wires the finished integration packages into one runnable, audible loop:
 *
 *   @omega/physics-integration  (PhysicsSimulation + createPhysicsEntity)
 *        -> owns a @omega/engine-core `World` with deterministic rigid-body
 *           bodies falling on a fixed ground plane (fixed-timestep).
 *
 *   @omega/ecs `World` (view world)
 *        -> mirrors the physics bodies into renderable components and holds the
 *           network-replicated entities. Consumed by @omega/render-ecs
 *           `extractDrawList` to produce a deterministic, id-ordered draw list.
 *
 *   @omega/net-replication  (ReplicatedServer + ReplicatedClient)
 *        -> a server-authoritative sim over the net entities, replicated across
 *           an in-process @omega/net `LoopbackTransport`. The client predicts
 *           locally and reconciles against server snapshots; after N ticks the
 *           client world equals the server world — the determinism proof.
 *
 * Input is driven by @omega/input-core + @omega/replay (no more thin stand-in):
 *   - `DemoInput` wraps a live DOM `InputSource` (via `createInputSource`) and,
 *     on every fixed tick, samples a deterministic `InputFrame` with
 *     `collectFrame`, encodes it to the same `Uint8Array` command payload the
 *     loop already consumes, and optionally records the frame into an
 *     `InputBuffer`.
 *   - In headless/replay mode the same `DemoInput` can be fed a pre-recorded
 *     sequence of `InputFrame`s instead of touching the DOM, so the input path
 *     is fully deterministic and replay-safe.
 *
 * The fixed-timestep loop from @omega/time-core (`createScheduler`) is the tick
 * source: `Demo.step` runs exactly one scheduler sub-step, so simulation time is
 * decoupled from wall-clock time and the whole `createDemo` + `step` pipeline
 * stays a pure function of (seed, tick count, input frames) — see the headless
 * determinism + replay tests.
 */

import { Vec3, Vec2 } from '@omega/engine-math';
import { World as CoreWorld, Rng, hashString64 } from '@omega/engine-core';
import { World as EcsWorld, defineComponent } from '@omega/ecs';
import {
  PhysicsSimulation,
  createPhysicsEntity,
  PhysicsBody,
} from '@omega/physics-integration';
import type { RigidBody } from '@omega/physics';
import { createScheduler, type Scheduler } from '@omega/time-core';
import {
  createInputSource,
  collectFrame,
  InputBuffer,
  type InputSource as DomInputSource,
  type InputFrame,
  type Windowish,
} from '@omega/input-core';
import { Recorder, Playback, type Recording } from '@omega/replay';
import {
  Renderable,
  Transform as RenderTransform,
  extractDrawList,
  type DrawItem,
  type RGBA,
} from '@omega/render-ecs';
import {
  Camera,
  ColorGradient,
  computeNormals,
  HeightfieldMeshBuilder,
  defaultPbrMaterial,
  defaultSun,
  buildLodMesh,
  type LodMesh,
  type PbrMaterial,
} from '@omega/render';
import {
  ParticleSystem,
  CloudField,
  defaultParticleConfig,
  defaultCloudConfig,
  cascadesFromCamera,
  type Cascade,
  type ParticleConfig,
  type CloudConfig,
} from '@omega/render-pbr';
import { TerrainGenerator, BIOME_COUNT, Biome } from '@omega/world-gen';
import type { BooleanGrid } from './nav';
import { nearestFreeTile } from './nav';
import { GoapSystem, AGENT_STORE } from './ai';
import {
  GameplaySystem,
  RESOURCE_STORE,
  BLOCKER_STORE,
  WANDERER_STORE,
} from './entities';
import {
  PlayerSystem,
  PLAYER_STORE,
  frameToCommand,
} from './player';
import { InteractionSystem } from './interaction';
import { CraftingSystem } from './crafting';
import { ConstructionSystem, STRUCTURE_STORE } from './construction';
import { buildScenario, applyScenario, type Scenario } from './scenario';
import {
  Codec,
  ReplicatedServer,
  ReplicatedClient,
  type ServerSystem,
} from '@omega/net-replication';
import { LoopbackTransport } from '@omega/net';

// ---------------------------------------------------------------------------
// Components (process-global by name via defineComponent).
//   PBody     — physics body position mirrored into the view world (NOT replicated).
//   NetPos    — network-replicated position (registered in the codec).
//   NetVel    — network-replicated velocity (registered in the codec).
// Renderable + Transform come from @omega/render-ecs for the draw list.
// ---------------------------------------------------------------------------
const PBody = defineComponent<{ x: number; y: number; z: number }>('pbody');
const NetPos = defineComponent<{ x: number; y: number; z: number }>('net-pos');
const NetVel = defineComponent<{ x: number; y: number; z: number }>('net-vel');

// ---------------------------------------------------------------------------
// Frame helpers for the LoopbackTransport demo (tick u32 | len u32 | data).
// ---------------------------------------------------------------------------
export function encodeFrame(tick: number, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(8 + data.length);
  const v = new DataView(out.buffer);
  v.setUint32(0, tick >>> 0, true);
  v.setUint32(4, data.length, true);
  out.set(data, 8);
  return out;
}

export function decodeFrame(f: Uint8Array): { tick: number; data: Uint8Array } {
  const v = new DataView(f.buffer, f.byteOffset, f.byteLength);
  const tick = v.getUint32(0, true);
  const len = v.getUint32(4, true);
  return { tick, data: f.slice(8, 8 + len) };
}

/** Split a string seed into the two decimal u64 words the replay header wants. */
function seedToU64Low(seed: string): bigint {
  const h = hashString64(`${seed}:low`);
  return h & 0xffffffffffffffffn;
}
function seedToU64High(seed: string): bigint {
  const h = hashString64(`${seed}:high`);
  return h & 0xffffffffffffffffn;
}

// ---------------------------------------------------------------------------
// Real input driver on top of @omega/input-core (replaces the old ScriptedInput
// seam). `DemoInput` turns a live DOM `InputSource` into the deterministic
// command payload the simulation loop already consumes:
//   payload = [entityIndex(u32), ix(f32), iy(f32), iz(f32)]
// The entity index is derived from the frame number (deterministic, never from
// the wall clock). `ix/iy/iz` come from a seeded Rng whose state is advanced by
// which keys are held on the sampled `InputFrame`, so two runs with the same
// input frames diverge identically and net reconciliation still converges
// bit-for-bit. In headless/replay mode a pre-recorded `InputFrame` sequence is
// fed instead of the DOM, so the input path is fully deterministic.
// ---------------------------------------------------------------------------

/** A `Windowish` host that produces input frames — live DOM or a headless fake. */
export interface InputHost {
  /** Optional live DOM source (undefined when replaying a recorded script). */
  readonly source?: DomInputSource;
  /** Sample the next frame (advanced by the caller's fixed-timestep index). */
  sample(frame: number): InputFrame;
  /** Tear down any DOM listeners. */
  dispose(): void;
}

/**
 * Build an `InputHost` bound to a live DOM target. Real keyboard/mouse events
 * accumulate in the returned `source.state`; `sample(frame)` funnels them into a
 * deterministic `InputFrame` via `collectFrame` and clears the per-frame edges.
 */
export function createDomInputHost(target: Windowish): InputHost {
  const source = createInputSource(target);
  return {
    source,
    sample(frame: number): InputFrame {
      const f = collectFrame(source.state, frame);
      source.state.beginFrame();
      return f;
    },
    dispose(): void {
      source.dispose();
    },
  };
}

/**
 * Build an `InputHost` that replays a pre-recorded, deterministic list of
 * `InputFrame`s (e.g. captured headlessly). Used by the replay test so no DOM
 * is touched and the exact same frames drive the loop.
 */
export function createReplayInputHost(frames: readonly InputFrame[]): InputHost {
  let i = 0;
  return {
    sample(frame: number): InputFrame {
      const f = frames[i] ?? { frame, heldKeys: new Uint32Array(), pressedKeys: new Uint32Array(), releasedKeys: new Uint32Array(), mouseX: 0, mouseY: 0, mouseButtons: 0, mousePressed: 0, mouseReleased: 0, wheel: 0 };
      i = Math.min(i + 1, frames.length);
      return { ...f, frame };
    },
    dispose(): void {
      /* no DOM to tear down */
    },
  };
}

/**
 * Deterministic input driver. Wraps an `InputHost` and turns each fixed tick
 * into the `Uint8Array` command payload the loop consumes. The entity index is
 * the frame index modulo entity count; the impulse vector is drawn from a
 * seeded `Rng` advanced by the number of currently-held keys (so identical
 * frames ⇒ identical impulses ⇒ identical simulation). Every sampled frame is
 * also pushed into an `InputBuffer` so the exact run can be replayed.
 */
export class DemoInput {
  private readonly host: InputHost;
  private readonly rng: Rng;
  private readonly entityCount: number;
  private readonly buffer = new InputBuffer(1 << 20);
  private frame = 0;

  constructor(host: InputHost, seed: string, entityCount: number) {
    this.host = host;
    this.rng = new Rng(seed);
    this.entityCount = entityCount;
  }

  /** The live DOM source (if any) for callers that want to introspect state. */
  get source(): DomInputSource | undefined {
    return this.host.source;
  }

  /** All sampled frames recorded so far, oldest first. */
  recordedFrames(): readonly InputFrame[] {
    return this.buffer.toArray();
  }

  /** Sample the host's next input frame for the given tick (replay-safe). */
  sampleInput(frame: number): InputFrame {
    return this.host.sample(frame);
  }

  /** Advance one input tick and return the next command payload. */
  next(): Uint8Array {
    const frame = this.frame++;
    const f = this.host.sample(frame);
    this.buffer.push(f);
    // Drive the (still-seeded) Rng from the held-key set so the impulse vector
    // is a pure function of the frame's input state, never of wall-clock time.
    const heldN = f.heldKeys.length;
    for (let k = 0; k < heldN; k++) this.rng.nextU64();
    const entity = frame % Math.max(1, this.entityCount);
    const ix = this.rng.nextRange(-1, 1);
    const iy = this.rng.nextRange(0.5, 1.5); // bias upward so spheres keep hopping
    const iz = this.rng.nextRange(-1, 1);
    const arr = new Float32Array([entity, ix, iy, iz]);
    return new Uint8Array(arr.buffer.slice(0));
  }
}

// ---------------------------------------------------------------------------
// Net command-application + integration systems (run on BOTH server & client
// worlds so reconciliation is bit-for-bit). Pure functions of (world, cmd).
// ---------------------------------------------------------------------------
function readIntent(payload: Uint8Array): { entity: number; ix: number; iy: number; iz: number } {
  if (payload.byteLength < 16) return { entity: 0, ix: 0, iy: 0, iz: 0 };
  const f = new Float32Array(payload.buffer, payload.byteOffset, 4);
  return { entity: Math.round(f[0]), ix: f[1], iy: f[2], iz: f[3] };
}

/** Apply a movement intent as a velocity impulse on the targeted entity. */
export const applyInput: ServerSystem = (world, cmd) => {
  if (!cmd) return;
  const intent = readIntent(cmd.payload);
  if (!world.isAlive(intent.entity)) return;
  const cur = world.getComponent(intent.entity, NetVel) ?? { x: 0, y: 0, z: 0 };
  world.setComponent(intent.entity, NetVel, {
    x: cur.x + intent.ix,
    y: cur.y + intent.iy,
    z: cur.z + intent.iz,
  });
};

/** Integrate velocity into position every fixed step (registered as a system). */
function registerIntegration(world: EcsWorld): void {
  world.registerSystem((w, dt) => {
    for (const id of w.entities()) {
      const v = w.getComponent(id, NetVel);
      const p = w.getComponent(id, NetPos);
      if (v && p) {
        w.setComponent(id, NetPos, { x: p.x + v.x * dt, y: p.y + v.y * dt, z: p.z + v.z * dt });
      }
    }
  }, 0, 'net-integrate');
}

// ---------------------------------------------------------------------------
// Demo assembly.
// ---------------------------------------------------------------------------
export interface DemoOptions {
  seed: string;
  terrainSize?: number;
  dynamicBodies?: number;
  staticPegs?: number;
  netEntities?: number;
  fixedDt?: number;
  gravity?: [number, number, number];
  /** Provide a custom input host (e.g. a headless replay host). Defaults to a DOM source. */
  inputHost?: InputHost;
  /** When true, attach an optional @omega/replay `Recorder` that snapshots the physics world each tick. */
  record?: boolean;
  /** Number of GOAP agents to spawn on the nav grid (deterministic). Default 2. */
  agents?: number;
  /** Number of resource nodes for the gameplay scenario. Default 4. */
  resources?: number;
  /** Number of roaming dynamic blockers. Default 2. */
  blockers?: number;
  /** Number of wandering scouts. Default 3. */
  wanderers?: number;
  /** When true, include the gameplay entity content (resource/blocker/wanderer + agents). Default true. */
  gameplay?: boolean;
  /** When true, spawn the player controller + interaction/crafting/construction systems. Default true. */
  player?: boolean;
  /** Interaction radius (tiles, Chebyshev) for the player. Default 2. */
  interactRadius?: number;
  /** FOV half-angle (radians) for the player; 0 disables FOV. Default 0 (omnidirectional). */
  interactFov?: number;
}

export interface ObservableBody {
  id: number;
  x: number;
  y: number;
  z: number;
}

export interface Demo {
  coreWorld: CoreWorld;
  physicsSim: PhysicsSimulation;
  viewWorld: EcsWorld;
  netServer: EcsWorld;
  netClient: EcsWorld;
  server: ReplicatedServer;
  client: ReplicatedClient;
  transport: LoopbackTransport;
  input: DemoInput;
  /** Fixed-timestep scheduler from @omega/time-core (the tick source). */
  scheduler: Scheduler;
  /** Optional replay recorder (records a world snapshot per fixed tick). */
  recorder?: Recorder;
  /** Deterministic GOAP AI system (agents plan + navigate the nav grid). */
  goap: GoapSystem;
  /** Navigation grid derived from the seeded terrain biomes. */
  navGrid: BooleanGrid;
  fixedDt: number;
  terrainSeed: string;
  /** Advance the whole loop by one fixed tick (one scheduler sub-step). */
  step(): void;
  /** Deterministic, id-ordered draw list for the current view world. */
  drawList(): DrawItem[];
  /** Visual radius (world units) of a view-world entity id, for the overlay. */
  radiusOf(entity: number): number;
  /** Observable physics body positions (ascending core id). */
  physicsPositions(): ObservableBody[];
  /** Observable net positions on the authoritative (server) world. */
  netPositionsServer(): ObservableBody[];
  /** Observable net positions on the reconciled (client) world. */
  netPositionsClient(): ObservableBody[];
  /** Observable GOAP agent tile positions (ascending entity id). */
  agentPositions(): { id: number; tx: number; tz: number; delivered: number }[];
  /** Planned action names for agent `entity` (deterministic GOAP plan). */
  agentPlan(entity: number): string[];
  /** Deterministic gameplay system (resource/blocker/wanderer entities). */
  gameplay: GameplaySystem;
  /** Deterministic player controller + interaction/crafting/construction systems (Roadmap §15). */
  player: PlayerSystem;
  interaction: InteractionSystem;
  crafting: CraftingSystem;
  construction: ConstructionSystem;
  /** Map a tile to its biome id (for construction validation). */
  biomeAt(tx: number, tz: number): number;
  /** The seed-built scenario (world + entity placement). */
  scenario: Scenario;
  /** PBR material used by the demo terrain (deterministic default). */
  pbrMaterial: PbrMaterial;
  /** LOD chain of the terrain (fine + coarse levels). */
  terrainLod: LodMesh;
  /** GPU particle system (seeded; pure function of seed + ticks). */
  particles: ParticleSystem;
  /** Volumetric cloud field (seeded density grid). */
  clouds: CloudField;
  /** Cached cascaded-shadow cascades for a camera (rebuilt on demand). */
  shadows(camera: import('@omega/render').Camera): Cascade[];
  /** Advance the particle sim one tick (deterministic). */
  stepParticles(): void;
  /** Deterministic, id-ordered draw list for the current view world. */
  resourcePositions(): { id: number; tx: number; tz: number; amount: number }[];
  /** Observable dynamic blocker positions (ascending entity id). */
  blockerPositions(): { id: number; tx: number; tz: number }[];
  /** Observable wanderer positions + gathered total (ascending entity id). */
  wandererPositions(): { id: number; tx: number; tz: number; gathered: number }[];
  /** Observable player position + state (ascending entity id). */
  playerPositions(): { id: number; tx: number; tz: number; facing: string; hasResource: number; delivered: number }[];
  /** Observable placed structures (ascending entity id). */
  structures(): { id: number; tx: number; tz: number; kind: string }[];
  /** Deterministically query what the player can interact with right now. */
  interactables(): { id: number; tx: number; tz: number }[];
  startRecording(): void;
  /** Stop capturing world snapshots. */
  stopRecording(): void;
  /** True while the recorder is actively capturing frames. */
  isRecording(): boolean;
}

export function createDemo(opts: DemoOptions): Demo {
  const seed = opts.seed;
  const terrainSize = opts.terrainSize ?? 40;
  const dynamicBodies = opts.dynamicBodies ?? 7;
  const staticPegs = opts.staticPegs ?? 4;
  const netEntities = opts.netEntities ?? 5;
  const fixedDt = opts.fixedDt ?? 1 / 60;
  const gravity = opts.gravity ?? [0, -9.81, 0];
  const agentCount = opts.agents ?? 2;
  const resourceCount = opts.resources ?? 4;
  const blockerCount = opts.blockers ?? 2;
  const wandererCount = opts.wanderers ?? 3;
  const withGameplay = opts.gameplay ?? true;
  const withPlayer = opts.player ?? true;
  const interactRadius = opts.interactRadius ?? 2;
  const interactFov = opts.interactFov ?? 0;

  // --- 1. Local deterministic physics (engine-core World) -----------------
  const coreWorld = new CoreWorld();
  const physicsSim = new PhysicsSimulation(coreWorld, {
    sim: { fixedDt },
    physics: { gravity: new Vec3(gravity[0], gravity[1], gravity[2]), groundY: 0 },
  });

  const rng = new Rng(seed);
  const coreBodyIds: number[] = [];
  const bodyRadii: number[] = [];
  const half = terrainSize / 2;

  // Static pegs on the ground — a deterministic ring around the centre.
  for (let i = 0; i < staticPegs; i++) {
    const a = (i / staticPegs) * Math.PI * 2;
    const r = half * 0.55;
    const id = createPhysicsEntity(coreWorld, {
      position: new Vec3(Math.cos(a) * r + half, 0.5, Math.sin(a) * r + half),
      radius: 0.8,
      isStatic: true,
    });
    coreBodyIds.push(id);
    bodyRadii.push(0.8);
  }
  // Dynamic spheres dropped from above with a small seeded scatter.
  for (let i = 0; i < dynamicBodies; i++) {
    const px = half + rng.nextRange(-half * 0.4, half * 0.4);
    const pz = half + rng.nextRange(-half * 0.4, half * 0.4);
    const py = 6 + rng.nextRange(0, 6);
    const rad = rng.nextRange(0.4, 0.7);
    const id = createPhysicsEntity(coreWorld, {
      position: new Vec3(px, py, pz),
      radius: rad,
      restitution: 0.6,
      mass: 1,
    });
    coreBodyIds.push(id);
    bodyRadii.push(rad);
  }

  // --- 2. View world (ecs) holds physics-mirror + net-render entities ------
  const viewWorld = new EcsWorld();
  const viewPhysicsIds: number[] = [];
  const viewNetIds: number[] = [];
  const viewRadius = new Map<number, number>();

  // Physics-mirror entities (color: cyan→orange by index).
  const physPalette: RGBA[] = [
    [120, 220, 255, 255],
    [255, 180, 90, 255],
    [150, 255, 200, 255],
    [255, 220, 120, 255],
  ];
  for (let i = 0; i < coreBodyIds.length; i++) {
    const id = viewWorld.createEntity();
    viewPhysicsIds.push(id);
    viewRadius.set(id, bodyRadii[i]!);
    viewWorld.addComponent(id, PBody, { x: 0, y: 0, z: 0 });
    viewWorld.addComponent(id, Renderable, {
      meshId: 'sphere',
      color: physPalette[i % physPalette.length]!,
    });
    viewWorld.addComponent(id, RenderTransform, {
      pos: new Vec3(0, 0, 0),
      scale: new Vec3(bodyRadii[i]!, bodyRadii[i]!, bodyRadii[i]!),
    });
  }

  // Net-render entities (color: magenta→green), mirrored from the server world.
  const netPalette: RGBA[] = [
    [255, 110, 200, 255],
    [120, 255, 140, 255],
    [255, 140, 120, 255],
    [160, 180, 255, 255],
    [255, 255, 120, 255],
  ];
  for (let i = 0; i < netEntities; i++) {
    const id = viewWorld.createEntity();
    viewNetIds.push(id);
    viewRadius.set(id, 0.6);
    viewWorld.addComponent(id, Renderable, {
      meshId: 'net',
      color: netPalette[i % netPalette.length]!,
    });
    viewWorld.addComponent(id, RenderTransform, {
      pos: new Vec3(0, 0, 0),
      scale: new Vec3(0.6, 0.6, 0.6),
    });
  }

  // --- 3. Net-replication worlds (server + client) ------------------------
  const codec = new Codec();
  codec.registerComponent(NetPos, 'net-pos');
  codec.registerComponent(NetVel, 'net-vel');

  const netServer = new EcsWorld();
  const netClient = new EcsWorld();
  const netSeedRng = new Rng(`${seed}:net`);
  const netStart: { x: number; y: number; z: number }[] = [];
  for (let i = 0; i < netEntities; i++) {
    const a = (i / netEntities) * Math.PI * 2;
    const r = half * 0.35;
    netStart.push({
      x: Math.cos(a) * r + half,
      y: 1.5,
      z: Math.sin(a) * r + half,
    });
  }
  for (let i = 0; i < netEntities; i++) {
    const s = netStart[i]!;
    const sId = netServer.createEntity();
    netServer.addComponent(sId, NetPos, { ...s });
    netServer.addComponent(sId, NetVel, {
      x: netSeedRng.nextRange(-0.5, 0.5),
      y: 0,
      z: netSeedRng.nextRange(-0.5, 0.5),
    });
    const cId = netClient.createEntity();
    netClient.addComponent(cId, NetPos, { ...s });
    netClient.addComponent(cId, NetVel, { x: 0, y: 0, z: 0 });
  }
  // Integration must run on BOTH worlds so the client's replay is identical.
  registerIntegration(netServer);
  registerIntegration(netClient);

  const server = new ReplicatedServer(netServer, codec, { dt: fixedDt, systems: [applyInput] });
  const client = new ReplicatedClient(netClient, codec, { dt: fixedDt, systems: [applyInput] });
  // Seed the client from the server's initial authoritative snapshot.
  client.onSnapshot(server.snapshot());

  const transport = new LoopbackTransport();
  transport.onMessage((frame) => {
    const { tick, data } = decodeFrame(frame);
    client.onSnapshot({ tick, data });
  });

  // --- input-core: real DOM-bound input source (or a headless replay host) ---
  // In a real browser `globalThis` is a `Windowish` with addEventListener, so we
  // bind the live source. In a headless/node environment (the determinism test)
  // there is no DOM, so we fall back to a deterministic empty replay host — the
  // input path stays a pure function of the seeded Rng either way.
  const g = globalThis as unknown as Windowish;
  const inputHost =
    opts.inputHost ?? (typeof g.addEventListener === 'function' ? createDomInputHost(g) : createReplayInputHost([]));
  const input = new DemoInput(inputHost, `${seed}:input`, netEntities);

  // --- time-core: fixed-timestep scheduler is the tick source ---
  const scheduler = createScheduler({ dt: fixedDt, maxSubSteps: 5 });

  // --- nav-core + biome rules: build a navigation grid from the seeded terrain ---
  // The agents walk this grid; impassable biomes (ocean/mountain/snow) are
  // The deterministic gameplay scenario: world + resource/blocker/wanderer
  // placements, all derived from the seed (see scenario.ts).
  const scenario = buildScenario(seed, terrainSize, {
    resources: resourceCount,
    blockers: blockerCount,
    wanderers: wandererCount,
    agents: agentCount,
  });
  // `navGrid` stays the canonical plain blocked-flag grid (used by the existing
  // nav tests / replay identity). The GOAP agents + wanderers navigate the
  // LIVE grid so they route around the roaming blockers.
  const navGrid: BooleanGrid = scenario.navGrid as BooleanGrid;
  const liveGrid = scenario.liveGrid;

  // --- ai-goap: spawn GOAP agents that plan (deliver a resource) + navigate ---
  // Locations are deterministic tiles derived from the scenario (no RNG), so the
  // plan and every A* path are pure functions of the seed. Agents navigate the
  // live grid, so a blocker on their route forces a deterministic re-route.
  const goap = new GoapSystem(coreWorld, liveGrid);
  // GOAP agents are spawned by applyScenario (below) from the deterministic
  // scenario's agentTiles, so the whole placement stays a pure function of seed.

  // --- gameplay: deterministic resource / blocker / wanderer entities --------
  // Driven by the same time-core scheduler as everything else; reads the shared
  // live grid so all movers see the blockers. Lives in the SAME engine-core
  // world the recorder snapshots, so it is fully record/replay-deterministic.
  const gameplay = new GameplaySystem(coreWorld, liveGrid);
  if (withGameplay) {
    applyScenario(scenario, gameplay, (s, r, b) => goap.spawnAgent(s, r, b));
  }

  // --- player + interaction/crafting/construction (Roadmap §15) --------------
  // The player lives in the SAME engine-core world the recorder snapshots, so
  // it is fully record/replay-deterministic. The structure store does NOT add a
  // `PhysicsBody`, so the physics/fixed-tick trajectory stays byte-identical to
  // the pre-§15 `runHeadless` oracle; placed structures instead block the LIVE
  // nav grid (reused by agents + wanderers) — emergence, no separate world.
  const scenarioBase = scenario.agentBaseTile;
  const playerSys = new PlayerSystem(coreWorld, liveGrid, scenarioBase);
  if (withPlayer) {
    // Spawn the player on a free tile near the base (deterministic).
    const pstart = nearestFreeTile(liveGrid, scenarioBase.x, scenarioBase.y) ?? scenarioBase;
    playerSys.spawnPlayer(new Vec2(pstart.x, pstart.y));
  }
  const interactionSys = new InteractionSystem();
  const craftingSys = new CraftingSystem();
  const constructionSys = new ConstructionSystem(
    coreWorld,
    liveGrid,
    (tx, tz) => scenario.biomeGrid.biomes[tz * scenario.size + tx] ?? Biome.Grassland,
  );
  // --- view-world (ecs) render proxies for the gameplay entities -----------
  // Each resource/blocker/wanderer gets a deterministic renderable entity (a
  // coloured cube/sphere) so the demo visibly shows the new content. Positions
  // are mirrored from the authoritative engine-core world every tick in syncView.
  const viewResourceIds: number[] = [];
  const viewBlockerIds: number[] = [];
  const viewWandererIds: number[] = [];
  if (withGameplay) {
    const resPalette: RGBA[] = [
      [255, 215, 0, 255], // gold resource
      [255, 170, 0, 255],
      [255, 240, 120, 255],
      [230, 200, 40, 255],
    ];
    for (let i = 0; i < scenario.resourceTiles.length; i++) {
      const id = viewWorld.createEntity();
      viewResourceIds.push(id);
      viewWorld.addComponent(id, Renderable, { meshId: 'cube', color: resPalette[i % resPalette.length]! });
      viewWorld.addComponent(id, RenderTransform, { pos: new Vec3(0, 0.5, 0), scale: new Vec3(0.7, 0.7, 0.7) });
      viewRadius.set(id, 0.7);
    }
    const blkPalette: RGBA[] = [
      [200, 60, 60, 255], // red roaming blocker
      [160, 40, 200, 255],
    ];
    for (let i = 0; i < scenario.blockerTiles.length; i++) {
      const id = viewWorld.createEntity();
      viewBlockerIds.push(id);
      viewWorld.addComponent(id, Renderable, { meshId: 'cube', color: blkPalette[i % blkPalette.length]! });
      viewWorld.addComponent(id, RenderTransform, { pos: new Vec3(0, 0.6, 0), scale: new Vec3(0.9, 0.9, 0.9) });
      viewRadius.set(id, 0.9);
    }
    const wanPalette: RGBA[] = [
      [120, 220, 255, 255], // cyan scout
      [120, 255, 200, 255],
      [200, 255, 120, 255],
    ];
    for (let i = 0; i < scenario.wandererTiles.length; i++) {
      const id = viewWorld.createEntity();
      viewWandererIds.push(id);
      viewWorld.addComponent(id, Renderable, { meshId: 'sphere', color: wanPalette[i % wanPalette.length]! });
      viewWorld.addComponent(id, RenderTransform, { pos: new Vec3(0, 0.5, 0), scale: new Vec3(0.6, 0.6, 0.6) });
      viewRadius.set(id, 0.6);
    }
  }

  // --- replay: recorder that snapshots the physics + agent + gameplay world ---
  // Always constructed so the UI can Record/Stop at runtime; capture is gated by
  // `recording` (initialised from opts.record for the headless record harness).
  // The gameplay stores (resource/blocker/wanderer) are recorded alongside the
  // physics bodies + GOAP agents so playback rebuilds the full observable world.
  const recorder = new Recorder(
    [PhysicsBody.name, AGENT_STORE, RESOURCE_STORE, BLOCKER_STORE, WANDERER_STORE, PLAYER_STORE, STRUCTURE_STORE],
    {
      seedLow: seedToU64Low(seed),
      seedHigh: seedToU64High(seed),
    },
  );
  let recording = opts.record ?? false;

  // --- 4. Per-tick sync of the view world from physics + net server --------
  function syncView(): void {
    for (let k = 0; k < coreBodyIds.length; k++) {
      const coreId = coreBodyIds[k]!;
      const body = coreWorld.getComponent(PhysicsBody.name, coreId) as RigidBody | undefined;
      const viewId = viewPhysicsIds[k]!;
      if (!body) continue;
      viewWorld.setComponent(viewId, PBody, { x: body.position.x, y: body.position.y, z: body.position.z });
      viewWorld.setComponent(viewId, RenderTransform, {
        pos: new Vec3(body.position.x, body.position.y, body.position.z),
        scale: new Vec3(bodyRadii[k]!, bodyRadii[k]!, bodyRadii[k]!),
      });
    }
    for (let i = 0; i < netEntities; i++) {
      const p = netServer.getComponent(i, NetPos);
      const viewId = viewNetIds[i]!;
      if (!p) continue;
      viewWorld.setComponent(viewId, RenderTransform, {
        pos: new Vec3(p.x, p.y, p.z),
        scale: new Vec3(0.6, 0.6, 0.6),
      });
    }
    // Gameplay render proxies: mirror authoritative tile positions into world
    // space (tile + 0.5 centre, as in nav.ts tileToWorld).
    for (let i = 0; i < viewResourceIds.length; i++) {
      const c = gameplay.resources()[i];
      const viewId = viewResourceIds[i]!;
      if (!c) continue;
      viewWorld.setComponent(viewId, RenderTransform, {
        pos: new Vec3(c.tx + 0.5, 0.5, c.tz + 0.5),
        scale: new Vec3(0.7, 0.7, 0.7),
      });
    }
    for (let i = 0; i < viewBlockerIds.length; i++) {
      const c = gameplay.blockers()[i];
      const viewId = viewBlockerIds[i]!;
      if (!c) continue;
      viewWorld.setComponent(viewId, RenderTransform, {
        pos: new Vec3(c.tx + 0.5, 0.6, c.tz + 0.5),
        scale: new Vec3(0.9, 0.9, 0.9),
      });
    }
    for (let i = 0; i < viewWandererIds.length; i++) {
      const c = gameplay.wanderers()[i];
      const viewId = viewWandererIds[i]!;
      if (!c) continue;
      viewWorld.setComponent(viewId, RenderTransform, {
        pos: new Vec3(c.tx + 0.5, 0.5, c.tz + 0.5),
        scale: new Vec3(0.6, 0.6, 0.6),
      });
    }
  }

  // --- PBR terrain material + LOD chain + particles + clouds -----------
  // All deterministic (seeded), so the same world always produces the same
  // PBR/particle/cloud/LOD command encodings (no hidden RNG/time).
  const pbrMaterial = defaultPbrMaterial();
  pbrMaterial.albedo = [0.42, 0.46, 0.5]; // stone-grey terrain
  pbrMaterial.roughness = 0.78;
  pbrMaterial.metallic = 0.02;

  // Build a 2-level LOD chain from the seeded terrain: full-res + a
  // half-res coarse version. Index 0 = fine, 1 = coarse.
  const terrain = new TerrainGenerator(seed, { size: terrainSize }).generate();
  const fine = new HeightfieldMeshBuilder(terrain.heights, terrain.width, terrain.height, 8).build();
  const coarseW = Math.max(2, Math.floor(terrain.width / 2));
  const coarseH = Math.max(2, Math.floor(terrain.height / 2));
  const coarseHeights = new Float32Array(coarseW * coarseH);
  for (let z = 0; z < coarseH; z++) {
    for (let x = 0; x < coarseW; x++) {
      const sx = Math.min(terrain.width - 1, x * 2);
      const sz = Math.min(terrain.height - 1, z * 2);
      coarseHeights[z * coarseW + x] = terrain.heights[sz * terrain.width + sx]!;
    }
  }
  const coarse = new HeightfieldMeshBuilder(coarseHeights, coarseW, coarseH, 8).build();
  const terrainLod = buildLodMesh(
    'terrain',
    { x: terrainSize / 2, y: 0, z: terrainSize / 2 },
    [{ mesh: fine }, { mesh: coarse }],
  );

  // Seeded GPU particle fountain (deterministic up to tick count).
  const particleCfg: ParticleConfig = { ...defaultParticleConfig(), origin: [terrainSize / 2, 1.5, terrainSize / 2] };
  const particles = new ParticleSystem(`${seed}:particles`, particleCfg);

  // Seeded volumetric cloud field (deterministic density grid).
  const cloudCfg: CloudConfig = { ...defaultCloudConfig(), size: terrainSize * 2 };
  const clouds = new CloudField(`${seed}:clouds`, cloudCfg);

  const demo: Demo = {
    coreWorld,
    physicsSim,
    viewWorld,
    netServer,
    netClient,
    server,
    client,
    transport,
    input,
    scheduler,
    recorder,
    goap,
    navGrid,
    fixedDt,
    terrainSeed: seed,
    gameplay,
    player: playerSys,
    interaction: interactionSys,
    crafting: craftingSys,
    construction: constructionSys,
    biomeAt(tx: number, tz: number): number {
      return scenario.biomeGrid.biomes[tz * scenario.size + tx] ?? Biome.Grassland;
    },
    scenario,
    pbrMaterial,
    terrainLod,
    particles,
    clouds,
    shadows(camera: import('@omega/render').Camera): Cascade[] {
      return cascadesFromCamera(
        camera,
        defaultSun().direction,
        { cascades: defaultSun().shadows?.cascades ?? 4, lambda: defaultSun().shadows?.lambda ?? 0.6, texelSize: defaultSun().shadows?.texelSize ?? 1 },
      );
    },
    stepParticles(): void {
      this.particles.step();
    },
    step(): void {
      // One fixed-timestep sub-step from @omega/time-core drives the tick. The
      // scheduler owns the frame index; we do NOT read a wall clock here.
      scheduler.step(fixedDt, () => {
        // (a) advance local physics one fixed step
        coreWorld.step(fixedDt);
        // (a2) advance GOAP agents one tile along their planned nav route
        goap.step();
        // (a3) advance gameplay entities (resource/blocker/wanderer) one tick.
        // They read the shared live nav grid (with the blockers) so everyone
        // re-routes around the roaming obstacles deterministically.
        gameplay.step(scheduler.frame);
        // (a4) advance the player controller one tile from the current input
        // frame. The command is a pure function of (input frame, player tile),
        // so identical inputs ⇒ identical player trajectory. The player shares
        // the live nav grid, so it cannot desync from the recorded world.
        if (withPlayer) {
          const pcomp = playerSys.players()[0];
          const frame = input.sampleInput(scheduler.frame);
          const cmd = pcomp
            ? frameToCommand(frame, new Vec2(pcomp.tx, pcomp.tz))
            : { frame: scheduler.frame, dx: 0, dz: 0, action: false };
          playerSys.step(cmd);
        }
        // (b) input -> client predicts, server simulates, snapshot reconciles
        const payload = input.next();
        const cmd = client.sendIntent(payload);
        server.onCommand(cmd);
        const snap = server.advance();
        transport.send(encodeFrame(snap.tick, snap.data));
        transport.tick();
        // (c) record an optional world snapshot for replay
        if (recording) recorder.recordFrame(coreWorld, scheduler.frame - 1, fixedDt);
        // (d) mirror observable state into the view world for rendering
        syncView();
      });
    },
    drawList(): DrawItem[] {
      return extractDrawList(viewWorld);
    },
    radiusOf(entity: number): number {
      return viewRadius.get(entity) ?? 0.5;
    },
    physicsPositions(): ObservableBody[] {
      const out: ObservableBody[] = [];
      for (const id of coreBodyIds) {
        const b = coreWorld.getComponent(PhysicsBody.name, id) as RigidBody | undefined;
        if (b) out.push({ id, x: b.position.x, y: b.position.y, z: b.position.z });
      }
      return out;
    },
    netPositionsServer(): ObservableBody[] {
      const out: ObservableBody[] = [];
      for (let i = 0; i < netEntities; i++) {
        const p = netServer.getComponent(i, NetPos);
        if (p) out.push({ id: i, x: p.x, y: p.y, z: p.z });
      }
      return out;
    },
    netPositionsClient(): ObservableBody[] {
      const out: ObservableBody[] = [];
      for (let i = 0; i < netEntities; i++) {
        const p = netClient.getComponent(i, NetPos);
        if (p) out.push({ id: i, x: p.x, y: p.y, z: p.z });
      }
      return out;
    },
    agentPositions() {
      return goap.positions();
    },
    agentPlan(entity: number): string[] {
      return goap.planNames(entity);
    },
    resourcePositions() {
      return gameplay.resources();
    },
    blockerPositions() {
      return gameplay.blockers();
    },
    wandererPositions() {
      return gameplay.wanderers();
    },
    playerPositions() {
      return playerSys.players();
    },
    structures() {
      return constructionSys.structures();
    },
    interactables() {
      const p = playerSys.players()[0];
      if (!p) return [];
      // Build the candidate target set from resources + structures + blockers.
      const targets: { id: number; tx: number; tz: number }[] = [];
      for (const r of gameplay.resources()) targets.push({ id: 100000 + r.id, tx: r.tx, tz: r.tz });
      for (const s of constructionSys.structures()) targets.push({ id: 200000 + s.id, tx: s.tx, tz: s.tz });
      for (const b of gameplay.blockers()) targets.push({ id: 300000 + b.id, tx: b.tx, tz: b.tz });
      return interactionSys.query(p.tx, p.tz, p.facing, targets, interactRadius, interactFov);
    },
    startRecording(): void {
      recorder.clear();
      recording = true;
    },
    stopRecording(): void {
      recording = false;
    },
    isRecording(): boolean {
      return recording;
    },
  };
  return demo;
}

/**
 * Headless determinism harness: build a demo from `seed`, run `ticks` fixed
 * steps feeding the deterministic input script, and return the compact
 * observable state. Two runs with the same seed MUST return structurally
 * identical numbers (the determinism contract).
 */
export interface HeadlessResult {
  physics: number[][]; // [id, x, y, z] per body
  netServer: number[][];
  netClient: number[][];
  agents: number[][]; // [id, tx, tz, delivered] per GOAP agent
  resources: number[][]; // [id, tx, tz, amount] per resource node
  blockers: number[][]; // [id, tx, tz] per roaming blocker
  wanderers: number[][]; // [id, tx, tz, gathered] per wandering scout
  players: number[][]; // [id, tx, tz, hasResource, delivered] per player
  structures: number[][]; // [id, tx, tz] per placed structure
}

export function runHeadless(
  seed: string,
  ticks: number,
  opts: Partial<DemoOptions> = {},
): HeadlessResult {
  const demo = createDemo({ seed, ...opts });
  for (let t = 0; t < ticks; t++) demo.step();
  const round = (n: number) => Math.round(n * 1e6) / 1e6;
  const pack = (b: ObservableBody[]) => b.map((e) => [e.id, round(e.x), round(e.y), round(e.z)]);
  return {
    physics: pack(demo.physicsPositions()),
    netServer: pack(demo.netPositionsServer()),
    netClient: pack(demo.netPositionsClient()),
    agents: demo.agentPositions().map((a) => [a.id, a.tx, a.tz, a.delivered]),
    resources: demo.resourcePositions().map((r) => [r.id, r.tx, r.tz, r.amount]),
    blockers: demo.blockerPositions().map((b) => [b.id, b.tx, b.tz]),
    wanderers: demo.wandererPositions().map((w) => [w.id, w.tx, w.tz, w.gathered]),
    players: demo.playerPositions().map((p) => [p.id, p.tx, p.tz, p.hasResource, p.delivered]),
    structures: demo.structures().map((s) => [s.id, s.tx, s.tz]),
  };
}

/**
 * Record a headless demo run into a deterministic @omega/replay `Recording` and
 * return it (plus the final observable state). The recorder snapshots the
 * physics world every fixed tick, so the exact same trajectory can be rebuilt
 * from the recording alone.
 */
export function recordHeadless(
  seed: string,
  ticks: number,
  opts: Partial<DemoOptions> = {},
): { recording: Recording; result: HeadlessResult } {
  const demo = createDemo({ seed, record: true, ...opts });
  for (let t = 0; t < ticks; t++) demo.step();
  const rec = demo.recorder?.toRecording();
  if (!rec) throw new Error('recordHeadless: recorder was not attached');
  const round = (n: number) => Math.round(n * 1e6) / 1e6;
  const pack = (b: ObservableBody[]) => b.map((e) => [e.id, round(e.x), round(e.y), round(e.z)]);
  return {
    recording: rec,
    result: {
      physics: pack(demo.physicsPositions()),
      netServer: pack(demo.netPositionsServer()),
      netClient: pack(demo.netPositionsClient()),
      agents: demo.agentPositions().map((a) => [a.id, a.tx, a.tz, a.delivered]),
      resources: demo.resourcePositions().map((r) => [r.id, r.tx, r.tz, r.amount]),
      blockers: demo.blockerPositions().map((b) => [b.id, b.tx, b.tz]),
      wanderers: demo.wandererPositions().map((w) => [w.id, w.tx, w.tz, w.gathered]),
      players: demo.playerPositions().map((p) => [p.id, p.tx, p.tz, p.hasResource, p.delivered]),
      structures: demo.structures().map((s) => [s.id, s.tx, s.tz]),
    },
  };
}

/**
 * Determinism proof for the replay path: feed the recorded world snapshots
 * through `Playback` and return the observable state reconstructed at the final
 * tick. Given the same `Recording`, `Playback` rebuilds the world to the exact
 * same positions bit-for-bit as the live run (input→record→replay→play).
 */
export function replayHeadless(
  recording: Recording,
  ticks: number,
): HeadlessResult {
  const world = new CoreWorld();
  // The recording snapshots the physics bodies, GOAP agents AND the gameplay
  // entities (resource/blocker/wanderer), so playback rebuilds the full
  // observable world (physics + AI + gameplay) tick-for-tick.
  const playback = new Playback(recording, world, [
    PhysicsBody.name,
    AGENT_STORE,
    RESOURCE_STORE,
    BLOCKER_STORE,
    WANDERER_STORE,
    PLAYER_STORE,
    STRUCTURE_STORE,
  ]);
  playback.playTo(ticks - 1);
  const round = (n: number) => Math.round(n * 1e6) / 1e6;
  const pack = (b: ObservableBody[]) => b.map((e) => [e.id, round(e.x), round(e.y), round(e.z)]);
  const out: ObservableBody[] = [];
  for (const id of world.store(PhysicsBody.name).keys()) {
    const b = world.getComponent(PhysicsBody.name, id) as RigidBody | undefined;
    if (b) out.push({ id, x: b.position.x, y: b.position.y, z: b.position.z });
  }
  const agents: number[][] = [];
  for (const id of world.store(AGENT_STORE).keys()) {
    const a = world.getComponent(AGENT_STORE, id) as
      | { tx: number; tz: number; delivered: number }
      | undefined;
    if (a) agents.push([id, a.tx, a.tz, a.delivered]);
  }
  const resources: number[][] = [];
  for (const id of world.store(RESOURCE_STORE).keys()) {
    const r = world.getComponent<{ tx: number; tz: number; amount: number }>(RESOURCE_STORE, id);
    if (r) resources.push([id, r.tx, r.tz, r.amount]);
  }
  const blockers: number[][] = [];
  for (const id of world.store(BLOCKER_STORE).keys()) {
    const b = world.getComponent<{ tx: number; tz: number }>(BLOCKER_STORE, id);
    if (b) blockers.push([id, b.tx, b.tz]);
  }
  const wanderers: number[][] = [];
  for (const id of world.store(WANDERER_STORE).keys()) {
    const w = world.getComponent<{ tx: number; tz: number; gathered: number }>(WANDERER_STORE, id);
    if (w) wanderers.push([id, w.tx, w.tz, w.gathered]);
  }
  const players: number[][] = [];
  for (const id of world.store(PLAYER_STORE).keys()) {
    const p = world.getComponent<{ tx: number; tz: number; hasResource: number; delivered: number }>(PLAYER_STORE, id);
    if (p) players.push([id, p.tx, p.tz, p.hasResource, p.delivered]);
  }
  const structures: number[][] = [];
  for (const id of world.store(STRUCTURE_STORE).keys()) {
    const s = world.getComponent<{ tx: number; tz: number }>(STRUCTURE_STORE, id);
    if (s) structures.push([id, s.tx, s.tz]);
  }
  return {
    physics: pack(out),
    netServer: [],
    netClient: [],
    agents,
    resources,
    blockers,
    wanderers,
    players,
    structures,
  };
}

// ---------------------------------------------------------------------------
// Terrain helpers (deterministic, seeded) — the project the bodies move over.
// ---------------------------------------------------------------------------
export interface TerrainView {
  terrain: ReturnType<TerrainGenerator['generate']>;
  mesh: ReturnType<HeightfieldMeshBuilder['build']>;
  normals: Float32Array;
  colors: Float32Array;
}

export function buildTerrain(seed: string, size = 40): TerrainView {
  const gen = new TerrainGenerator(seed, { size });
  const terrain = gen.generate();
  const mesh = new HeightfieldMeshBuilder(terrain.heights, terrain.width, terrain.height, 8).build();
  const normals = computeNormals(mesh.positions, mesh.indices);
  const grad = new ColorGradient();
  const colors = new Float32Array(terrain.biomeIds.length * 4);
  for (let i = 0; i < terrain.biomeIds.length; i++) {
    const c = grad.biomeColor(terrain.biomeIds[i]! % BIOME_COUNT);
    colors[i * 4 + 0] = c[0] / 255;
    colors[i * 4 + 1] = c[1] / 255;
    colors[i * 4 + 2] = c[2] / 255;
    colors[i * 4 + 3] = c[3] / 255;
  }
  return { terrain, mesh, normals, colors };
}

/**
 * PBR terrain view: the existing vertex-colored mesh + normals, plus the
 * deterministic PBR material + 2-level LOD chain used by the new
 * Roadmap §8 render path. Pure function of `seed` (no clock).
 */
export interface PbrTerrainView extends TerrainView {
  material: PbrMaterial;
  lod: LodMesh;
  /** Cascaded-shadow cascades for a given camera (rebuilt on demand). */
  shadows(camera: Camera): Cascade[];
}

export function buildPbrTerrain(seed: string, size = 40): PbrTerrainView {
  const base = buildTerrain(seed, size);
  const material = defaultPbrMaterial();
  material.albedo = [0.42, 0.46, 0.5];
  material.roughness = 0.78;
  material.metallic = 0.02;

  // Coarse downsampled level for LOD.
  const coarseW = Math.max(2, Math.floor(base.terrain.width / 2));
  const coarseH = Math.max(2, Math.floor(base.terrain.height / 2));
  const coarseHeights = new Float32Array(coarseW * coarseH);
  for (let z = 0; z < coarseH; z++) {
    for (let x = 0; x < coarseW; x++) {
      const sx = Math.min(base.terrain.width - 1, x * 2);
      const sz = Math.min(base.terrain.height - 1, z * 2);
      coarseHeights[z * coarseW + x] = base.terrain.heights[sz * base.terrain.width + sx]!;
    }
  }
  const coarse = new HeightfieldMeshBuilder(coarseHeights, coarseW, coarseH, 8).build();
  const lod = buildLodMesh(
    'terrain',
    { x: size / 2, y: 0, z: size / 2 },
    [{ mesh: base.mesh }, { mesh: coarse }],
  );
  return {
    ...base,
    material,
    lod,
    shadows(camera: Camera): Cascade[] {
      return cascadesFromCamera(
        camera,
        defaultSun().direction,
        {
          cascades: defaultSun().shadows?.cascades ?? 4,
          lambda: defaultSun().shadows?.lambda ?? 0.6,
          texelSize: defaultSun().shadows?.texelSize ?? 1,
        },
      );
    },
  };
}

export type { Camera, RGBA, DrawItem };
