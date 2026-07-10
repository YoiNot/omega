/**
 * apps/web — Modding manifest editor panel (deterministic).
 *
 * A slim, data-driven control surface over @omega/modding that lives inside the
 * existing apps/web demo (React/TSX). It lets the user edit a ModManifest as
 * text, apply it to the running demo world via `applyMod`, and round-trip it to
 * a deterministic byte file via `loadModManifest`/`saveModManifest`.
 *
 * There is NO own event loop: applying a manifest mutates `demo.coreWorld` in
 * place, and the already-running time-core scheduler steps the world on the
 * next fixed tick — so the change shows up deterministically in the existing
 * HUD/metrics. Pure helpers (parse/serialize/apply) live in ./modding.ts and are
 * unit-tested headlessly; this component only wires them to the DOM.
 */

import { useEffect, useRef, useState } from 'react';
import type { Demo } from './engine';
import {
  defaultManifest,
  manifestToJson,
  parseManifestJson,
  saveManifestToBytes,
  loadManifestFromBytes,
  applyManifestToDemo,
  type ModManifest,
} from './modding';

const panelBtn: React.CSSProperties = {
  background: '#13202e', color: '#d8e0ea', border: '1px solid #25384c',
  padding: '5px 10px', borderRadius: 4, cursor: 'pointer', fontSize: 12,
};

const panelGood: React.CSSProperties = {
  background: '#132e1c', color: '#a9f0c0', border: '1px solid #255033',
  padding: '5px 10px', borderRadius: 4, cursor: 'pointer', fontSize: 12,
};

export interface ModdingPanelProps {
  /** Ref to the live demo so we apply mods to its running core world. */
  demoRef: React.MutableRefObject<Demo | null>;
}

export function ModdingPanel({ demoRef }: ModdingPanelProps) {
  const [text, setText] = useState(() => manifestToJson(defaultManifest()));
  const [status, setStatus] = useState<{ kind: 'ok' | 'err' | 'idle'; msg: string }>({
    kind: 'idle',
    msg: 'edit the manifest, then Apply to the running world',
  });
  const fileRef = useRef<HTMLInputElement | null>(null);

  // Keep the editor seeded with the default when the demo is (re)generated.
  useEffect(() => {
    setText(manifestToJson(defaultManifest()));
  }, []);

  function apply() {
    const demo = demoRef.current;
    if (!demo) {
      setStatus({ kind: 'err', msg: 'no running demo — generate a world first' });
      return;
    }
    let manifest;
    try {
      manifest = parseManifestJson(text);
    } catch (e) {
      setStatus({ kind: 'err', msg: (e as Error).message });
      return;
    }
    applyToDemo(demo, manifest);
    const applied = manifest.rules.length + manifest.content.length;
    setStatus({
      kind: 'ok',
      msg: `applied ${applied} patch(es) → world changed deterministically`,
    });
  }

  function onLoadFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const bytes = new Uint8Array(reader.result as ArrayBuffer);
        const manifest = loadManifestFromBytes(bytes);
        setText(manifestToJson(manifest));
        setStatus({ kind: 'ok', msg: `loaded "${manifest.id}" from file` });
      } catch (err) {
        setStatus({ kind: 'err', msg: `load failed: ${(err as Error).message}` });
      }
    };
    reader.readAsArrayBuffer(file);
    // Allow re-selecting the same file later.
    e.target.value = '';
  }

  function onSaveFile() {
    let manifest;
    try {
      manifest = parseManifestJson(text);
    } catch (e) {
      setStatus({ kind: 'err', msg: (e as Error).message });
      return;
    }
    const bytes = saveManifestToBytes(manifest);
    const blob = new Blob([bytes.buffer as ArrayBuffer], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${manifest.id || 'manifest'}.omgmod`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setStatus({ kind: 'ok', msg: `saved "${manifest.id}" (${bytes.length} deterministic bytes)` });
  }

  return (
    <div style={{ marginTop: 24 }}>
      <h3 style={{ marginTop: 0 }}>Modding (ModManifest)</h3>
      <p style={{ color: '#8fa3b8', fontSize: 11, lineHeight: 1.5 }}>
        Edit a deterministic <code>@omega/modding</code> manifest, Apply it to the
        running world, or round-trip it to a byte-stable file.
      </p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        spellCheck={false}
        style={{
          width: '100%', height: 220, background: '#0d1620', color: '#d8e0ea',
          border: '1px solid #1b2735', borderRadius: 4, fontFamily: 'monospace',
          fontSize: 11, padding: 8, resize: 'vertical',
        }}
      />
      <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
        <button onClick={apply} style={panelGood}>⚡ Apply to world</button>
        <button onClick={onSaveFile} style={panelBtn}>💾 Save file</button>
        <button onClick={() => fileRef.current?.click()} style={panelBtn}>📂 Load file</button>
        <input
          ref={fileRef}
          type="file"
          accept=".omgmod,application/octet-stream"
          onChange={onLoadFile}
          style={{ display: 'none' }}
        />
        <button onClick={() => setText(manifestToJson(defaultManifest()))} style={panelBtn}>
          ↺ Reset
        </button>
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

/**
 * Apply a parsed manifest to a demo. Exported (and kept side-effect-free apart
 * from the in-place world mutation) so it can be unit-tested without the DOM.
 */
export function applyToDemo(demo: Demo, manifest: ModManifest): void {
  applyManifestToDemo(demo, manifest);
}
