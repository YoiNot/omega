import { describe, it, expect } from 'vitest';
import { Profiler, ProfilerScope, profiler, profile, scope } from './index.js';

describe('profiler counters', () => {
  it('accumulates calls and cost deterministically', () => {
    const p = new Profiler();
    p.profile('load', () => 1, { cost: 10 });
    p.profile('load', () => 2, { cost: 10 });
    p.profile('save', () => 3, { cost: 5 });
    const r = p.report();
    expect(r.schema).toBe('omega-profiler/1');

    const load = r.scopes.find((s) => s.name === 'load')!;
    const save = r.scopes.find((s) => s.name === 'save')!;
    expect(load.calls).toBe(2);
    expect(load.totalCost).toBe(20);
    expect(load.averageCost).toBe(10);
    expect(save.calls).toBe(1);
    expect(save.totalCost).toBe(5);
  });

  it('ProfilerScope enter/exit tracks depth', () => {
    const p = new Profiler();
    {
      const s = new ProfilerScope(p, 'rec');
      s.charge(3);
      {
        const s2 = new ProfilerScope(p, 'rec'); // nested same name
        s2.charge(1);
      }
      s.close();
    }
    const rec = p.report().scopes.find((s) => s.name === 'rec')!;
    expect(rec.calls).toBe(2);
    expect(rec.totalCost).toBe(4);
    expect(rec.maxDepth).toBe(2);
  });

  it('same call sequence => identical report (stable order)', () => {
    const run = () => {
      const p = new Profiler();
      p.profile('a', () => {}, { cost: 2 });
      p.profile('b', () => {}, { cost: 3 });
      p.profile('a', () => {}, { cost: 2 });
      p.profile('c', () => {}, { cost: 1 });
      return JSON.stringify(p.report());
    };
    expect(run()).toBe(run());
  });

  it('scopes are sorted by name for byte-identical JSON', () => {
    const p = new Profiler();
    p.profile('zebra', () => {});
    p.profile('alpha', () => {});
    p.profile('mango', () => {});
    const names = p.report().scopes.map((s) => s.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });

  it('shared singleton profilers are distinct instances', () => {
    profiler.reset();
    const p = new Profiler();
    profile('x', () => {}, { cost: 1 });
    expect(profiler.report().scopes.find((s) => s.name === 'x')?.calls).toBe(1);
    expect(p.report().scopes.find((s) => s.name === 'x')).toBeUndefined();
    scope('y');
    profiler.exit();
  });

  it('cost-from-Rng is reproducible with a seed', () => {
    const a = new Profiler();
    const b = new Profiler();
    const fn = () => 42;
    a.profile('w', fn, { cost: (rng) => rng.nextInt(1, 10), seed: 5 });
    b.profile('w', fn, { cost: (rng) => rng.nextInt(1, 10), seed: 5 });
    expect(a.report().scopes[0].totalCost).toBe(b.report().scopes[0].totalCost);
  });
});
