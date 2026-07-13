/**
 * apps/web — deterministic crafting system (Roadmap §15, part 3/4).
 *
 * A pure, data-driven recipe engine: given a player's inventory (a countable
 * bag of item ids) and a recipe table, `craft(recipeId)` consumes the exact
 * input items and produces the exact output items — deterministically, with no
 * RNG and no clock. The recipe table is the single source of truth and is keyed
 * by id so lookups are O(1) and stable.
 *
 * Item ids are bound to the entity types the demo already has (see entities.ts /
 * scenario.ts): resources are the harvested `resource` unit; crafted items are
 * `plank` and `wall` which the Construction system later places on the terrain.
 * This keeps crafting wired to the EXISTING world content instead of inventing a
 * parallel item universe.
 *
 * Determinism contract: the same (inventory, recipeId) always yields the same
 * (success, resulting inventory, produced items) — order of operations is fixed
 * (deduct all inputs, then add all outputs), so there is no insertion-order
 * surprise. Inventory equality is by id-ascending count, which is exactly how
 * the tests assert determinism.
 */

/** A countable bag of item ids (e.g. { resource: 3, plank: 1 }). */
export interface Inventory {
  [itemId: string]: number;
}

/** A crafting recipe: fixed inputs -> fixed outputs. */
export interface Recipe {
  id: string;
  /** Display name (informational; not used in equality). */
  name: string;
  /** Item id -> required count. All must be present (>=) to craft. */
  inputs: Inventory;
  /** Item id -> produced count. Always granted on a successful craft. */
  outputs: Inventory;
}

/** Result of a deterministic craft attempt. */
export interface CraftResult {
  ok: boolean;
  /** Human-readable reason when `ok === false` (e.g. "missing inputs"). */
  reason: string;
  /** The inventory AFTER the (possibly failed) attempt. */
  inventory: Inventory;
  /** Item ids actually produced this attempt (may be empty on failure). */
  produced: string[];
}

/** The canonical item ids this vertical slice uses (bound to demo content). */
export const ITEM = {
  RESOURCE: 'resource',
  PLANK: 'plank',
  WALL: 'wall',
  BEACON: 'beacon',
} as const;

/** Build the default, deterministic recipe table used by the demo. */
export function defaultRecipes(): Recipe[] {
  return [
    {
      id: 'plank',
      name: 'Plank',
      inputs: { [ITEM.RESOURCE]: 2 },
      outputs: { [ITEM.PLANK]: 1 },
    },
    {
      id: 'wall',
      name: 'Wall',
      inputs: { [ITEM.PLANK]: 2 },
      outputs: { [ITEM.WALL]: 1 },
    },
    {
      id: 'beacon',
      name: 'Beacon',
      // 1 wall + 1 plank + 2 raw resources — exercises multi-input recipes.
      inputs: { [ITEM.WALL]: 1, [ITEM.PLANK]: 1, [ITEM.RESOURCE]: 2 },
      outputs: { [ITEM.BEACON]: 1 },
    },
  ];
}

/** Lookup map over a recipe list, keyed by id (stable, deterministic). */
export class RecipeTable {
  private readonly byId = new Map<string, Recipe>();

  constructor(recipes: readonly Recipe[] = defaultRecipes()) {
    for (const r of recipes) this.byId.set(r.id, r);
  }

  get(id: string): Recipe | undefined {
    return this.byId.get(id);
  }

  list(): Recipe[] {
    return [...this.byId.values()];
  }
}

/** True when `inv` has at least the `need`ed counts for every item. */
export function hasInputs(inv: Inventory, need: Inventory): boolean {
  for (const k of Object.keys(need)) {
    if ((inv[k] ?? 0) < (need[k] ?? 0)) return false;
  }
  return true;
}

/** A new, empty inventory. */
export function emptyInventory(): Inventory {
  return {};
}

/** Add `n` of `item` to an inventory (mutates + returns it). */
export function addItem(inv: Inventory, item: string, n: number): Inventory {
  inv[item] = (inv[item] ?? 0) + n;
  if (inv[item]! <= 0) delete inv[item];
  return inv;
}

/** A deterministic crafting engine over a (single) player inventory. */
export class CraftingSystem {
  private readonly recipes: RecipeTable;
  private inv: Inventory;

  constructor(recipes?: RecipeTable, initial?: Inventory) {
    this.recipes = recipes ?? new RecipeTable();
    this.inv = { ...(initial ?? {}) };
  }

  /** The live inventory (callers should treat as read-only; use craft()). */
  get inventory(): Inventory {
    return { ...this.inv };
  }

  /** Grant items to the inventory (e.g. from gathering). */
  grant(item: string, n: number): void {
    addItem(this.inv, item, n);
  }

  /** How many times `recipeId` can be crafted with the current inventory. */
  affordableCount(recipeId: string): number {
    const r = this.recipes.get(recipeId);
    if (!r) return 0;
    let max = Infinity;
    for (const k of Object.keys(r.inputs)) {
      const have = this.inv[k] ?? 0;
      const need = r.inputs[k]!;
      if (need <= 0) continue;
      max = Math.min(max, Math.floor(have / need));
    }
    return max === Infinity ? 0 : max;
  }

  /**
   * Attempt to craft `recipeId` once. Deterministic:
   *   1. look up the recipe (fail => "unknown recipe"),
   *   2. check inputs (fail => "missing inputs"),
   *   3. deduct ALL inputs, then add ALL outputs (fixed order),
   *   4. return the resulting inventory + produced item ids.
   */
  craft(recipeId: string): CraftResult {
    const r = this.recipes.get(recipeId);
    if (!r) {
      return { ok: false, reason: 'unknown recipe', inventory: { ...this.inv }, produced: [] };
    }
    if (!hasInputs(this.inv, r.inputs)) {
      return { ok: false, reason: 'missing inputs', inventory: { ...this.inv }, produced: [] };
    }
    // Deduct inputs in id-ascending order (stable, no map-iteration surprise).
    for (const k of Object.keys(r.inputs).sort()) {
      addItem(this.inv, k, -r.inputs[k]!);
    }
    const produced: string[] = [];
    for (const k of Object.keys(r.outputs).sort()) {
      addItem(this.inv, k, r.outputs[k]!);
      for (let i = 0; i < r.outputs[k]!; i++) produced.push(k);
    }
    return { ok: true, reason: 'ok', inventory: { ...this.inv }, produced };
  }
}
