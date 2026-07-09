/**
 * @omega/ui — pure, logical, immediate-mode UI state types.
 *
 * This package models UI as plain deterministic state: a registry of widgets,
 * input samples, and the events produced when input is dispatched against the
 * tree. There is NO DOM, NO canvas, NO layout math here — bounds are supplied
 * by the caller. Everything is a pure function of its inputs so the same
 * (tree, input) always yields the same events.
 */

/** A rectangular region in logical (layout-supplied) pixel space. */
export interface Bounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The kinds of widgets the state model knows about. */
export type WidgetKind = 'button' | 'label' | 'slider' | 'panel';

/**
 * A single widget's logical state.
 *
 * `bounds` are set explicitly by the caller (this package does no layout).
 * `value` is used by value-bearing widgets (e.g. slider); `label` by text
 * widgets (e.g. button/label). `enabled` gates interaction.
 */
export interface WidgetState {
  id: string;
  kind: WidgetKind;
  bounds: Bounds;
  value?: number;
  label?: string;
  enabled: boolean;
}

/** An event produced by dispatching an input sample against the tree. */
export interface UiEvent {
  widgetId: string;
  type: 'click' | 'hover' | 'change';
  value?: number;
  /** Tick at which the event occurred — always passed in, never read from a clock. */
  tick: number;
}

/**
 * A single frame's worth of input.
 *
 * `tick` is part of the sample so dispatch never needs to consult a clock or
 * wall time. This keeps the whole pipeline deterministic.
 */
export interface InputSample {
  mouseX: number;
  mouseY: number;
  clicked: boolean;
  tick: number;
}
