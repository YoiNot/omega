/**
 * @omega/ecs — deterministic system scheduler.
 *
 * Systems are plain functions `(world, dt) => void`. Each is registered with a
 * numeric `priority`; `run(dt)` executes them in ascending priority order, and
 * ties are broken by registration order (a stable, deterministic rule that does
 * not depend on Map/Set iteration order).
 */

import type { World } from './world.js';

/** A simulation system. Receives the world and the frame delta in seconds. */
export type SystemFn = (world: World, dt: number) => void;

interface SystemEntry {
  readonly fn: SystemFn;
  readonly priority: number;
  /** Registration index, used as the stable tie-breaker. */
  readonly order: number;
  readonly name: string;
}

/** Registers and runs systems in a deterministic fixed order. */
export class SystemScheduler {
  private readonly _systems: SystemEntry[] = [];
  private _dirty = true;

  /**
   * Register a system. `priority` controls execution order (lower runs first);
   * equal priorities run in registration order.
   */
  register(fn: SystemFn, priority = 0, name = ''): void {
    this._systems.push({ fn, priority, order: this._systems.length, name });
    this._dirty = true;
  }

  private _sorted(): readonly SystemEntry[] {
    if (this._dirty) {
      // Stable sort: priority asc, then registration order asc.
      this._systems.sort(
        (a, b) => a.priority - b.priority || a.order - b.order,
      );
      this._dirty = false;
    }
    return this._systems;
  }

  /** Run every registered system once, in deterministic priority order. */
  run(world: World, dt: number): void {
    for (const s of this._sorted()) s.fn(world, dt);
  }

  /** Number of registered systems. */
  get count(): number {
    return this._systems.length;
  }

  /** Remove all systems. */
  clear(): void {
    this._systems.length = 0;
    this._dirty = true;
  }
}
