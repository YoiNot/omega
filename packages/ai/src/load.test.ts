import { describe, it, expect } from 'vitest';
import { GoapPlanner } from './goap.js';

describe('load', () => {
  it('loads goap module', () => {
    expect(typeof GoapPlanner).toBe('function');
  });
});
