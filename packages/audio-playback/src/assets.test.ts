import { describe, it, expect } from 'vitest';
import { decodeAsset, encodeAsset, decodeAssetFromBytes, toBufferLike } from './assets.js';

describe('audio assets — deterministic decode', () => {
  it('round-trips an asset through encode/decode byte-for-byte', () => {
    const frames = new Float32Array([0, 0.5, -0.5, 1, -1, 0.25]);
    const { asset, bytes } = decodeAsset('sfx/tone', 2, 44100, frames);

    expect(asset.channels).toBe(2);
    expect(asset.length).toBe(3); // 6 frames / 2 channels
    expect(asset.sampleRate).toBe(44100);

    const back = decodeAssetFromBytes('sfx/tone', bytes);
    expect(back.frames).toEqual(frames);
    expect(back.channels).toBe(2);
    expect(back.length).toBe(3);
    expect(back.sampleRate).toBe(44100);
  });

  it('produces identical bytes for identical assets', () => {
    const frames = new Float32Array([0.1, 0.2, 0.3, 0.4]);
    const a = decodeAsset('x', 1, 22050, frames);
    const b = decodeAsset('x', 1, 22050, frames);
    expect(a.bytes).toEqual(b.bytes);
    // encode alone is also deterministic
    expect(encodeAsset(a.asset)).toEqual(encodeAsset(b.asset));
  });

  it('throws on a truncated buffer', () => {
    const frames = new Float32Array([0, 0, 0]);
    const { bytes } = decodeAsset('x', 1, 44100, frames);
    // Cut the buffer short to force an overrun.
    const truncated = bytes.subarray(0, bytes.length - 4);
    expect(() => decodeAssetFromBytes('x', truncated)).toThrow();
  });

  it('adapts an asset to AudioBufferLike for the graph', () => {
    const frames = new Float32Array([0, 0]);
    const { asset } = decodeAsset('amb/wind', 1, 48000, frames);
    const buf = toBufferLike(asset);
    expect(buf.numberOfChannels).toBe(1);
    expect(buf.length).toBe(2);
    expect(buf.sampleRate).toBe(48000);
  });
});
