import { describe, it, expect } from 'vitest';
import {
  MemorySyncAdapter,
  reconcile,
  synchronize,
  contentChecksum,
  type SyncedSnapshot,
} from './sync.js';

function snap(bytes: number[], generation: number): SyncedSnapshot {
  const b = Uint8Array.from(bytes);
  return { bytes: b, generation, checksum: contentChecksum(b) };
}

describe('reconcile', () => {
  it('is a pure function and prefers higher generation', () => {
    const local = snap([1, 2, 3], 5);
    const remote = snap([9, 9], 3);
    const r1 = reconcile(local, remote);
    const r2 = reconcile(local, remote);
    expect(r1).toEqual(r2);
    expect(r1.outcome).toBe('local-wins');
    expect(r1.bytes).toEqual(local.bytes);

    const r3 = reconcile(snap([1, 2, 3], 1), snap([9, 9], 10));
    expect(r3.outcome).toBe('remote-wins');
  });

  it('treats identical content+generation as equal', () => {
    const a = snap([1, 2, 3], 4);
    const b = snap([1, 2, 3], 4);
    const r = reconcile(a, b);
    expect(r.outcome).toBe('equal');
    expect(r.bytes).toEqual(a.bytes);
  });

  it('tie-breaks by greater checksum when generations are equal', () => {
    const a = snap([1, 2], 7);
    const b = snap([9, 9, 9], 7);
    const ra = reconcile(a, b);
    const rb = reconcile(b, a);
    // The SAME authoritative bytes win regardless of argument order (deterministic
    // convergence). The `outcome` label is relative (local vs remote), so we
    // assert the agreed-on winner bytes, not the label.
    expect(ra.outcome).not.toBe('equal');
    expect(ra.bytes).toEqual(rb.bytes);
  });

  it('a single side wins when the other is null', () => {
    const local = snap([1], 1);
    expect(reconcile(local, null).outcome).toBe('local-wins');
    // local is null here, so remote (the populated snapshot) wins.
    expect(reconcile(null, local).outcome).toBe('remote-wins');
  });
});

describe('MemorySyncAdapter + synchronize', () => {
  it('push/pull round-trips', async () => {
    const adapter = new MemorySyncAdapter();
    expect(await adapter.pull()).toBeNull();
    const s = snap([5, 5, 5], 2);
    await adapter.push(s);
    const pulled = await adapter.pull();
    expect(pulled).not.toBeNull();
    expect(pulled!.bytes).toEqual(s.bytes);
    expect(pulled!.generation).toBe(2);
  });

  it('converges deterministically: both ends agree after a sync', async () => {
    const remote = new MemorySyncAdapter();
    const localSnap = snap([1, 2, 3, 4], 6);

    // Local pushes to remote; remote wins the write-through.
    const res = await synchronize(localSnap, remote);
    expect(res.outcome).toBe('local-wins');

    // Now a second peer with an older generation syncs: it should converge to
    // the same authoritative bytes (remote-wins for the laggard).
    const oldPeer = snap([0], 1);
    const res2 = await synchronize(oldPeer, remote);
    expect(res2.outcome).toBe('remote-wins');
    expect(res2.bytes).toEqual(localSnap.bytes);

    // And the remote still holds that authoritative copy.
    const finalRemote = await remote.pull();
    expect(finalRemote!.bytes).toEqual(localSnap.bytes);
    expect(finalRemote!.generation).toBe(6);
  });

  it('synchronize is idempotent when nothing changed', async () => {
    const remote = new MemorySyncAdapter();
    const s = snap([7, 7], 3);
    await synchronize(s, remote);
    const res = await synchronize(s, remote);
    expect(res.outcome).toBe('equal');
    expect(res.bytes).toEqual(s.bytes);
  });
});
