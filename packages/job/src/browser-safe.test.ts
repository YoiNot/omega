import { describe, it, expect } from 'vitest';
import * as job from '@omega/job';

describe('@omega/job default export is browser-safe (no JobScheduler)', () => {
  it('exposes worker-free primitives', () => {
    expect(typeof job.partition).toBe('function');
    expect(typeof job.makeContext).toBe('function');
    expect(typeof job.mergeResult).toBe('function');
    expect(typeof job.buffersEqual).toBe('function');
  });
  it('does NOT re-export the Node-only JobScheduler / runWorker', () => {
    expect('JobScheduler' in job).toBe(false);
    expect('runWorker' in job).toBe(false);
  });
});
