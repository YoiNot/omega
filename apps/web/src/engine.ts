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
 * Input is a THIN, OWN scripted layer (ScriptedInput) that stands in for
 * @omega/input-core + @omega/replay. The moment those packages merge, this
 * file's `Demo.input` can be swapped for the real input/replay drivers without
 * touching the rest of the loop (the loop only consumes `Uint8Array` payloads).
 *
 * No Math.random / Date.now anywhere in the core path: every initial placement
 * comes from a seeded @omega/engine-core `Rng`, and every tick is a fixed step.
 * The whole `createDemo` + `step` pipeline is therefore a pure function of
 * (seed, tick count, input script) — see the headless determinism test.
 */

import { Vec3 } from '@omega/engine-math';
import { World as CoreWorld, Rng } from '@omega/engine-core';
import { World as EcsWorld, defineComponent } from '@omega/ecs';
import {
  PhysicsSimulation,
  createPhysicsEntity,
  PhysicsBody,
} from '@omega/physics-integration';
import type { RigidBody } from '@omega/physics';
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
} from '@omega/render';
import { TerrainGenerator, BIOME_COUNT } from '@omega/world-gen';
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

// ---------------------------------------------------------------------------
// Thin, own input layer (replacement seam for @omega/input-core + replay).
// Produces a deterministic command payload per tick from a seeded Rng.
//   payload = [entityIndex(u32), ix(f32), iy(f32), iz(f32)]
// entityIndex selects which replicated entity receives an impulse; the impulse
// vector is drawn from the seeded Rng so two runs with the same seed diverge
// identically and the net reconciliation still converges bit-for-bit.
// ---------------------------------------------------------------------------
export class ScriptedInput {
  private readonly rng: Rng;
  private readonly entityCount: number;
  private tick = 0;

  constructor(seed: string, entityCount: number) {
    this.rng = new Rng(seed);
    this.entityCount = entityCount;
  }

  /** Advance one input tick and return the next command payload. */
  next(): Uint8Array {
    const entity = this.tick % Math.max(1, this.entityCount);
    const ix = this.rng.nextRange(-1, 1);
    const iy = this.rng.nextRange(0.5, 1.5); // bias upward so spheres keep hopping
    const iz = this.rng.nextRange(-1, 1);
    this.tick += 1;
    const f = new Float32Array([entity, ix, iy, iz]);
    return new Uint8Array(f.buffer.slice(0));
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
  input: ScriptedInput;
  fixedDt: number;
  terrainSeed: string;
  /** Advance the whole loop by one fixed tick. */
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
}

export function createDemo(opts: DemoOptions): Demo {
  const seed = opts.seed;
  const terrainSize = opts.terrainSize ?? 40;
  const dynamicBodies = opts.dynamicBodies ?? 7;
  const staticPegs = opts.staticPegs ?? 4;
  const netEntities = opts.netEntities ?? 5;
  const fixedDt = opts.fixedDt ?? 1 / 60;
  const gravity = opts.gravity ?? [0, -9.81, 0];

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

  const input = new ScriptedInput(`${seed}:input`, netEntities);

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
  }

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
    fixedDt,
    terrainSeed: seed,
    step(): void {
      // (a) advance local physics one fixed step
      coreWorld.step(fixedDt);
      // (b) thin input -> client predicts, server simulates, snapshot reconciles
      const payload = input.next();
      const cmd = client.sendIntent(payload);
      server.onCommand(cmd);
      const snap = server.advance();
      transport.send(encodeFrame(snap.tick, snap.data));
      transport.tick();
      // (c) mirror observable state into the view world for rendering
      syncView();
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

export type { Camera, RGBA, DrawItem };
