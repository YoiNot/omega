import { describe, it, expect } from 'vitest';
import { UiTree } from './tree.js';
import type { WidgetState } from './types.js';

function widget(over: Partial<WidgetState> = {}): WidgetState {
  return {
    id: 'w',
    kind: 'button',
    bounds: { x: 0, y: 0, w: 10, h: 10 },
    enabled: true,
    ...over,
  };
}

describe('UiTree set/get/remove', () => {
  it('registers and retrieves a widget', () => {
    const tree = new UiTree();
    tree.set(widget({ id: 'a', label: 'Hi' }));
    const got = tree.get('a');
    expect(got).toBeDefined();
    expect(got?.id).toBe('a');
    expect(got?.label).toBe('Hi');
  });

  it('has() reflects presence', () => {
    const tree = new UiTree();
    expect(tree.has('a')).toBe(false);
    tree.set(widget({ id: 'a' }));
    expect(tree.has('a')).toBe(true);
  });

  it('updates an existing widget in place', () => {
    const tree = new UiTree();
    tree.set(widget({ id: 'a', value: 1 }));
    tree.set(widget({ id: 'a', value: 2 }));
    expect(tree.get('a')?.value).toBe(2);
    expect(tree.size).toBe(1);
  });

  it('remove() deletes a widget and clears has()', () => {
    const tree = new UiTree();
    tree.set(widget({ id: 'a' }));
    tree.remove('a');
    expect(tree.has('a')).toBe(false);
    expect(tree.get('a')).toBeUndefined();
    expect(tree.size).toBe(0);
  });

  it('remove() is a no-op for unknown ids', () => {
    const tree = new UiTree();
    expect(() => tree.remove('nope')).not.toThrow();
    expect(tree.size).toBe(0);
  });

  it('defends against external mutation of stored bounds', () => {
    const tree = new UiTree();
    const w = widget({ id: 'a' });
    tree.set(w);
    w.bounds.w = 999;
    expect(tree.get('a')?.bounds.w).toBe(10);
  });
});

describe('UiTree hitTest', () => {
  it('returns the widget under a point', () => {
    const tree = new UiTree();
    tree.set(widget({ id: 'a', bounds: { x: 0, y: 0, w: 50, h: 50 } }));
    const hit = tree.hitTest(25, 25);
    expect(hit?.id).toBe('a');
  });

  it('returns the TOPMOST (last registered) widget under a point', () => {
    const tree = new UiTree();
    tree.set(widget({ id: 'bottom', bounds: { x: 0, y: 0, w: 100, h: 100 } }));
    tree.set(widget({ id: 'top', bounds: { x: 0, y: 0, w: 100, h: 100 } }));
    const hit = tree.hitTest(10, 10);
    expect(hit?.id).toBe('top');
  });

  it('re-registering moves a widget to the top of the z-order', () => {
    const tree = new UiTree();
    tree.set(widget({ id: 'a', bounds: { x: 0, y: 0, w: 100, h: 100 } }));
    tree.set(widget({ id: 'b', bounds: { x: 0, y: 0, w: 100, h: 100 } }));
    // Move 'a' to the top by re-setting it.
    tree.set(widget({ id: 'a', bounds: { x: 0, y: 0, w: 100, h: 100 } }));
    expect(tree.hitTest(10, 10)?.id).toBe('a');
  });

  it('returns undefined for an out-of-bounds point', () => {
    const tree = new UiTree();
    tree.set(widget({ id: 'a', bounds: { x: 0, y: 0, w: 10, h: 10 } }));
    expect(tree.hitTest(-1, -1)).toBeUndefined();
    expect(tree.hitTest(11, 11)).toBeUndefined();
    expect(tree.hitTest(50, 50)).toBeUndefined();
  });

  it('hitTest does not match when tree is empty', () => {
    const tree = new UiTree();
    expect(tree.hitTest(5, 5)).toBeUndefined();
  });
});

describe('UiTree determinism', () => {
  it('ids() returns a stable, bottom-first z-order', () => {
    const tree = new UiTree();
    tree.set(widget({ id: 'a' }));
    tree.set(widget({ id: 'b' }));
    tree.set(widget({ id: 'c' }));
    expect(tree.ids()).toEqual(['a', 'b', 'c']);
  });

  it('produces identical hitTest results across equivalent trees', () => {
    const make = () => {
      const t = new UiTree();
      t.set(widget({ id: 'a', bounds: { x: 0, y: 0, w: 30, h: 30 } }));
      t.set(widget({ id: 'b', bounds: { x: 20, y: 20, w: 30, h: 30 } }));
      return t;
    };
    const r1 = make().hitTest(25, 25);
    const r2 = make().hitTest(25, 25);
    expect(r1).toEqual(r2);
    expect(r1?.id).toBe('b');
  });
});
