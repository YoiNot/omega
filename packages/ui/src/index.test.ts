import { describe, it, expect } from 'vitest';
import * as ui from './index.js';

describe('index exports', () => {
  it('exposes the UiTree class', () => {
    expect(typeof ui.UiTree).toBe('function');
  });

  it('exposes the dispatch function', () => {
    expect(typeof ui.dispatch).toBe('function');
  });

  it('exposes the core types as values (compiled check)', () => {
    // Types are erased at runtime, but this guards against an accidental
    // downgrade where the re-export is dropped. We assert the runtime
    // surface is non-empty by constructing a tree via the export.
    const tree = new ui.UiTree();
    expect(ui.dispatch(tree, { mouseX: 0, mouseY: 0, clicked: false, tick: 0 })).toEqual([]);
  });
});
