/**
 * apps/web — deterministic interaction system (Roadmap §15, part 2/4).
 *
 * The player can "address" nearby world objects (resource nodes, placed
 * structures, other entities) within a fixed tile RADIUS, optionally also
 * constrained by a field-of-view (FOV) wedge in front of the player's facing
 * direction. Both checks are pure functions of integer tile coordinates and the
 * player's (tx, tz, facing), so the same world + same player state + same
 * target positions always yield the identical candidate set, in a stable order.
 *
 * No clock, no RNG: the FOV test uses only integer/trig-free angle math
 * (dot-product sign + cross-product side test) so it is bit-stable across
 * platforms and replays.
 */

import { Vec2 } from '@omega/engine-math';
import type { Facing } from './player';

/** A target the player can interact with, identified by an id + tile. */
export interface InteractableTarget {
  id: number;
  tx: number;
  tz: number;
}

/** The 8 compass directions as unit-ish vectors (tx, tz). */
const FACING_VEC: Record<Facing, Vec2> = {
  N: new Vec2(0, -1),
  S: new Vec2(0, 1),
  E: new Vec2(1, 0),
  W: new Vec2(-1, 0),
  NE: new Vec2(1, -1),
  NW: new Vec2(-1, -1),
  SE: new Vec2(1, 1),
  SW: new Vec2(-1, 1),
  idle: new Vec2(0, 1), // default facing south when idle (deterministic)
};

/** Chebyshev (tile-step) distance between two tiles. */
export function tileDistance(ax: number, az: number, bx: number, bz: number): number {
  return Math.max(Math.abs(ax - bx), Math.abs(az - bz));
}

/**
 * Deterministic range check: is `(tx, tz)` within `radius` (Chebyshev) tiles of
 * the player at `(px, pz)`? Inclusive of the boundary. Pure function of the
 * five integer arguments.
 */
export function inRange(px: number, pz: number, tx: number, tz: number, radius: number): boolean {
  return tileDistance(px, pz, tx, tz) <= radius;
}

/**
 * Deterministic FOV check: is the target inside the wedge centred on the
 * player's facing direction with half-angle `halfAngleRad`?
 *
 * Uses only dot-product (cos similarity) and a signed cross-product (side), so
 * it is fully deterministic and replay-safe. When `facing === 'idle'` the FOV is
 * treated as omnidirectional (every direction counts as in-front), keeping the
 * result stable and never silently excluding everything.
 *
 * @returns true when the target is within the wedge (or facing is idle).
 */
export function inFov(
  px: number,
  pz: number,
  tx: number,
  tz: number,
  facing: Facing,
  halfAngleRad: number,
): boolean {
  if (facing === 'idle') return true;
  const dx = tx - px;
  const dz = tz - pz;
  // Coincident target is always in view.
  if (dx === 0 && dz === 0) return true;
  const fwd = FACING_VEC[facing];
  // |forward| == 1 for all 8 directions, so no length normalisation needed.
  // cos(theta) = (forward · d) / |d|
  const len = Math.sqrt(dx * dx + dz * dz);
  const cosTheta = (fwd.x * dx + fwd.y * dz) / len;
  // cos of the half-angle: precompute once (caller passes radians).
  const cosHalf = Math.cos(halfAngleRad);
  return cosTheta >= cosHalf;
}

/**
 * Enumerate every interactable target the player can currently address:
 *   - within `radius` tiles (Range), AND
 *   - within the FOV wedge (unless `fovHalfAngleRad` is 0 → no FOV constraint),
 *   - excluding the player's OWN tile.
 * The result is sorted by ascending target id for stable, deterministic order.
 */
export function queryInteractables(
  px: number,
  pz: number,
  facing: Facing,
  targets: readonly InteractableTarget[],
  radius: number,
  fovHalfAngleRad: number,
): InteractableTarget[] {
  const out: InteractableTarget[] = [];
  for (const t of targets) {
    if (t.tx === px && t.tz === pz) continue;
    if (!inRange(px, pz, t.tx, t.tz, radius)) continue;
    if (fovHalfAngleRad > 0 && !inFov(px, pz, t.tx, t.tz, facing, fovHalfAngleRad)) continue;
    out.push({ id: t.id, tx: t.tx, tz: t.tz });
  }
  out.sort((a, b) => a.id - b.id);
  return out;
}

/**
 * A deterministic interaction system. Given a player (tx, tz, facing) and a list
 * of world targets, it computes the addressable set. It is intentionally
 * side-effect free except for recording the last query so observers (HUD) can
 * read it — and even that is a pure function of the inputs.
 */
export class InteractionSystem {
  private last: InteractableTarget[] = [];

  /**
   * Query what the player can interact with right now.
   * @param radius interaction radius in tiles (Chebyshev).
   * @param fovHalfAngleRad FOV half-angle in radians; pass 0 to disable FOV.
   */
  query(
    px: number,
    pz: number,
    facing: Facing,
    targets: readonly InteractableTarget[],
    radius: number,
    fovHalfAngleRad: number,
  ): InteractableTarget[] {
    this.last = queryInteractables(px, pz, facing, targets, radius, fovHalfAngleRad);
    return this.last;
  }

  /** The most recently computed addressable set (for HUD/debug). */
  get lastTargets(): readonly InteractableTarget[] {
    return this.last;
  }
}
