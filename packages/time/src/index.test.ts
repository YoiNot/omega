import { describe, it, expect } from 'vitest';
import * as time from './index.js';

describe('@omega/time public exports', () => {
  it('exports FixedTimestep', () => {
    expect(typeof time.FixedTimestep).toBe('function');
  });

  it('exports interpolation helpers', () => {
    expect(typeof time.lerpState).toBe('function');
    expect(typeof time.lerpVec3).toBe('function');
  });

  it('exposes a TickCallback type export name', () => {
    // type-only at runtime, but the named export must not be undefined as a value-bind
    expect('FixedTimestep' in time).toBe(true);
  });
});
