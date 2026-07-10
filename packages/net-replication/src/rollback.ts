/**
 * @omega/net-replication — deterministic rollback / reconciliation reset.
 *
 * When a client's predicted state diverges from the server's authoritative
 * state (e.g. because of a late or reordered command, or a server-side event
 * the client could not predict), the client must deterministically reset its
 * world to the authoritative truth. This module builds directly on the existing
 * `snapshotToWorld` codec glue (the same function the prediction/replay path
 * uses to rebuild from a base) so there is exactly one mechanism that turns a
 * `WorldSnapshot` into a rematerialized world — no duplicated reconciliation.
 *
 * Determinism: given the same server snapshot + the same codec, `rollback`
 * always rebuilds a world that serializes byte-identically to the snapshot,
 * regardless of the client's prior (possibly corrupted) state.
 */

import { type World } from '@omega/ecs';
import { type WorldSnapshot } from '@omega/net';
import { Codec, snapshotToWorld } from './codec.js';

/**
 * Reset `world` to the authoritative `server` snapshot, destroying any
 * replicated entities the client had predicted and rebuilding precisely the
 * server's entity/component set. Returns the set of entity ids that now exist
 * in `world` (ascending), i.e. the server's authoritative entity set.
 *
 * This is a hard rollback: the client drops all prediction and adopts the
 * server truth for tick `server.tick`. Use it after a divergence that cannot be
 * corrected by replaying in-flight commands alone (the normal reconcile path in
 * `ServerAuthoritativeSim` already seeds + replays; `rollback` is the
 * unconditional floor used when prediction must be abandoned).
 */
export function rollback(world: World, server: WorldSnapshot, codec: Codec): ReturnType<typeof snapshotToWorld> {
  return snapshotToWorld(server, world, codec);
}

/**
 * Detect whether the client's current predicted `client` snapshot differs from
 * the authoritative `server` snapshot at the same tick. Two snapshots differ
 * when their ticks or their serialized bytes differ.
 *
 * Pure and deterministic: identical inputs always yield the same boolean.
 */
export function hasDiverged(client: WorldSnapshot, server: WorldSnapshot): boolean {
  if (client.tick !== server.tick) return client.tick !== server.tick;
  if (client.data.length !== server.data.length) return true;
  for (let i = 0; i < client.data.length; i++) {
    if (client.data[i] !== server.data[i]) return true;
  }
  return false;
}

/**
 * A small reconciliation stage used by higher-level clients: hold the last
 * authoritative snapshot and, on each predicted frame, check for divergence;
 * when divergence is detected, perform a hard `rollback` to the authoritative
 * state and report that a rollback occurred. The stage only ever touches
 * `snapshotToWorld` (via `rollback`) so it shares the codec's single
 * world-rebuild path.
 */
export class RollbackStage {
  private lastAuthoritative?: WorldSnapshot;

  /** The last authoritative snapshot observed (undefined before any). */
  get authoritative(): WorldSnapshot | undefined {
    return this.lastAuthoritative;
  }

  /**
   * Feed the authoritative server snapshot. If the client's predicted snapshot
   * has diverged, roll `world` back to the authoritative state and return true.
   * Otherwise returns false (no rollback needed). Always records
   * `server` as the new authoritative base.
   */
  reconcile(world: World, client: WorldSnapshot, server: WorldSnapshot, codec: Codec): boolean {
    const diverged = this.lastAuthoritative
      ? hasDiverged(client, server)
      : hasDiverged(client, server);
    this.lastAuthoritative = server;
    if (!diverged) return false;
    rollback(world, server, codec);
    return true;
  }
}
