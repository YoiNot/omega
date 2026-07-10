import { describe, it, expect } from 'vitest';
import * as pkg from './index.js';

describe('render-ecs public exports', () => {
  it('exposes components', () => {
    expect(pkg.Renderable).toBeDefined();
    expect(pkg.Transform).toBeDefined();
  });

  it('exposes draw-list helpers', () => {
    expect(typeof pkg.extractDrawList).toBe('function');
    expect(typeof pkg.modelMatrix).toBe('function');
    expect(typeof pkg.projectModel).toBe('function');
    expect(typeof pkg.applyMatrix).toBe('function');
    expect(typeof pkg.drawOrder).toBe('function');
  });

  it('exposes the EcsRenderer class', () => {
    expect(typeof pkg.EcsRenderer).toBe('function');
  });
});
