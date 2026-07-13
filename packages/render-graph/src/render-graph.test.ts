/**
 * render-graph Spike tests — the evidence the graph orchestration works.
 *
 * Headless (Node): no WebGL needed. We assert the orchestration logic that
 * matters for correctness + determinism:
 *   - topological order respects dependencies (G-Buffer before GTAO before PBR)
 *   - cycles are rejected (fail-fast, no silent wrong order)
 *   - same pass set + seed => identical execution order every time
 *   - FBO pool is deterministic (same spec => same id, reused not reallocated)
 *   - ComposePass wires its inputs by id and records the blend uniforms
 *
 * The GL draw itself is mocked via `run`; the real backend (apps/web) supplies
 * actual shaders. This test proves the GRAPH is sound before we port it.
 */
import { describe, it, expect } from 'vitest';
import { RenderGraph } from './graph.js';
import { FramebufferPool } from './fbo.js';
import { ComposePass } from './compose.js';
import type { RenderPass, PassTarget } from './pass.js';

/** Minimal pass that records it ran, in execution order. */
function pass(id: string, inputs: string[] = []): RenderPass {
  return {
    id,
    inputs,
    execute(_inputs, _target, _ctx) {
      EXEC_LOG.push(id);
    },
  };
}

let EXEC_LOG: string[] = [];

describe('RenderGraph ordering', () => {
  it('orders G-Buffer -> GTAO -> PBR (dependencies respected)', () => {
    EXEC_LOG.length = 0;
    const g = new RenderGraph();
    g.add(pass('pbr', ['gtao', 'scene']));
    g.add(pass('gtao', ['gbuffer']));
    g.add(pass('gbuffer', ['scene']));
    g.add(pass('scene')); // external feed (no producer in graph)
    g.build();
    expect(g.executionOrder).toEqual(['scene', 'gbuffer', 'gtao', 'pbr']);
  });

  it('is deterministic: same set + seed => identical order across builds', () => {
    const make = () => {
      const g = new RenderGraph();
      g.add(pass('pbr', ['gtao', 'scene']));
      g.add(pass('gtao', ['gbuffer']));
      g.add(pass('gbuffer', ['scene']));
      g.add(pass('scene'));
      g.build();
      return g.executionOrder;
    };
    const a = make();
    const b = make();
    expect(a).toEqual(b);
    expect(a).toEqual(['scene', 'gbuffer', 'gtao', 'pbr']);
  });

  it('rejects cycles at build time', () => {
    const g = new RenderGraph();
    g.add(pass('a', ['b']));
    g.add(pass('b', ['a']));
    expect(() => g.build()).toThrow(/cycle/i);
  });

  it('throws on duplicate pass id', () => {
    const g = new RenderGraph();
    g.add(pass('dup'));
    expect(() => g.add(pass('dup'))).toThrow(/duplicate/i);
  });
});

describe('RenderGraph.execute', () => {
  it('runs passes in topo order and feeds inputs by id', () => {
    EXEC_LOG.length = 0;
    const g = new RenderGraph();
    g.add(pass('gbuffer', ['scene']));
    g.add(pass('gtao', ['gbuffer']));
    g.add(pass('pbr', ['gtao', 'scene']));
    g.add(pass('scene'));

    let allocs = 0;
    g.execute({
      seed: 1,
      width: 256,
      height: 256,
      feeds: new Map([['scene', { type: 'scene' }]]),
      alloc: () => {
        allocs++;
        return { tex: allocs };
      },
      run: (p, inputs, _target) => {
        EXEC_LOG.push(p.id); // the backend would call p.execute() here
        // Verify upstream outputs are present when a pass runs.
        if (p.id === 'gtao') expect(inputs.has('gbuffer')).toBe(true);
        if (p.id === 'pbr') {
          expect(inputs.has('gtao')).toBe(true);
          expect(inputs.has('scene')).toBe(true);
        }
      },
    });
    expect(EXEC_LOG).toEqual(['scene', 'gbuffer', 'gtao', 'pbr']);
  });

  it('same seed => same execution (determinism contract)', () => {
    const orderFor = (seed: number) => {
      EXEC_LOG.length = 0;
      const g = new RenderGraph();
      g.add(pass('gbuffer', ['scene']));
      g.add(pass('gtao', ['gbuffer']));
      g.add(pass('pbr', ['gtao', 'scene']));
      g.add(pass('scene'));
      g.execute({
        seed,
        width: 64,
        height: 64,
        feeds: new Map([['scene', {}]]),
        alloc: () => ({}),
        run: (p) => { EXEC_LOG.push(p.id); },
      });
      return EXEC_LOG.join(',');
    };
    expect(orderFor(42)).toEqual(orderFor(42));
    expect(orderFor(42)).toEqual('scene,gbuffer,gtao,pbr');
  });
});

describe('FramebufferPool', () => {
  it('reuses same id for identical spec (deterministic)', () => {
    const pool = new FramebufferPool(() => ({}));
    const a = pool.acquire({ width: 256, height: 256, format: 'rgba8' });
    const b = pool.acquire({ width: 256, height: 256, format: 'rgba8' });
    expect(a).toBe(b); // same spec => same id, reused
    expect(pool.size).toBe(1);
  });

  it('allocates distinct ids for distinct specs', () => {
    const pool = new FramebufferPool(() => ({}));
    const a = pool.acquire({ width: 256, height: 256, format: 'rgba8' });
    const b = pool.acquire({ width: 256, height: 256, format: 'r16f' });
    expect(a).not.toBe(b);
    expect(pool.size).toBe(2);
  });
});

describe('ComposePass', () => {
  it('wires inputs by id and records blend weights', () => {
    const cp = new ComposePass('composite', [
      { id: 'pbr', weight: 1.0 },
      { id: 'bloom', weight: 0.3 },
    ]);
    const inputs = new Map<string, unknown>([['pbr', {}], ['bloom', {}]]);
    cp.execute(inputs, null as PassTarget, { width: 64, height: 64, seed: 1 });
    expect(cp.lastUniforms).toEqual({ weights: [1.0, 0.3], bias: [0, 0, 0] });
    expect(inputs.has('composite')).toBe(true); // produced output keyed by id
  });

  it('does not produce output if an input is missing', () => {
    const cp = new ComposePass('composite', [{ id: 'pbr', weight: 1.0 }]);
    const inputs = new Map<string, unknown>(); // pbr absent
    cp.execute(inputs, null as PassTarget, { width: 64, height: 64, seed: 1 });
    expect(inputs.has('composite')).toBe(false);
  });
});
