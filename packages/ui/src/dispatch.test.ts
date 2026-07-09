import { describe, it, expect } from 'vitest';
import { UiTree } from './tree.js';
import { dispatch } from './dispatch.js';
import type { InputSample, WidgetState } from './types.js';

function widget(over: Partial<WidgetState> = {}): WidgetState {
  return {
    id: 'w',
    kind: 'button',
    bounds: { x: 0, y: 0, w: 10, h: 10 },
    enabled: true,
    ...over,
  };
}

function sample(over: Partial<InputSample> = {}): InputSample {
  return { mouseX: 5, mouseY: 5, clicked: false, tick: 0, ...over };
}

describe('dispatch hover', () => {
  it('emits a hover event for the widget under the cursor', () => {
    const tree = new UiTree();
    tree.set(widget({ id: 'btn', bounds: { x: 0, y: 0, w: 50, h: 50 } }));
    const events = dispatch(tree, sample({ mouseX: 25, mouseY: 25, tick: 7 }));
    expect(events).toEqual([
      { widgetId: 'btn', type: 'hover', tick: 7 },
    ]);
  });

  it('emits no event when the cursor is outside any widget', () => {
    const tree = new UiTree();
    tree.set(widget({ id: 'btn', bounds: { x: 0, y: 0, w: 10, h: 10 } }));
    const events = dispatch(tree, sample({ mouseX: 100, mouseY: 100, tick: 3 }));
    expect(events).toEqual([]);
  });
});

describe('dispatch click', () => {
  it('emits a hover THEN a click when clicked is true', () => {
    const tree = new UiTree();
    tree.set(widget({ id: 'btn', bounds: { x: 0, y: 0, w: 50, h: 50 } }));
    const events = dispatch(tree, sample({ mouseX: 10, mouseY: 10, clicked: true, tick: 4 }));
    expect(events).toEqual([
      { widgetId: 'btn', type: 'hover', tick: 4 },
      { widgetId: 'btn', type: 'click', tick: 4 },
    ]);
  });

  it('does NOT emit a click when clicked is false', () => {
    const tree = new UiTree();
    tree.set(widget({ id: 'btn', bounds: { x: 0, y: 0, w: 50, h: 50 } }));
    const events = dispatch(tree, sample({ mouseX: 10, mouseY: 10, clicked: false, tick: 2 }));
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('hover');
  });

  it('emits nothing for a click outside any widget', () => {
    const tree = new UiTree();
    tree.set(widget({ id: 'btn', bounds: { x: 0, y: 0, w: 10, h: 10 } }));
    const events = dispatch(tree, sample({ mouseX: 99, mouseY: 99, clicked: true, tick: 1 }));
    expect(events).toEqual([]);
  });
});

describe('dispatch determinism', () => {
  it('produces identical events for identical (tree, input)', () => {
    const makeTree = () => {
      const t = new UiTree();
      t.set(widget({ id: 'a', bounds: { x: 0, y: 0, w: 40, h: 40 } }));
      t.set(widget({ id: 'b', bounds: { x: 20, y: 20, w: 40, h: 40 } }));
      return t;
    };
    const input = sample({ mouseX: 30, mouseY: 30, clicked: true, tick: 12 });
    expect(dispatch(makeTree(), input)).toEqual(dispatch(makeTree(), input));
  });

  it('passes tick through and never derives it from a clock', () => {
    const tree = new UiTree();
    tree.set(widget({ id: 'btn', bounds: { x: 0, y: 0, w: 10, h: 10 } }));
    const input = sample({ mouseX: 5, mouseY: 5, clicked: true, tick: 999 });
    const events = dispatch(tree, input);
    for (const e of events) expect(e.tick).toBe(999);
  });

  it('only the topmost widget under the cursor receives events', () => {
    const tree = new UiTree();
    tree.set(widget({ id: 'bottom', bounds: { x: 0, y: 0, w: 100, h: 100 } }));
    tree.set(widget({ id: 'top', bounds: { x: 0, y: 0, w: 100, h: 100 } }));
    const events = dispatch(tree, sample({ mouseX: 10, mouseY: 10, clicked: true, tick: 5 }));
    expect(events.map((e) => e.widgetId)).toEqual(['top', 'top']);
  });
});
