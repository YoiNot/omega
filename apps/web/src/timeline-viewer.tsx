/**
 * apps/web — Replay timeline viewer (scrubable).
 *
 * Renders the recorded ticks as a horizontal strip. The current tick is
 * highlighted (playhead). Clicking anywhere on the strip seeks to the nearest
 * tick — the parent wires `onSeek(tick)` to {@link seekTo} and shows the
 * reconstructed world state for that frame. Deterministic: seeking tick T
 * always shows the same world (frames are full snapshots from frame 0).
 */
import type { Recording } from './replay';
import { recordingTicks } from './replay';

const strip: React.CSSProperties = {
  position: 'relative',
  height: 28,
  background: '#0e1620',
  borderRadius: 4,
  border: '1px solid #1b2735',
  cursor: 'pointer',
  overflow: 'hidden',
  userSelect: 'none',
};

const playedShade: React.CSSProperties = {
  position: 'absolute',
  top: 0,
  left: 0,
  height: '100%',
  background: 'rgba(100,200,255,0.18)',
  pointerEvents: 'none',
};

const head: React.CSSProperties = {
  position: 'absolute',
  top: 0,
  width: 2,
  height: '100%',
  background: '#67c8ff',
  pointerEvents: 'none',
};

export interface TimelineViewerProps {
  recording: Recording | null;
  /** Current tick (playhead position). */
  currentTick: number;
  /** Called when the user scrubs to a tick. */
  onSeek: (tick: number) => void;
}

export function TimelineViewer({ recording, currentTick, onSeek }: TimelineViewerProps) {
  if (!recording || recording.frames.length === 0) {
    return (
      <div style={{ ...strip, cursor: 'default', color: '#5b6b7d', fontSize: 11, display: 'flex', alignItems: 'center', paddingLeft: 8 }}>
        no recording — Record then Stop to populate the timeline
      </div>
    );
  }
  const ticks = recordingTicks(recording);
  const first = ticks[0]!;
  const last = ticks[ticks.length - 1]!;
  const span = Math.max(1, last - first);
  const pct = ((currentTick - first) / span) * 100;

  function seekFromEvent(e: React.MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const frac = (e.clientX - rect.left) / rect.width;
    const tick = Math.round(first + frac * span);
    onSeek(Math.max(first, Math.min(tick, last)));
  }

  return (
    <div>
      <div style={strip} onClick={seekFromEvent} title="click to scrub to a tick">
        <div style={{ ...playedShade, width: `${Math.max(0, Math.min(100, pct))}%` }} />
        <div style={{ ...head, left: `${Math.max(0, Math.min(100, pct))}%` }} />
      </div>
      <div style={{ marginTop: 4, color: '#5b6b7d', fontSize: 11 }}>
        tick <b style={{ color: '#d8e0ea' }}>{currentTick}</b> / {last}
        {'  '}({recording.frames.length} frames captured)
      </div>
    </div>
  );
}
