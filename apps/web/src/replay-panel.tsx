/**
 * apps/web — Replay control panel (deterministic record / playback).
 *
 * A slim control surface over @omega/replay wired into the running demo. It
 * exposes the four operations the vertical slice needs:
 *   • Record  — start capturing a world snapshot (physics + GOAP agents) each
 *               fixed tick via the demo's Recorder (no own loop; the time-core
 *               scheduler drives capture).
 *   • Stop    — stop capturing and freeze the recording.
 *   • Save    — serialize the recording to deterministic bytes and download it.
 *   • Load    — read a recording back from a byte file.
 *   • Play    — reconstruct the world tick-for-tick with Playback and report the
 *               final observable state (proof the run reproduces exactly).
 *
 * All engine logic lives in ./replay.ts (pure, headlessly tested); this
 * component only wires those helpers to the DOM.
 */

import { useRef, useState } from 'react';
import type { Demo } from './engine';
import {
  captureRecording,
  recordedFrameCount,
  recordingToBytes,
  recordingFromBytes,
  playRecordingTo,
  recordingTicks,
  seekTo,
  type Recording,
} from './replay';
import { TimelineViewer } from './timeline-viewer';

const panelBtn: React.CSSProperties = {
  background: '#13202e', color: '#d8e0ea', border: '1px solid #25384c',
  padding: '5px 10px', borderRadius: 4, cursor: 'pointer', fontSize: 12,
};

const panelRec: React.CSSProperties = {
  background: '#2e1320', color: '#f0a9c0', border: '1px solid #50253a',
  padding: '5px 10px', borderRadius: 4, cursor: 'pointer', fontSize: 12,
};

const panelGood: React.CSSProperties = {
  background: '#132e1c', color: '#a9f0c0', border: '1px solid #255033',
  padding: '5px 10px', borderRadius: 4, cursor: 'pointer', fontSize: 12,
};

export interface ReplayPanelProps {
  /** Ref to the live demo whose Recorder we drive. */
  demoRef: React.MutableRefObject<Demo | null>;
}

export function ReplayPanel({ demoRef }: ReplayPanelProps) {
  const [recording, setRecording] = useState(false);
  const [frameCount, setFrameCount] = useState(0);
  const [currentTick, setCurrentTick] = useState(0);
  const [seekState, setSeekState] = useState<{ bodies: number; agents: number } | null>(null);
  const [status, setStatus] = useState<{ kind: 'ok' | 'err' | 'idle'; msg: string }>({
    kind: 'idle',
    msg: 'Record the running world, then Save / Load / Play the deterministic capture',
  });
  const heldRec = useRef<Recording | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  function refreshCount() {
    const demo = demoRef.current;
    if (demo) setFrameCount(recordedFrameCount(demo));
  }

  function onRecord() {
    const demo = demoRef.current;
    if (!demo) {
      setStatus({ kind: 'err', msg: 'no running demo — generate a world first' });
      return;
    }
    demo.startRecording();
    setRecording(true);
    setStatus({ kind: 'ok', msg: 'recording… run the demo to capture ticks' });
  }

  function onStop() {
    const demo = demoRef.current;
    if (!demo) return;
    demo.stopRecording();
    setRecording(false);
    const rec = captureRecording(demo);
    heldRec.current = rec;
    const n = rec?.frames.length ?? 0;
    setFrameCount(n);
    setCurrentTick(rec ? recordingTicks(rec)[0] ?? 0 : 0);
    setSeekState(null);
    setStatus({ kind: 'ok', msg: `stopped — captured ${n} tick(s)` });
  }

  function onSeek(tick: number) {
    const rec = heldRec.current;
    if (!rec || rec.frames.length === 0) return;
    setCurrentTick(tick);
    const state = seekTo(rec, tick);
    setSeekState({ bodies: state.physics.length, agents: state.agents.length });
  }

  function onSave() {
    const demo = demoRef.current;
    const rec = heldRec.current ?? (demo ? captureRecording(demo) : null);
    if (!rec || rec.frames.length === 0) {
      setStatus({ kind: 'err', msg: 'nothing recorded yet — Record then Stop first' });
      return;
    }
    const bytes = recordingToBytes(rec);
    const blob = new Blob([bytes.buffer as ArrayBuffer], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'omega-run.omgrec';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setStatus({ kind: 'ok', msg: `saved ${rec.frames.length} frames (${bytes.length} deterministic bytes)` });
  }

  function onLoadFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const bytes = new Uint8Array(reader.result as ArrayBuffer);
        const rec = recordingFromBytes(bytes);
        heldRec.current = rec;
        setFrameCount(rec.frames.length);
        setStatus({ kind: 'ok', msg: `loaded ${rec.frames.length} frames from file` });
      } catch (err) {
        setStatus({ kind: 'err', msg: `load failed: ${(err as Error).message}` });
      }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = '';
  }

  function onPlay() {
    const rec = heldRec.current;
    if (!rec || rec.frames.length === 0) {
      setStatus({ kind: 'err', msg: 'nothing to play — Record/Stop or Load a file first' });
      return;
    }
    const ticks = recordingTicks(rec);
    const lastTick = ticks[ticks.length - 1]!;
    const state = playRecordingTo(rec, lastTick);
    setStatus({
      kind: 'ok',
      msg:
        `played ${rec.frames.length} ticks → reconstructed ${state.physics.length} ` +
        `bodies + ${state.agents.length} agents deterministically`,
    });
  }

  return (
    <div style={{ marginTop: 24 }}>
      <h3 style={{ marginTop: 0 }}>Replay (record / playback)</h3>
      <p style={{ color: '#8fa3b8', fontSize: 11, lineHeight: 1.5 }}>
        Capture the running world (physics + GOAP agents) per tick with{' '}
        <code>@omega/replay</code>, round-trip it to a byte-stable file, and play
        it back — the reconstruction is deterministic tick-for-tick.
      </p>
      <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
        {recording ? (
          <button onClick={onStop} style={panelRec}>⏹ Stop</button>
        ) : (
          <button onClick={onRecord} style={panelRec}>⏺ Record</button>
        )}
        <button onClick={onPlay} style={panelGood}>▶ Play</button>
        <button onClick={onSave} style={panelBtn}>💾 Save file</button>
        <button onClick={() => fileRef.current?.click()} style={panelBtn}>📂 Load file</button>
        <input
          ref={fileRef}
          type="file"
          accept=".omgrec,application/octet-stream"
          onChange={onLoadFile}
          style={{ display: 'none' }}
        />
        <button onClick={refreshCount} style={panelBtn}>↻ Frames</button>
      </div>
      <div style={{ marginTop: 10 }}>
        <TimelineViewer recording={heldRec.current} currentTick={currentTick} onSeek={onSeek} />
        {seekState && (
          <div style={{ marginTop: 4, color: '#67c8ff', fontSize: 11 }}>
            frame @ tick {currentTick}: {seekState.bodies} bodies + {seekState.agents} agents (deterministic)
          </div>
        )}
      </div>
      <div style={{ marginTop: 8, color: '#5b6b7d', fontSize: 11 }}>
        captured frames: <b style={{ color: '#d8e0ea' }}>{frameCount}</b>
        {recording ? ' (recording…)' : ''}
      </div>
      <div
        style={{
          marginTop: 8, fontSize: 11, padding: '6px 8px', borderRadius: 4,
          background: status.kind === 'err' ? '#2a0f16' : status.kind === 'ok' ? '#0f2418' : '#11181f',
          color: status.kind === 'err' ? '#ffb4c4' : status.kind === 'ok' ? '#a9f0c0' : '#8fa3b8',
          border: '1px solid ' + (status.kind === 'err' ? '#4a1a26' : status.kind === 'ok' ? '#1d3a28' : '#1b2735'),
        }}
      >
        {status.msg}
      </div>
    </div>
  );
}
