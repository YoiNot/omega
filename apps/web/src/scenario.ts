/**
 * apps/web — deterministic gameplay scenario definition.
 *
 * A scenario is a pure, seed-braced description of the starting world + the
 * gameplay entities placed on it. Building a scenario twice from the same
 * (seed, size, counts) yields byte-identical entity placement, because every
 * position comes from the seeded terrain / nav grid and the deterministic
 * {@link scatterTiles} primitive — never from `Math.random` or the clock.
 *
 * This is the "emergent scenario" the vertical slice needs: GOAP agents that
 * plan + navigate, resource nodes they (and the wanderers) deplete, and a
 * roaming blocker they must route around. Running it is a pure function of the
 * seed, so two runs reproduce tick-for-tick (proven in the gameplay tests).
 */

import { Vec2 } from '@omega/engine-math';
import { TerrainGenerator, BIOME_NAMES } from '@omega/world-gen';
import type { Terrain } from '@omega/world-gen';
import { buildNavGrid, nearestFreeTile } from './nav';
import { scatterTiles, buildBiomeNavGrid, type BiomeNavGrid } from './biome';
import type { Grid } from '@omega/nav-core';
import { GameplaySystem, LiveGrid } from './entities';

/** Counts of each gameplay entity type in the default scenario. */
export interface ScenarioCounts {
  resources: number;
  blockers: number;
  wanderers: number;
  /** GOAP planner agents (driven by the existing GoapSystem). */
  agents: number;
}

export const DEFAULT_COUNTS: ScenarioCounts = {
  resources: 4,
  blockers: 2,
  wanderers: 3,
  agents: 2,
};

/** A fully-specified, deterministic scenario: world + placements. */
export interface Scenario {
  seed: string;
  size: number;
  terrain: Terrain;
  /** Plain `BooleanGrid` view (blocked = impassable biomes) for static nav. */
  navGrid: Grid;
  /** Biome-aware nav grid (costs + same blocked set) for cost reporting. */
  biomeGrid: BiomeNavGrid;
  /** Live grid (static + dynamic blocker tiles) shared by all movers. */
  liveGrid: LiveGrid;
  counts: ScenarioCounts;
  /** Resource placements [tx, tz, amount]. */
  resourceTiles: { tx: number; tz: number; amount: number }[];
  /** Blocker spawn tiles [tx, tz]. */
  blockerTiles: { x: number; y: number }[];
  /** Wanderer spawn tiles [tx, tz]. */
  wandererTiles: { x: number; y: number }[];
  /** GOAP agent start tiles [tx, tz]. */
  agentTiles: { tx: number; tz: number }[];
  /** The single resource the GOAP agents target (deterministic pick). */
  agentResourceTile: Vec2;
  /** The GOAP agents' delivery base (deterministic pick). */
  agentBaseTile: Vec2;
}

/**
 * Build a deterministic scenario from a seed. Pure function of
 * (seed, size, counts): identical inputs ⇒ identical output.
 */
export function buildScenario(
  seed: string,
  size = 40,
  counts: ScenarioCounts = DEFAULT_COUNTS,
  terrainOverride?: Terrain,
): Scenario {
  const terrain = terrainOverride ?? new TerrainGenerator(seed, { size }).generate();
  const navGrid = buildNavGrid(terrain);
  const biomeGrid = buildBiomeNavGrid(terrain);
  const liveGrid = new LiveGrid(navGrid);

  // Deterministic scatter of gameplay anchors over free tiles.
  const resourceTiles = scatterTiles(navGrid, counts.resources, seed, 'resource').map(
    (v, i) => ({ tx: v.x, tz: v.y, amount: 8 + (i % 3) * 4 }),
  );
  const blockerTiles = scatterTiles(navGrid, counts.blockers, seed, 'blocker').map((v) => ({ x: v.x, y: v.y }));
  const wandererTiles = scatterTiles(navGrid, counts.wanderers, seed, 'wanderer').map((v) => ({ x: v.x, y: v.y }));
  const agentTiles = scatterTiles(navGrid, counts.agents, seed, 'agent').map((v) => ({ tx: v.x, tz: v.y }));

  // GOAP target = the first scattered resource; base = the diagonally opposite
  // corner of the grid (deterministic, never a blocked tile by construction).
  const firstRes = resourceTiles[0] ?? { tx: Math.floor(size * 0.2), tz: Math.floor(size * 0.2) };
  const agentResourceTile = nearestFreeTile(navGrid, firstRes.tx, firstRes.tz) ?? new Vec2(firstRes.tx, firstRes.tz);
  const agentBaseTile =
    nearestFreeTile(navGrid, size - 1 - firstRes.tx, size - 1 - firstRes.tz) ??
    new Vec2(size - 2, size - 2);

  return {
    seed,
    size,
    terrain,
    navGrid,
    biomeGrid,
    liveGrid,
    counts,
    resourceTiles,
    blockerTiles,
    wandererTiles,
    agentTiles,
    agentResourceTile,
    agentBaseTile,
  };
}

/**
 * Apply a scenario's entity placement to a gameplay system + GOAP system.
 * Deterministic: given the same scenario object, the same entities are spawned
 * in the same order with the same initial state.
 *
 * @returns the ids of the spawned agents (so the caller can read their plans).
 */
export function applyScenario(
  scenario: Scenario,
  gameplay: GameplaySystem,
  goapSpawn: (start: Vec2, resource: Vec2, base: Vec2) => number,
): number[] {
  for (const r of scenario.resourceTiles) gameplay.addResource(r.tx, r.tz, r.amount);
  for (const b of scenario.blockerTiles) gameplay.addBlocker(b.x, b.y);
  for (const w of scenario.wandererTiles) gameplay.addWanderer(w.x, w.y);
  const agentIds: number[] = [];
  for (const a of scenario.agentTiles) {
    agentIds.push(
      goapSpawn(new Vec2(a.tx, a.tz), scenario.agentResourceTile, scenario.agentBaseTile),
    );
  }
  return agentIds;
}

/** Stable name of the biome at a tile (for HUD/debug display). */
export function biomeNameAt(scenario: Scenario, x: number, y: number): string {
  const b = scenario.biomeGrid.biomes[y * scenario.size + x]!;
  return BIOME_NAMES[b] ?? 'unknown';
}
