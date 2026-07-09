/**
 * @omega/net — transport abstraction.
 *
 * A `Transport` is a bidirectional byte channel. Implementations decide how
 * bytes physically move (in-process, WebSocket, etc.). The protocol layer above
 * this never sees anything but `Uint8Array` frames.
 *
 * No ambient nondeterminism here: `LoopbackTransport` only buffers and
 * reorders/replays bytes; it never invents data, timestamps, or randomness.
 */

/** A bidirectional, frame-oriented byte channel. */
export interface Transport {
  /** Send a raw frame to the peer. Delivery is asynchronous. */
  send(msg: Uint8Array): void;
  /** Register a callback invoked with each received frame. */
  onMessage(cb: (m: Uint8Array) => void): void;
  /** Tear down the channel; subsequent sends are dropped, no further delivery. */
  close(): void;
}

/**
 * In-process transport used by Node tests and local single-machine demos.
 *
 * Sender and receiver are the same object here: `send` enqueues a frame and
 * `tick()` (or a microtask flush) delivers every queued frame to registered
 * message callbacks. Real socket-like asynchrony is preserved — callbacks are
 * never invoked synchronously from `send` — but there is no real networking.
 */
export class LoopbackTransport implements Transport {
  private readonly outbox: Uint8Array[] = [];
  private messageCbs: Array<(m: Uint8Array) => void> = [];
  private closed = false;

  send(msg: Uint8Array): void {
    if (this.closed) return;
    // Copy so the caller may reuse its buffer without affecting delivery.
    this.outbox.push(msg.slice());
  }

  onMessage(cb: (m: Uint8Array) => void): void {
    this.messageCbs.push(cb);
  }

  close(): void {
    this.closed = true;
    this.outbox.length = 0;
    this.messageCbs = [];
  }

  get isClosed(): boolean {
    return this.closed;
  }

  /** Number of frames buffered but not yet delivered. */
  get pending(): number {
    return this.outbox.length;
  }

  /**
   * Deliver all currently-queued frames to registered callbacks.
   *
   * Each frame is delivered as a fresh copy to each callback, so handlers that
   * retain the buffer cannot corrupt each other. Returns the number of frames
   * delivered. Safe to call when closed (returns 0, no-ops).
   */
  tick(): number {
    if (this.closed) return 0;
    const batch = this.outbox.splice(0, this.outbox.length);
    if (batch.length === 0) return 0;
    for (const frame of batch) {
      const copy = frame.slice();
      for (const cb of this.messageCbs) cb(copy);
    }
    return batch.length;
  }

  /**
   * Flush all queued frames on the next microtask (Promise job). Mirrors the
   * async nature of a real socket without requiring the caller to drive ticks.
   */
  flushAsync(): Promise<void> {
    if (this.closed) return Promise.resolve();
    return Promise.resolve().then(() => {
      this.tick();
    });
  }
}
