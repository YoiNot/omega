/**
 * apps/web — Step 3 (Phase B, Roadmap §18 $0): Same-Seed + Replay-Sharing.
 *
 * Multiplayer-lite WITHOUT a server: two clients reproduce the exact same
 * deterministic world/sim by sharing (a) just a SEED — the procgen world +
 * sim are a pure function of the seed, so the same seed ⇒ identical world on
 * both clients (the $0 path, just a link); and (b) optionally a REPLAY file —
 * the recorder's deterministic bytes let a second client reconstruct the exact
 * tick-by-tick history (including player input) with zero network.
 *
 * This module is the pure serialization layer; DOM (download/upload/copy)
 * lives in main.tsx + replay-panel. Every helper is a pure function of its
 * inputs (no clock, no RNG) so the bytes/JSON are reproducible.
 */

import { captureRecording, recordingToBytes, recordingFromBytes, type Recording } from './replay';
import type { Demo } from './engine';

const SHARE_VERSION = 1;

/** A shareable snapshot: seed + (optional) recorded replay bytes. */
export interface SharePayload {
  v: number;
  seed: string;
  /** base64 of the deterministic recording bytes, or '' if world-only. */
  recording: string;
  /** tick the recording was captured at (0 for world-only). */
  tick: number;
}

/** Portable base64 encode (works in browser + Node test env). */
function toBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  if (typeof btoa === 'function') return btoa(bin);
  return Buffer.from(bytes).toString('base64'); // Node fallback
}

/** Portable base64 decode (works in browser + Node test env). */
function fromBase64(s: string): Uint8Array {
  if (typeof atob === 'function') {
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  return new Uint8Array(Buffer.from(s, 'base64')); // Node fallback
}

/** Build a share payload from the live demo (seed + current recording). */
export function buildSharePayload(demo: Demo, seed: string): SharePayload {
  // Only attach a replay if the demo is actually recording (startRecording()
  // was called). Otherwise this is a world-only share (seed reproduces the
  // procgen + sim on any client, $0, no server).
  const rec = demo.isRecording() ? captureRecording(demo) : null;
  const recording = rec ? toBase64(recordingToBytes(rec)) : '';
  return { v: SHARE_VERSION, seed, recording, tick: demo.coreWorld.tick };
}

/** Serialize a payload to a stable JSON string (for download / link data). */
export function payloadToJson(p: SharePayload): string {
  return JSON.stringify(p);
}

/** Parse a payload previously written by {@link payloadToJson}. */
export function jsonToPayload(json: string): SharePayload {
  const p = JSON.parse(json) as SharePayload;
  if (typeof p.seed !== 'string' || p.v !== SHARE_VERSION) {
    throw new Error('invalid share payload');
  }
  return p;
}

/** Reconstruct the Recording from a payload (or null if world-only). */
export function recordingFromPayload(p: SharePayload): Recording | null {
  if (!p.recording) return null;
  return recordingFromBytes(fromBase64(p.recording));
}

/** Build a shareable world link using just the seed (the $0 no-replay path). */
export function shareLink(seed: string): string {
  const url = new URL(typeof location !== 'undefined' ? location.href : 'https://example.com/');
  url.searchParams.set('seed', seed);
  return url.toString();
}

/** Read a seed from the current URL (?seed=...), or null. */
export function seedFromUrl(): string | null {
  if (typeof location === 'undefined') return null;
  return new URL(location.href).searchParams.get('seed');
}
