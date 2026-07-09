import type { Bounds, WidgetState } from './types.js';

/**
 * A pure logical UI tree (immediate-mode state model).
 *
 * Widgets are stored in registration order; that order IS the z-order. Widgets
 * registered later are "on top". `hitTest` therefore returns the *last* widget
 * that contains a point (the topmost one), making hit-testing deterministic
 * regardless of any implicit sorting.
 *
 * This class owns no layout math and no rendering — it is purely a state
 * registry with a deterministic hit-test. Bounds are provided by the caller.
 */
export class UiTree {
  private readonly widgets = new Map<string, WidgetState>();
  /** Stable, insertion-ordered list of widget ids (the z-order). */
  private readonly order: string[] = [];

  /** Register or update a widget's state. Re-registering an existing id moves
   *  it to the top of the z-order (most recently set = topmost). */
  set(widget: WidgetState): void {
    if (this.widgets.has(widget.id)) {
      // Re-registering moves the widget to the top of the z-order (most
      // recently declared = topmost), keeping "last set wins" consistent.
      const idx = this.order.indexOf(widget.id);
      if (idx !== -1) this.order.splice(idx, 1);
    }
    this.order.push(widget.id);
    // Store a defensive copy so external mutation does not leak into the tree.
    this.widgets.set(widget.id, {
      ...widget,
      bounds: { ...widget.bounds },
    });
  }

  /** Remove a widget. No-op if the id is unknown. */
  remove(id: string): void {
    if (this.widgets.delete(id)) {
      const idx = this.order.indexOf(id);
      if (idx !== -1) this.order.splice(idx, 1);
    }
  }

  /** Fetch a widget's state by id, or undefined if not present. */
  get(id: string): WidgetState | undefined {
    const w = this.widgets.get(id);
    if (w === undefined) return undefined;
    return { ...w, bounds: { ...w.bounds } };
  }

  /** True if a widget id is registered. */
  has(id: string): boolean {
    return this.widgets.has(id);
  }

  /** The current number of registered widgets. */
  get size(): number {
    return this.widgets.size;
  }

  /** All registered widget ids in z-order (bottom-first). */
  ids(): readonly string[] {
    return this.order.slice();
  }

  /** Return the topmost widget (by z-order) whose bounds contain (x, y). */
  hitTest(x: number, y: number): WidgetState | undefined {
    // Iterate from the top of the z-order so the first match is the topmost.
    for (let i = this.order.length - 1; i >= 0; i--) {
      const id = this.order[i];
      const w = this.widgets.get(id);
      if (w !== undefined && contains(w.bounds, x, y)) {
        return { ...w, bounds: { ...w.bounds } };
      }
    }
    return undefined;
  }
}

/** Inclusive bounds containment test. */
function contains(b: Bounds, x: number, y: number): boolean {
  return x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h;
}
