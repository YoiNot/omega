/**
 * apps/web — engine glue tying world-gen + render + sim + save into one demo.
 *
 * This is the runnable vertical slice of PROJECT OMEGA: generate a deterministic
 * universe/terrain from a seed, render the terrain heightfield with the WebGL2
 * renderer, run a colony simulation on the ECS, and autosave to IndexedDB-free
 * in-memory bytes via @omega/save.
 */

import {
  TerrainGenerator,
  BIOME_COUNT,
  type Terrain,
} from '@omega/world-gen';
import {
  HeightfieldMeshBuilder,
  ColorGradient,
  computeNormals,
  type MeshData,
} from '@omega/render';
import { World, SystemStage } from '@omega/engine-core';
import { Simulation, buildColony, livingAgentCount } from '@omega/sim';
import { SaveWriter, SaveReader, snapshotWorld, restoreWorld } from '@omega/save';

export interface GameState {
  seed: string;
  terrain: Terrain;
  mesh: MeshData;
  normals: Float32Array;
  colors: Float32Array;
  world: World;
  sim: Simulation;
  agentCount: number;
}

/** Build vertex colors from biome ids using the render ColorGradient. */
function buildBiomeColors(terrain: Terrain): Float32Array {
  const grad = new ColorGradient();
  const colors = new Float32Array(terrain.biomeIds.length * 4);
  for (let i = 0; i < terrain.biomeIds.length; i++) {
    const c = grad.biomeColor(terrain.biomeIds[i]! % BIOME_COUNT);
    colors[i * 4 + 0] = c[0] / 255;
    colors[i * 4 + 1] = c[1] / 255;
    colors[i * 4 + 2] = c[2] / 255;
    colors[i * 4 + 3] = c[3] / 255;
  }
  return colors;
}

/** Generate a deterministic terrain + mesh + colony sim for a seed. */
export function createGame(seed: string, size = 48): GameState {
  const terrain = new TerrainGenerator(seed, { size }).generate();
  const mesh = new HeightfieldMeshBuilder(terrain.heights, terrain.width, terrain.height, 8).build();
  const normals = computeNormals(mesh.positions, mesh.indices);
  const colors = buildBiomeColors(terrain);

  const world = new World();
  const sim = new Simulation(world, { fixedDt: 1 / 30, maxSteps: 8 });
  sim.pause();
  buildColony(world, {
    agentCount: 12,
    foodCount: 8,
    worldWidth: terrain.width,
    worldHeight: terrain.height,
    energyDecayPerSec: 4,
    seed,
  });

  return {
    seed,
    terrain,
    mesh,
    normals,
    colors,
    world,
    sim,
    agentCount: livingAgentCount(world),
  };
}

/** Serialize the current game to deterministic save bytes. */
export function saveGame(state: GameState, createdAt: number): Uint8Array {
  const lowSeed = BigInt(seedToNumber(state.seed)) & 0xffffffffn;
  const highSeed = (BigInt(seedToNumber(state.seed)) >> 32n) & 0xffffffffn;
  const snap = snapshotWorld(state.world, ['Agent', 'Pos', 'Food']);
  const payload = {
    seed: state.seed,
    terrain: { width: state.terrain.width, height: state.terrain.height },
    tick: state.sim.world.tick,
    entities: snap.entities,
  };
  return SaveWriter.write(payload, createdAt, lowSeed, highSeed);
}

/** Restore a game from save bytes (terrain regenerated from seed for determinism). */
export function loadGame(bytes: Uint8Array, size = 48): GameState {
  const file = SaveReader.read<{ seed: string; entities: { id: number; components: Record<string, unknown> }[] }>(bytes);
  const seed = file.data.seed;
  const state = createGame(seed, size);
  // Rebuild ECS from snapshot (overwrites the freshly-created colony).
  restoreWorld(state.world, { entities: file.data.entities });
  state.agentCount = livingAgentCount(state.world);
  return state;
}

function seedToNumber(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export { SystemStage };
