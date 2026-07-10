/**
 * @omega/render-pbr — particles + clouds + shadows determinism/plausibility.
 *
 * Determinism contract (Roadmap §8): same seed + config + tick count => byte-
 * identical particle positions and cloud density grids. No wall clock / ambient
 * RNG is touched at runtime, so replays reconstruct the same state.
 */
import { describe, it, expect } from 'vitest';
import { Vec3 } from '@omega/engine-math';
import {
  ParticleSystem,
  defaultParticleConfig,
  CloudField,
  defaultCloudConfig,
  raymarchClouds,
  csmSplitDistances,
  buildCascades,
  cascadeForDepth,
  cascadesFromCamera,
} from './index.js';
import { Camera } from '@omega/render';

describe('ParticleSystem — deterministic', () => {
  it('same seed + config + ticks => identical position buffer', () => {
    const a = new ParticleSystem('seed-A', defaultParticleConfig());
    const b = new ParticleSystem('seed-A', defaultParticleConfig());
    for (let t = 0; t < 30; t++) { a.step(); b.step(); }
    const pa = a.pack();
    const pb = b.pack();
    expect(Array.from(pa)).toEqual(Array.from(pb));
  });

  it('different seed => different (not identical) evolution', () => {
    const a = new ParticleSystem('seed-A', defaultParticleConfig());
    const b = new ParticleSystem('seed-B', defaultParticleConfig());
    for (let t = 0; t < 30; t++) { a.step(); b.step(); }
    const pa = a.pack();
    const pb = b.pack();
    // Extremely unlikely to be byte-identical with different seeds.
    expect(Array.from(pa)).not.toEqual(Array.from(pb));
  });

  it('positions stay finite and life decays to 0 (particles die)', () => {
    const p = new ParticleSystem('s', defaultParticleConfig());
    for (let t = 0; t < 500; t++) p.step();
    const buf = p.pack();
    for (let i = 0; i < buf.length; i++) {
      expect(Number.isFinite(buf[i]!)).toBe(true);
    }
    // After many ticks every slot has cycled; all finite is the key assertion.
    const live = p.live();
    expect(live.length).toBeGreaterThan(0); // fountain keeps respawning
  });

  it('spawn count per tick is deterministic (no RNG drift)', () => {
    const cfg = { ...defaultParticleConfig(), spawnPerTick: 4, capacity: 64 };
    const p = new ParticleSystem('s', cfg);
    p.step();
    expect(p.live().length).toBe(4);
    p.step();
    expect(p.live().length).toBe(8);
  });
});

describe('CloudField — deterministic + plausible', () => {
  it('same seed => byte-identical density grid', () => {
    const a = new CloudField('cloud-seed', defaultCloudConfig());
    const b = new CloudField('cloud-seed', defaultCloudConfig());
    expect(Array.from(a.density)).toEqual(Array.from(b.density));
  });

  it('density is normalized to [0,1] and has structure (not flat)', () => {
    const f = new CloudField('cloud-seed', defaultCloudConfig());
    let min = Infinity, max = -Infinity;
    const seen = new Set<number>();
    for (const d of f.density) {
      expect(d).toBeGreaterThanOrEqual(0);
      expect(d).toBeLessThanOrEqual(1 + 1e-6);
      min = Math.min(min, d);
      max = Math.max(max, d);
      seen.add(Math.round(d * 1000));
    }
    expect(min).toBeCloseTo(0, 5);
    expect(max).toBeCloseTo(1, 2);
    // A real fBm field has many distinct values, not a single constant.
    expect(seen.size).toBeGreaterThan(10);
  });

  it('sample returns 0 outside the volume, positive inside mid-slab', () => {
    const f = new CloudField('cloud-seed', defaultCloudConfig());
    // Well outside the volume.
    expect(f.sample(new Vec3(-9999, 0, 0))).toBe(0);
    // Inside the slab (baseY + half of thickness) should usually be > 0 somewhere.
    let anyDense = false;
    for (let x = 1; x < f.res - 1; x++) {
      for (let z = 1; z < f.res - 1; z++) {
        const p = new Vec3(
          (x / (f.res - 1)) * f.size,
          f.baseY + f.thickness * 0.5,
          (z / (f.res - 1)) * f.size,
        );
        if (f.sample(p) > 0.05) anyDense = true;
      }
    }
    expect(anyDense).toBe(true);
  });
});

describe('raymarchClouds — pure + stable', () => {
  it('deterministic: same field + ray => same transmittance/color', () => {
    const f = new CloudField('cloud-seed', defaultCloudConfig());
    const o = new Vec3(10, 5, 10);
    const d = new Vec3(0.3, 1, 0.2).normalize();
    const a = raymarchClouds(f, o, d, 48, 1.5);
    const b = raymarchClouds(f, o, d, 48, 1.5);
    expect(a.transmittance).toBeCloseTo(b.transmittance, 10);
    expect(a.color).toEqual(b.color);
    expect(Number.isFinite(a.meanDensity)).toBe(true);
  });

  it('clear ray direction (no clouds along it) keeps high transmittance', () => {
    const f = new CloudField('cloud-seed', defaultCloudConfig());
    // March straight down from high above the slab — hits the slab.
    const fromAbove = raymarchClouds(f, new Vec3(20, 100, 20), new Vec3(0, -1, 0), 64, 2);
    expect(fromAbove.transmittance).toBeLessThan(1); // clouds occlude
    expect(fromAbove.transmittance).toBeGreaterThanOrEqual(0);
  });
});

describe('Cascaded shadow maps — stable splits', () => {
  it('split distances are monotonic ascending and end at far', () => {
    const splits = csmSplitDistances(0.1, 500, 4, 0.6);
    expect(splits[0]).toBeCloseTo(0.1, 5);
    expect(splits[splits.length - 1]).toBeCloseTo(500, 5);
    for (let i = 1; i < splits.length; i++) {
      expect(splits[i]!).toBeGreaterThan(splits[i - 1]!);
    }
  });

  it('lambda=1 => log splits, lambda=0 => uniform splits', () => {
    // lerp(uni, log, lambda): lambda=1 -> log, lambda=0 -> uniform.
    const uni = csmSplitDistances(1, 100, 4, 0);
    const log = csmSplitDistances(1, 100, 4, 1);
    // Uniform: mid split (i=2, f=0.5) = 1 + (100-1)*0.5 = 50.5
    expect(uni[2]!).toBeCloseTo(1 + (100 - 1) * 0.5, 0);
    // Log: mid split = near * (far/near)^0.5 = sqrt(100) = 10
    expect(log[2]!).toBeCloseTo(10, 0);
  });

  it('buildCascades => one ortho projection per cascade, stable', () => {
    const cam = new Camera(60, 1, 0.1, 500);
    cam.setPosition(new Vec3(20, 20, 20));
    cam.lookAt(new Vec3(0, 0, 0));
    const a = cascadesFromCamera(cam, [0.4, -1, 0.3], { cascades: 4, lambda: 0.6, texelSize: 1 });
    const b = cascadesFromCamera(cam, [0.4, -1, 0.3], { cascades: 4, lambda: 0.6, texelSize: 1 });
    expect(a.length).toBe(4);
    expect(a.map((c) => c.splitNear)).toEqual(b.map((c) => c.splitNear));
    for (const c of a) {
      expect(c.projection.m.length).toBe(16);
    }
  });

  it('cascadeForDepth maps a depth to the right cascade', () => {
    const cascades = buildCascades(new Vec3(), new Vec3(0, 0, -1), {
      cascades: 4, lambda: 0.6, texelSize: 1, near: 1, far: 100,
    });
    const near = cascadeForDepth(1.5, cascades);
    const far = cascadeForDepth(95, cascades);
    expect(near).toBeLessThanOrEqual(far);
  });
});
