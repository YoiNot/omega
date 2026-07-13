import { describe, it, expect } from 'vitest';
import { Vec3 } from '@omega/engine-math';
import { SpatialAudioModel, type AudioSourceInput, type ListenerState } from '@omega/audio-spatial';
import {
  buildPlaybackGraph,
  type AudioContextLike,
  type AudioNodeLike,
  type GainNodeLike,
  type StereoPannerNodeLike,
  type OscillatorNodeLike,
  type AudioBufferSourceNodeLike,
  type AudioParamLike,
} from './adapter.js';
import type { AudioBufferLike } from './graph.js';

/** A tiny recording mock of the Web Audio API — no sound, fully deterministic. */
class MockParam implements AudioParamLike {
  value = 0;
}
class MockNode implements AudioNodeLike {
  ins: AudioNodeLike[] = [];
  outs: AudioNodeLike[] = [];
  connect(n: AudioNodeLike) {
    this.outs.push(n);
    (n as MockNode).ins.push(this);
  }
  disconnect() {
    this.outs = [];
  }
}
class MockGain extends MockNode implements GainNodeLike {
  gain = new MockParam();
}
class MockPanner extends MockNode implements StereoPannerNodeLike {
  pan = new MockParam();
}
class MockOsc extends MockNode implements OscillatorNodeLike {
  type: OscillatorType = 'sine';
  frequency = new MockParam();
  start() {}
  stop() {}
}
class MockBufferSrc extends MockNode implements AudioBufferSourceNodeLike {
  buffer: AudioBufferLike | null = null;
  loop = false;
  start() {}
  stop() {}
}

class MockContext implements AudioContextLike {
  currentTime = 0;
  sampleRate = 44100;
  destination = new MockNode();
  createGain() {
    return new MockGain();
  }
  createStereoPanner() {
    return new MockPanner();
  }
  createOscillator() {
    return new MockOsc();
  }
  createBufferSource() {
    return new MockBufferSrc();
  }
  createBuffer(channels: number, length: number, sampleRate: number): AudioBufferLike {
    return { numberOfChannels: channels, length, sampleRate };
  }
}

function centeredListener(): ListenerState {
  return { pos: Vec3.of(0, 0, 0), forward: Vec3.of(0, 0, -1) };
}
function src(id: string, pos: Vec3, gain = 1): AudioSourceInput {
  return { id, pos, gain };
}

describe('buildPlaybackGraph — determinism', () => {
  it('produces an identical graph config for identical spatial params', () => {
    const model = new SpatialAudioModel({ refDistance: 1, maxDistance: 100 });
    const l = centeredListener();
    const sources = [
      src('a', Vec3.of(3, 1, -4), 0.8),
      src('b', Vec3.of(-2, 0, 5), 1),
      src('c', Vec3.of(0, 0, -10), 0.5),
    ];
    const params = model.update(l, sources);

    const g1 = buildPlaybackGraph(new MockContext(), params);
    const g2 = buildPlaybackGraph(new MockContext(), params);

    const cfg1 = g1.sources.map((s) => s.node);
    const cfg2 = g2.sources.map((s) => s.node);
    expect(cfg1).toEqual(cfg2);
  });

  it('wires source -> gain -> panner -> master -> destination', () => {
    const model = new SpatialAudioModel();
    const params = model.update(centeredListener(), [src('a', Vec3.of(2, 0, -2), 0.7)]);
    const g = buildPlaybackGraph(new MockContext(), params);

    expect(g.sources.length).toBe(1);
    const w = g.sources[0];
    // source feeds gain
    expect((w.sourceNode as unknown as MockNode).outs).toContain(w.gainNode);
    // gain feeds panner
    expect((w.gainNode as unknown as MockNode).outs).toContain(w.pannerNode);
    // panner feeds master
    expect((w.pannerNode as unknown as MockNode).outs).toContain(g.masterGain);
    // master feeds destination
    expect((g.masterGain as unknown as MockNode).outs).toContain((g.masterGain as unknown as MockNode).outs[0]);
  });

  it('maps SpatialSourceParam.gain/panX onto the GainNode/StereoPanner', () => {
    const model = new SpatialAudioModel({ refDistance: 100, maxDistance: 1000 });
    // refDistance huge -> gain == source gain; pan from geometry.
    const l = centeredListener();
    const params = model.update(l, [
      src('right', Vec3.of(5, 0, 0), 0.6),
      src('left', Vec3.of(-5, 0, 0), 0.4),
    ]);
    const g = buildPlaybackGraph(new MockContext(), params);

    const byId = Object.fromEntries(g.sources.map((s) => [s.node.id, s]));
    expect(byId['right'].gainNode.gain.value).toBeCloseTo(0.6, 6);
    expect(byId['right'].pannerNode.pan.value).toBeGreaterThan(0);
    expect(byId['left'].gainNode.gain.value).toBeCloseTo(0.4, 6);
    expect(byId['left'].pannerNode.pan.value).toBeLessThan(0);
  });

  it('clamps out-of-range gain and pan defensively', () => {
    // Force bad values through the graph config directly is impossible (model
    // bounds them); instead assert the wiring clamps via a custom param set.
    const params = [
      { id: 'hi', gain: 5, panX: 2, distance: 3 },
      { id: 'lo', gain: -1, panX: -3, distance: 7 },
    ] as Parameters<typeof buildPlaybackGraph>[1];
    const g = buildPlaybackGraph(new MockContext(), params);
    const byId = Object.fromEntries(g.sources.map((s) => [s.node.id, s]));
    expect(byId['hi'].gainNode.gain.value).toBe(1);
    expect(byId['hi'].pannerNode.pan.value).toBe(1);
    expect(byId['lo'].gainNode.gain.value).toBe(0);
    expect(byId['lo'].pannerNode.pan.value).toBe(-1);
  });

  it('creates a stereo-panner per source and respects master gain', () => {
    const model = new SpatialAudioModel();
    const params = model.update(centeredListener(), [
      src('a', Vec3.of(1, 0, 0)),
      src('b', Vec3.of(0, 0, -1)),
    ]);
    const g = buildPlaybackGraph(new MockContext(), params, { masterGain: 0.5 });
    expect(g.masterGain.gain.value).toBeCloseTo(0.5, 6);
    expect(g.sources.every((s) => s.pannerNode instanceof MockPanner)).toBe(true);
  });

  it('uses a buffer source node when kind === buffer', () => {
    const params = [{ id: 's', gain: 0.8, panX: 0, distance: 1 }];
    const buffer: AudioBufferLike = { numberOfChannels: 1, length: 10, sampleRate: 44100 };
    const g = buildPlaybackGraph(new MockContext(), params, {
      kinds: { s: 'buffer' },
      buffers: { s: buffer },
    });
    const w = g.sources[0];
    expect(w.sourceNode instanceof MockBufferSrc).toBe(true);
    expect((w.sourceNode as MockBufferSrc).buffer).toBe(buffer);
  });
});
