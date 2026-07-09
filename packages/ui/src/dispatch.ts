import type { InputSample, UiEvent } from './types.js';
import type { UiTree } from './tree.js';

/**
 * Dispatch a single input sample against the tree and return the events it
 * produces.
 *
 * Pure function of `(tree, input)`: given the same tree and the same sample, it
 * always returns the same events, in the same order. The current `tick` is
 * taken from `input.tick` — this module never reads a clock or wall time, so
 * results are fully deterministic and replayable.
 *
 * Behaviour:
 *  - If the cursor is over a widget (topmost by z-order), a `hover` event is
 *    always emitted for that widget.
 *  - If the cursor is over a widget AND `input.clicked` is true, a `click`
 *    event is emitted for that widget (after the hover event).
 *  - If the cursor is over no widget, an empty array is returned.
 *
 * `tree.hitTest` resolves the topmost widget, so only the topmost widget under
 * the cursor receives events (widgets beneath it are occluded).
 */
export function dispatch(tree: UiTree, input: InputSample): UiEvent[] {
  const hit = tree.hitTest(input.mouseX, input.mouseY);
  if (hit === undefined) return [];

  const events: UiEvent[] = [
    { widgetId: hit.id, type: 'hover', tick: input.tick },
  ];

  if (input.clicked) {
    events.push({ widgetId: hit.id, type: 'click', tick: input.tick });
  }

  return events;
}
