/**
 * @omega/save-incr — transport-agnostic cloud sync adapter (stub).
 *
 * The engine must be able to reconcile a local save with a "remote" one without
 * hard-coding any concrete cloud provider. This module defines an interface
 * (`SaveSyncAdapter`) that any transport can implement and ships an in-memory
 * implementation (`MemorySyncAdapter`) so the sync logic is testable with zero
 * external dependencies.
 *
 * Reconciliation rule (deterministic, NOT wall-clock)
 * ---------------------------------------------------
 * Two snapshots are considered "the same version" when their content checksum
 * is equal. When local and remote *differ*, the winner is decided by:
 *
 *   1. Higher generation number wins (a monotonically increasing, deterministic
 *      counter the caller manages — typically tick count or save count).
 *   2. If generations tie, the lexicographically greater content checksum wins
 *      (a stable tie-break that does not depend on time or peer identity).
 *
 * This yields a deterministic converge: applying the same push/pull sequence on
 * both ends always leaves both ends with the identical bytes. There is no
 * "last write wins by timestamp" — that would be non-deterministic across peers.
 */

import { computeChecksum } from './checksum.js';

export interface SyncedSnapshot {
  /** Opaque blob bytes (the on-disk save file, incremental or plain). */
  bytes: Uint8Array;
  /**
   * Monotonic generation counter (e.g. number of saves performed). Higher wins.
   * Must be supplied by the caller deterministically (e.g. sim tick).
   */
  generation: number;
  /**
   * Content checksum (FNV-1a over `bytes`). Cached so the adapter need not
   * recompute it. Call `contentChecksum()` to (re)compute when in doubt.
   */
  checksum: number;
}

export interface SyncResult {
  /** 'local-wins' | 'remote-wins' | 'equal' (nothing to do). */
  outcome: 'local-wins' | 'remote-wins' | 'equal';
  /** The bytes that should be authoritative after reconciliation. */
  bytes: Uint8Array;
  generation: number;
  checksum: number;
}

/** A remote store (could be a cloud bucket, a file, another peer, ...). */
export interface SaveSyncAdapter {
  /** Read the remote snapshot, or null if none exists. */
  pull(): Promise<SyncedSnapshot | null>;
  /** Write the given snapshot to the remote. */
  push(snapshot: SyncedSnapshot): Promise<void>;
}

/** Convenience: FNV-1a checksum of a save blob. */
export function contentChecksum(bytes: Uint8Array): number {
  return computeChecksum(bytes);
}

/**
 * Decide the authoritative snapshot between a local and a remote copy.
 *
 * Pure function — no I/O, no clock. Used by both directions of a sync so the
 * outcome is identical regardless of which peer initiated the exchange.
 */
export function reconcile(
  local: SyncedSnapshot | null,
  remote: SyncedSnapshot | null,
): SyncResult {
  if (!local && !remote) {
    throw new Error('reconcile: cannot reconcile two empty snapshots');
  }
  if (!local) {
    return { outcome: 'remote-wins', bytes: remote!.bytes, generation: remote!.generation, checksum: remote!.checksum };
  }
  if (!remote) {
    return { outcome: 'local-wins', bytes: local.bytes, generation: local.generation, checksum: local.checksum };
  }
  if (local.checksum === remote.checksum && local.generation === remote.generation) {
    return { outcome: 'equal', bytes: local.bytes, generation: local.generation, checksum: local.checksum };
  }
  // Higher generation wins.
  if (local.generation !== remote.generation) {
    return local.generation > remote.generation
      ? { outcome: 'local-wins', bytes: local.bytes, generation: local.generation, checksum: local.checksum }
      : { outcome: 'remote-wins', bytes: remote.bytes, generation: remote.generation, checksum: remote.checksum };
  }
  // Generation tie: greater checksum (as unsigned 32-bit) wins.
  const l = local.checksum >>> 0;
  const r = remote.checksum >>> 0;
  return l >= r
    ? { outcome: 'local-wins', bytes: local.bytes, generation: local.generation, checksum: local.checksum }
    : { outcome: 'remote-wins', bytes: remote.bytes, generation: remote.generation, checksum: remote.checksum };
}

/**
 * In-memory implementation of `SaveSyncAdapter`. Suitable as a local cache or
 * as a deterministic test double standing in for a real cloud endpoint.
 */
export class MemorySyncAdapter implements SaveSyncAdapter {
  private store: SyncedSnapshot | null = null;

  async pull(): Promise<SyncedSnapshot | null> {
    return this.store ? { ...this.store, bytes: this.store.bytes.slice() } : null;
  }

  async push(snapshot: SyncedSnapshot): Promise<void> {
    this.store = { bytes: snapshot.bytes.slice(), generation: snapshot.generation, checksum: snapshot.checksum };
  }

  /** Test/inspection helper: current stored generation (or -1 if empty). */
  get generation(): number {
    return this.store ? this.store.generation : -1;
  }
}

/**
 * Full bidirectional sync between a local snapshot and a remote adapter.
 *
 * Converges deterministically: after returning, the remote holds the
 * authoritative snapshot and the returned `SyncResult` describes it. Calling
 * `synchronize` again from the other side with its then-current data yields the
 * same bytes.
 *
 * @param local the caller's current snapshot (may be null if it has nothing).
 * @param adapter the remote endpoint.
 * @returns the reconciliation result (authoritative copy).
 */
export async function synchronize(
  local: SyncedSnapshot | null,
  adapter: SaveSyncAdapter,
): Promise<SyncResult> {
  const remote = await adapter.pull();
  const result = reconcile(local, remote);
  // Mirror the authoritative copy into the remote so both ends converge.
  if (result.outcome !== 'equal') {
    await adapter.push({ bytes: result.bytes, generation: result.generation, checksum: result.checksum });
  }
  return result;
}
