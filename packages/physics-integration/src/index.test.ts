import { describe, it, expect } from 'vitest';
import * as pkg from '../src/index.js';

describe('index exports', () => {
  it('exposes the pipeline surface', () => {
    expect(typeof pkg.PhysicsBody).toBe('object');
    expect(typeof pkg.createPhysicsEntity).toBe('function');
    expect(typeof pkg.PhysicsSimulation).toBe('function');
    expect(typeof pkg.replayPhysics).toBe('function');
  });
});
