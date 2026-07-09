/**
 * @omega/engine-core — type-safe event bus.
 *
 * Decoupled pub/sub used for gameplay signals (e.g. "entity destroyed", "biome changed").
 * Handlers are invoked synchronously in registration order. No ordering across different
 * event types is guaranteed beyond FIFO per type, which is sufficient and deterministic.
 */

export type EventHandler<T> = (payload: T) => void;

export class EventBus<Events extends Record<string, unknown>> {
  private handlers = new Map<keyof Events, Set<EventHandler<unknown>>>();

  on<K extends keyof Events>(type: K, handler: EventHandler<Events[K]>): () => void {
    let set = this.handlers.get(type);
    if (!set) { set = new Set(); this.handlers.set(type, set); }
    set.add(handler as EventHandler<unknown>);
    return () => this.off(type, handler);
  }

  off<K extends keyof Events>(type: K, handler: EventHandler<Events[K]>): void {
    this.handlers.get(type)?.delete(handler as EventHandler<unknown>);
  }

  emit<K extends keyof Events>(type: K, payload: Events[K]): void {
    const set = this.handlers.get(type);
    if (!set) return;
    for (const h of set) (h as EventHandler<Events[K]>)(payload);
  }

  clear(): void { this.handlers.clear(); }
}
