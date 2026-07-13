/**
 * apps/web — deterministic gameplay systems (Roadmap §15): player controller,
 * interaction, crafting, construction.
 *
 * Each describe block is a HARD determinism proof: identical inputs ⇒ identical
 * observable outputs, no clock, no RNG, no id-derived tie-breaks. The tests are
 * HEADLESS (no DOM) and build the systems directly from the same seeded
 * terrain/nav grid the vertical slice uses, so they exercise the genuine APIs.
 */

import { describe, it, expect } from 'vitest';
import { Vec2 } from '@omega/engine-math';
import { World as CoreWorld } from '@omega/engine-core';
import { BooleanGrid, findPath } from '@omega/nav-core';
import { TerrainGenerator, Biome } from '@omega/world-gen';
import {
  PlayerSystem,
  PLAYER_STORE,
  frameToCommand,
  makePlayerComponent,
  type InputCommand,
} from './player';
import {
  InteractionSystem,
  inRange,
  inFov,
  queryInteractables,
} from './interaction';
import {
  CraftingSystem,
  RecipeTable,
  defaultRecipes,
  emptyInventory,
  ITEM,
} from './crafting';
import { ConstructionSystem } from './construction';
import { buildNavGrid, nearestFreeTile } from './nav';
import { runHeadless, recordHeadless, replayHeadless } from './engine';
import { serializeRecording, loadRecording } from '@omega/replay';

const SEED = 'omega-gameplay-systems';
const TICKS = 120;

/** Build a deterministic free-tile grid (no impassable biomes) for unit tests. */
function freeGrid(size = 8): BooleanGrid {
  const g = new BooleanGrid(size, size);
  return g; // all free
}

/** A deterministic input frame with a fixed held-key set. */
function frame(frame: number, held: number[]): { frame: number; heldKeys: Uint32Array } {
  const sorted = [...held].sort((a, b) => a - b);
  return { frame, heldKeys: Uint32Array.from(sorted) };
}

/** FNV-1a 32-bit key id (mirror of input-core) so we can fabricate key ids. */
function keyId(code: string): number {
  let h = 0x811c9dc5 >>> 0;
  for (let i = 0; i < code.length; i++) {
    h ^= code.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

// ---------------------------------------------------------------------------
// PLAYER CONTROLLER
// ---------------------------------------------------------------------------
describe('§15 player controller — determinism', () => {
  it('same input sequence ⇒ identical movement/state (reproducible)', () => {
    const grid = freeGrid(10);
    const run = (): { tx: number; tz: number; facing: string } => {
      const world = new CoreWorld();
      const sys = new PlayerSystem(world, grid, new Vec2(5, 5));
      const id = sys.spawnPlayer(new Vec2(5, 5));
      const comp = world.getComponent<ReturnType<typeof makePlayerComponent>>(PLAYER_STORE, id)!;
      const S = keyId('KeyS');
      const D = keyId('KeyD');
      const cmds: InputCommand[] = [
        frameToCommand(frame(0, [D]), new Vec2(comp.tx, comp.tz)),
        frameToCommand(frame(1, [D]), new Vec2(comp.tx, comp.tz)),
        frameToCommand(frame(2, [S]), new Vec2(comp.tx, comp.tz)),
        frameToCommand(frame(3, [S]), new Vec2(comp.tx, comp.tz)),
      ];
      for (const c of cmds) sys.step(c);
      const p = sys.players()[0]!;
      return { tx: p.tx, tz: p.tz, facing: p.facing };
    };
    const a = run();
    const b = run();
    expect(b).toEqual(a);
    // Moved right twice, then down twice from (5,5): (7,7).
    expect(a).toEqual({ tx: 7, tz: 7, facing: 'S' });
  });

  it('cannot walk outside the grid bounds or into a blocked tile', () => {
    const grid = freeGrid(3);
    // Block the entire east column (x=2) so the player cannot move east.
    for (let y = 0; y < 3; y++) grid.setBlocked(2, y, true);
    const world = new CoreWorld();
    const sys = new PlayerSystem(world, grid, new Vec2(1, 1));
    const id = sys.spawnPlayer(new Vec2(1, 1));
    const comp = world.getComponent<ReturnType<typeof makePlayerComponent>>(PLAYER_STORE, id)!;
    const D = keyId('KeyD');
    // Try to push east into the wall repeatedly.
    for (let t = 0; t < 5; t++) sys.step(frameToCommand(frame(t, [D]), new Vec2(comp.tx, comp.tz)));
    const p = sys.players()[0]!;
    // Cannot exceed x=1 (x=2 column is blocked); stays at x=1.
    expect(p.tx).toBe(1);
  });

  it('player lives in the engine-core world ⇒ headless run is reproducible + new fields present', () => {
    const a = runHeadless(SEED, TICKS);
    const b = runHeadless(SEED, TICKS);
    expect(b.players).toEqual(a.players);
    expect(b.structures).toEqual(a.structures);
    expect(a.players.length).toBe(1); // exactly one player spawned
  });

  it('determinism holds across re-runs (pure function of seed)', () => {
    for (let i = 0; i < 3; i++) {
      expect(runHeadless('player-seed-x', TICKS).players).toEqual(
        runHeadless('player-seed-x', TICKS).players,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// INTERACTION
// ---------------------------------------------------------------------------
describe('§15 interaction — deterministic range + FOV', () => {
  it('inRange is a pure Chebyshev check (inclusive boundary)', () => {
    expect(inRange(5, 5, 5, 5, 2)).toBe(true);
    expect(inRange(5, 5, 7, 5, 2)).toBe(true);
    expect(inRange(5, 5, 7, 7, 2)).toBe(true);
    expect(inRange(5, 5, 8, 5, 2)).toBe(false);
    // A negative-coordinate tile at Chebyshev distance 1 is within radius 2.
    expect(inRange(0, 0, -1, 0, 2)).toBe(true);
    expect(inRange(0, 0, -3, 0, 2)).toBe(false);
  });

  it('inFov excludes targets behind the player (deterministic wedge)', () => {
    // Facing East (1,0): a target to the west should be out, to the east in.
    expect(inFov(5, 5, 7, 5, 'E', Math.PI / 4)).toBe(true);
    expect(inFov(5, 5, 3, 5, 'E', Math.PI / 4)).toBe(false);
    // idle facing is omnidirectional.
    expect(inFov(5, 5, 3, 5, 'idle', Math.PI / 4)).toBe(true);
    // Coincident target always in view.
    expect(inFov(5, 5, 5, 5, 'E', Math.PI / 4)).toBe(true);
  });

  it('query returns id-ascending, range+FOV-filtered targets deterministically', () => {
    const targets = [
      { id: 3, tx: 6, tz: 5 },
      { id: 1, tx: 5, tz: 6 },
      { id: 2, tx: 9, tz: 9 }, // out of range (radius 2)
      { id: 4, tx: 3, tz: 5 }, // in range but behind (west) when facing E
    ];
    const rng = () => queryInteractables(5, 5, 'E', targets, 2, Math.PI / 4);
    const a = rng();
    const b = rng();
    expect(b).toEqual(a);
    // Only id 3 (east, in range) and id 1 (south, within 45°? dy=+1,dx=0 → 90° from east → out).
    // East facing, half-angle 45°: only due-east / NE / SE qualify. id1 is due-south (90°) → out.
    expect(a.map((t) => t.id)).toEqual([3]);
  });

  it('InteractionSystem.query is stable across identical calls', () => {
    const sys = new InteractionSystem();
    const targets = [
      { id: 1, tx: 5, tz: 5 },
      { id: 2, tx: 6, tz: 6 },
    ];
    const a = sys.query(4, 4, 'SE', targets, 3, 0);
    const b = sys.query(4, 4, 'SE', targets, 3, 0);
    expect(b).toEqual(a);
  });
});

// ---------------------------------------------------------------------------
// CRAFTING
// ---------------------------------------------------------------------------
describe('§15 crafting — deterministic recipe application', () => {
  it('given recipe + resources ⇒ deterministic output (pure function)', () => {
    const craft = () => {
      const sys = new CraftingSystem();
      sys.grant(ITEM.RESOURCE, 2);
      return sys.craft('plank');
    };
    const a = craft();
    const b = craft();
    expect(b).toEqual(a);
    expect(a.ok).toBe(true);
    expect(a.inventory).toEqual({ [ITEM.PLANK]: 1 });
    expect(a.produced).toEqual([ITEM.PLANK]);
  });

  it('missing inputs ⇒ deterministic failure (no inventory mutation)', () => {
    const sys = new CraftingSystem();
    const r = sys.craft('wall'); // needs plank x2, none present
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('missing inputs');
    expect(r.inventory).toEqual({});
    expect(r.produced).toEqual([]);
  });

  it('multi-input recipe (beacon) consumes inputs in fixed order, deterministic', () => {
    const sys = new CraftingSystem();
    sys.grant(ITEM.WALL, 1);
    sys.grant(ITEM.PLANK, 1);
    sys.grant(ITEM.RESOURCE, 2);
    const r = sys.craft('beacon');
    expect(r.ok).toBe(true);
    expect(r.inventory).toEqual({ [ITEM.BEACON]: 1 });
    // Re-running from same starting inventory gives identical result.
    const sys2 = new CraftingSystem();
    sys2.grant(ITEM.WALL, 1);
    sys2.grant(ITEM.PLANK, 1);
    sys2.grant(ITEM.RESOURCE, 2);
    expect(sys2.craft('beacon')).toEqual(r);
  });

  it('RecipeTable lookup is O(1) and stable; affordableCount is deterministic', () => {
    const table = new RecipeTable(defaultRecipes());
    expect(table.get('plank')?.id).toBe('plank');
    expect(table.get('nope')).toBeUndefined();
    const sys = new CraftingSystem(table);
    sys.grant(ITEM.RESOURCE, 6);
    // 6 resources / 2 per plank = 3 affordable.
    expect(sys.affordableCount('plank')).toBe(3);
    expect(sys.affordableCount('plank')).toBe(3); // idempotent
  });

  it('empty inventory helper is reproducible', () => {
    expect(emptyInventory()).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// CONSTRUCTION
// ---------------------------------------------------------------------------
describe('§15 construction — deterministic biome/collision validation', () => {
  // Deterministic biome grid: grassland everywhere except a known ocean tile.
  function buildBiomeGrid(size = 6): { grid: BooleanGrid; biomeAt: (x: number, z: number) => number } {
    const terrain = new TerrainGenerator(`${SEED}:ctest`, { size }).generate();
    const grid = buildNavGrid(terrain);
    const biomeAt = (x: number, z: number) => terrain.biomeIds[z * size + x] ?? Biome.Grassland;
    return { grid, biomeAt };
  }

  it('validates against biome (rejects snow as blocked-biome) deterministically', () => {
    const { grid, biomeAt } = buildBiomeGrid();
    const world = new CoreWorld();
    const sys = new ConstructionSystem(world, grid, biomeAt);
    // Snow is walkable in the nav grid (not in IMPASSABLE_BIOMES) but excluded
    // from the structure allow-list, so it must surface as 'blocked-biome'.
    let snow: Vec2 | null = null;
    let grass: Vec2 | null = null;
    for (let z = 0; z < 6; z++) {
      for (let x = 0; x < 6; x++) {
        const b = biomeAt(x, z);
        if (b === Biome.Snow && snow === null) snow = new Vec2(x, z);
        else if (b !== Biome.Ocean && b !== Biome.Mountain && b !== Biome.Snow && grass === null) grass = new Vec2(x, z);
      }
    }
    if (grass) {
      expect(sys.validate(grass.x, grass.y, ITEM.WALL, [])).toBe('');
    }
    if (snow) {
      expect(sys.validate(snow.x, snow.y, ITEM.WALL, [])).toBe('blocked-biome');
    }
  });

  it('rejects out-of-bounds + occupied-by-resource deterministically', () => {
    const { grid, biomeAt } = buildBiomeGrid();
    const world = new CoreWorld();
    const sys = new ConstructionSystem(world, grid, biomeAt);
    expect(sys.validate(-1, 0, ITEM.WALL, [])).toBe('out-of-bounds');
    expect(sys.validate(0, -1, ITEM.WALL, [])).toBe('out-of-bounds');
    const res = [new Vec2(2, 2)];
    // (2,2) is occupied by a resource tile → rejected.
    expect(sys.validate(2, 2, ITEM.WALL, res)).toBe('occupied-by-resource');
  });

  it('successful placement is deterministic + recorded in the world store', () => {
    const { grid, biomeAt } = buildBiomeGrid();
    // Use a known-free tile (0,0) if it is grassland; otherwise the first free.
    const target = nearestFreeTile(grid, 0, 0) ?? new Vec2(0, 0);
    const place = (): { ok: boolean; id: number } => {
      const w = new CoreWorld();
      const s = new ConstructionSystem(w, grid, biomeAt);
      const r = s.tryPlace(target.x, target.y, ITEM.WALL, [], () => {});
      return { ok: r.ok, id: r.id };
    };
    const a = place();
    const b = place();
    expect(b).toEqual(a);
    if (a.ok) {
      const w = new CoreWorld();
      const s = new ConstructionSystem(w, grid, biomeAt);
      const r = s.tryPlace(target.x, target.y, ITEM.WALL, [], () => {});
      expect(r.ok).toBe(true);
      // The structure is observable and id-ascending.
      expect(s.structures().map((x) => [x.tx, x.tz, x.kind])).toEqual([
        [target.x, target.y, ITEM.WALL],
      ]);
    }
  });

  it('placing a wall blocks the nav grid (emergence: agents re-route)', () => {
    const { grid, biomeAt } = buildBiomeGrid();
    const world = new CoreWorld();
    const live = grid.clone();
    const sys = new ConstructionSystem(world, live, biomeAt);
    const target = nearestFreeTile(live, 1, 1) ?? new Vec2(1, 1);
    const r = sys.tryPlace(target.x, target.y, ITEM.WALL, [], (x, z) => live.setBlocked(x, z, true));
    expect(r.ok).toBe(true);
    expect(live.isBlocked(target.x, target.y)).toBe(true);
    // A* now routes around it (no crash, deterministic).
    const path = findPath(live, new Vec2(0, 0), new Vec2(3, 3), { allowDiagonal: false });
    expect(path).not.toBeNull();
    if (path) expect(path.some((p) => p.x === target.x && p.y === target.y)).toBe(false);
  });

  it('structures are recorded in the world store + replay round-trips', () => {
    // End-to-end: a demo with the player + construction record/replay identity.
    const { recording, result } = recordHeadless(SEED, TICKS);
    const bytes = serializeRecording(recording, 0);
    const loaded = loadRecording(bytes);
    const replayed = replayHeadless(loaded, TICKS);
    expect(replayed.players).toEqual(result.players);
    expect(replayed.structures).toEqual(result.structures);
  });
});
