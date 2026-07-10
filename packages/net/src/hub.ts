/**
 * @omega/net — in-memory multi-peer transport (LocalHub).
 *
 * `LoopbackTransport` is a single point-to-point channel. `LocalHub` is a real,
 * multi-client transport: many peers attach to one shared hub and every frame a
 * peer sends is fanned out to all *other* attached peers (server-broadcast
 * semantics) — exactly the delivery model a server-authoritative multiplayer
 * demo needs, but entirely in-process so tests and local demos need no sockets.
 *
 * This is a genuine transport (not just a test double): the server attaches as
 * one peer, each client as another, and the hub routes frames between them with
 * real async delivery (callbacks never fire synchronously inside `send`). A
 * WebSocket or WebRTC backend could be dropped in behind the same `Transport`
 * interface without changing the protocol layer above.
 *
 * Determinism: no timestamps, no randomness. Delivery order is the order frames
 * were enqueued; `tick()`/`flushAsync()` drain the queue in FIFO order. For a
 * fixed script of sends, every peer receives an identical, ordered frame
 * sequence.
 */

import { type Transport } from './transport.js';

/** A peer attached to the hub: its own inbound queue and message callbacks. */
interface Peer {
  readonly id: number;
  readonly cbs: Array<(m: Uint8Array) => void>;
  readonly inbox: Uint8Array[];
  closed: boolean;
}

/**
 * Shared in-memory hub. Create one hub, then call `attach()` once per peer
 * (server + each client). Each `attach()` returns a `Transport` the caller
 * wires into its `ServerAuthoritativeSim`/`ReplicatedClient`. Frames sent by
 * any peer are broadcast to all other live peers on the next `tick()`/flush.
 */
export class LocalHub {
  private readonly peers = new Map<number, Peer>();
  private nextId = 0;

  /** Number of currently-attached (open) peers. */
  get peerCount(): number {
    let n = 0;
    for (const p of this.peers.values()) if (!p.closed) n++;
    return n;
  }

  /**
   * Attach a new peer and return its `Transport`. The returned transport's
   * `send` broadcasts the frame to every *other* attached peer; `onMessage`
   * receives frames from the other peers. `close()` detaches the peer.
   */
  attach(): Transport {
    const id = this.nextId++;
    const peer: Peer = { id, cbs: [], inbox: [], closed: false };
    this.peers.set(id, peer);

    const self = this;
    return {
      send(msg: Uint8Array): void {
        if (peer.closed) return;
        const frame = msg.slice();
        for (const other of self.peers.values()) {
          if (other.id === id || other.closed) continue;
          other.inbox.push(frame.slice());
        }
      },
      onMessage(cb: (m: Uint8Array) => void): void {
        peer.cbs.push(cb);
      },
      close(): void {
        peer.closed = true;
        peer.inbox.length = 0;
        peer.cbs.length = 0;
        self.peers.delete(id);
      },
    };
  }

  /**
   * Deliver all currently-queued frames to the registered callbacks of their
   * destination peers, in FIFO order. Returns the total number of frames
   * delivered across all peers. Safe to call repeatedly; no-ops when closed
   * peers are gone.
   */
  tick(): number {
    let delivered = 0;
    // Snapshot the delivery so a handler that sends new frames doesn't reorder
    // this batch's delivery.
    const batches: Array<{ peer: Peer; frames: Uint8Array[] }> = [];
    for (const peer of this.peers.values()) {
      if (peer.closed || peer.inbox.length === 0) continue;
      batches.push({ peer, frames: peer.inbox.splice(0, peer.inbox.length) });
    }
    for (const { peer, frames } of batches) {
      for (const frame of frames) {
        const copy = frame.slice();
        for (const cb of peer.cbs) cb(copy);
        delivered++;
      }
    }
    return delivered;
  }

  /** Flush all queued frames on the next microtask (mirrors real socket async). */
  flushAsync(): Promise<void> {
    return Promise.resolve().then(() => {
      this.tick();
    });
  }
}
