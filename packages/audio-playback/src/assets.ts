/**
 * @omega/audio-playback — audio asset loader (deterministic, buffer-based).
 *
 * A slim loader for buffer-based samples. The decode step is *deterministic*:
 * we serialize/store raw PCM frames via `@omega/serialization` (the same
 * little-endian encoder the rest of the engine uses), so the same asset bytes
 * always reconstruct the exact same `AudioBufferLike` — no platform codec, no
 * streaming, no nondeterministic decode.
 *
 * In the browser this would feed an `AudioBufferSourceNode`; in Node tests we
 * assert the reconstructed metadata/frames with a mock buffer. Two paths:
 *   - `decodeAsset`: turn raw PCM `Float32Array` frames into an `AudioBufferLike`
 *     and a deterministic byte payload (via the engine Encoder).
 *   - `encodeAsset` / `decodeAssetFromBytes`: lossless, deterministic round-trip
 *     for shipping samples inside a save/serialized bundle.
 */

import { Encoder, Decoder } from '@omega/serialization';
import type { AudioBufferLike } from './graph.js';

/** A decoded, ready-to-play sample. */
export interface AudioAsset {
  /** Stable asset id (e.g. 'sfx/footstep'). */
  id: string;
  /** Channel count (1 = mono, 2 = stereo, ...). */
  channels: number;
  /** Sample frames per channel. */
  length: number;
  /** Sample rate in Hz. */
  sampleRate: number;
  /** Raw PCM, interleaved [c0f0, c1f0, c0f1, c1f1, ...] in [-1, 1]. */
  frames: Float32Array;
}

/**
 * Decode raw PCM frames into a deterministic {@link AudioAsset} + its engine
 * byte payload. Identical (id, channels, sampleRate, frames) -> identical
 * `bytes` (deterministic, Endian-fixed layout) every time.
 */
export function decodeAsset(
  id: string,
  channels: number,
  sampleRate: number,
  frames: Float32Array,
): { asset: AudioAsset; bytes: Uint8Array } {
  const asset: AudioAsset = {
    id,
    channels,
    sampleRate,
    length: frames.length / Math.max(1, channels),
    frames,
  };
  return { asset, bytes: encodeAsset(asset) };
}

/**
 * Serialize an {@link AudioAsset} to bytes with a deterministic layout:
 *   u32 channels, u32 sampleRate, u32 frameCount, then frameCount× f32 frames.
 */
export function encodeAsset(asset: AudioAsset): Uint8Array {
  const enc = new Encoder();
  enc.u32(asset.channels);
  enc.u32(asset.sampleRate);
  enc.u32(asset.frames.length);
  for (let i = 0; i < asset.frames.length; i++) {
    enc.f32(asset.frames[i]);
  }
  return enc.bytes();
}

/** Inverse of {@link encodeAsset}. Throws {@link RangeError} on a truncated buffer. */
export function decodeAssetFromBytes(id: string, bytes: Uint8Array): AudioAsset {
  const dec = new Decoder(bytes);
  const channels = dec.u32();
  const sampleRate = dec.u32();
  const frameCount = dec.u32();
  const frames = new Float32Array(frameCount);
  for (let i = 0; i < frameCount; i++) {
    frames[i] = dec.f32();
  }
  return {
    id,
    channels,
    sampleRate,
    length: frameCount / Math.max(1, channels),
    frames,
  };
}

/** Adapt an {@link AudioAsset} to the minimal {@link AudioBufferLike} the graph accepts. */
export function toBufferLike(asset: AudioAsset): AudioBufferLike {
  return {
    numberOfChannels: asset.channels,
    length: asset.length,
    sampleRate: asset.sampleRate,
  };
}
