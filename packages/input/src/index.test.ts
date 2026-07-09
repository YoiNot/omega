import { describe, it, expect } from 'vitest';
import * as input from './index.js';

describe('@omega/input public surface', () => {
  it('exports core types', () => {
    // types are erased at runtime, but the values that USE them must be present
    expect(input.KeyboardAdapter).toBeTypeOf('function');
    expect(input.MouseAdapter).toBeTypeOf('function');
    expect(input.GamepadAdapter).toBeTypeOf('function');
  });

  it('exports recorder + replayer + codec', () => {
    expect(input.CommandRecorder).toBeTypeOf('function');
    expect(input.Replayer).toBeTypeOf('function');
    expect(input.encodeEvents).toBeTypeOf('function');
    expect(input.decodeEvents).toBeTypeOf('function');
  });

  it('can construct an end-to-end pipeline from the public API', () => {
    const held = new Set<string>(['KeyW']);
    const kb = new input.KeyboardAdapter((c) => held.has(c), { codes: ['KeyW'] });
    const rec = new input.CommandRecorder();
    const events = kb.poll(0);
    const cmd = rec.record(input.encodeEvents(events), 0);
    expect(cmd.seq).toBe(0);
    const replay = new input.Replayer(rec.logOf());
    expect(input.decodeEvents(replay.all()[0].payload).map((e) => e.code)).toEqual(['KeyW']);
  });
});
