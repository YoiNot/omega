/**
 * @omega/render-pbr — GPU particle system (deterministic, seeded).
 *
 * Particles are simulated as a PURE function of (seed, config, tick). Spawn
 * positions + per-particle velocity/life are drawn from `@omega/engine-core`
 * `Rng` (splitmix64/xoshiro, identical across platforms). Update is a closed
 * form over Vec3 math. The same seed + config + tick count ALWAYS yields the
 * identical position buffer — this is what the package determinism test pins.
 *
 * The system is backend-agnostic: it produces a flat Float32Array of
 * interleaved [x,y,z, life, ...] that a WebGL2 or WebGPU backend uploads
 * to a vertex/index buffer. No GL is touched here.
 */

import { Vec3, clamp01 } from '@omega/engine-math';
import { Rng } from '@omega/engine-core';

/** One particle's mutable state (kept CPU-side; mirrored to the GPU buffer). */
export interface Particle {
  pos: Vec3;
  vel: Vec3;
  /** remaining life in [0,1]; 0 = dead. */
  life: number;
  /** total lifespan (ticks) used to normalize `life`. */
  maxLife: number;
  /** seed used to respawn this slot deterministically. */
  slotSeed: number;
}

/** Spawn + simulation configuration (pure data). */
export interface ParticleConfig {
  /** maximum simultaneous particles. */
  capacity: number;
  /** spawn rate (particles per tick) — deterministic, fractional accumulates. */
  spawnPerTick: number;
  /** initial speed range [min,max] (world units / tick). */
  speed: [number, number];
  /** upward bias added to each spawn velocity (e.g. smoke rises). */
  buoyancy: number;
  /** per-tick velocity damping in [0,1]; 1 = no damping. */
  damping: number;
  /** constant acceleration (e.g. gravity) applied each tick. */
  gravity: [number, number, number];
  /** spawn origin (world space). */
  origin: [number, number, number];
  /** spawn volume half-extents (box around origin). */
  spread: [number, number, number];
  /** base lifespan in ticks. */
  lifespan: number;
}

/** Deterministic default: a gentle rising ember fountain. */
export function defaultParticleConfig(): ParticleConfig {
  return {
    capacity: 1024,
    spawnPerTick: 8,
    speed: [0.02, 0.12],
    buoyancy: 0.05,
    damping: 0.985,
    gravity: [0, -0.01, 0],
    origin: [0, 0.5, 0],
    spread: [3, 0.2, 3],
    lifespan: 240,
  };
}

/**
 * Deterministic particle system. Owns a fixed-capacity pool; spawn positions
 * and velocities are derived from a single seeded `Rng` so two systems with the
 * same (seed, config) evolve identically tick-for-tick.
 */
export class ParticleSystem {
  readonly capacity: number;
  private readonly cfg: ParticleConfig;
  private readonly rng: Rng;
  private readonly particles: Particle[];
  private spawnAccumulator = 0;
  /** monotonic tick counter (never a wall clock). */
  tick = 0;

  constructor(seed: string | number | bigint, cfg: ParticleConfig = defaultParticleConfig()) {
    this.capacity = cfg.capacity;
    this.cfg = cfg;
    this.rng = new Rng(seed);
    this.particles = [];
    for (let i = 0; i < this.capacity; i++) {
      this.particles.push({
        pos: new Vec3(),
        vel: new Vec3(),
        life: 0,
        maxLife: cfg.lifespan,
        slotSeed: i,
      });
    }
  }

  /** Pure spawn: pick the next dead slot and (re)seed its velocity. */
  private spawnOne(): void {
    // Find first dead slot (deterministic scan order).
    let slot = -1;
    for (let i = 0; i < this.capacity; i++) {
      if (this.particles[i]!.life <= 0) {
        slot = i;
        break;
      }
    }
    if (slot < 0) return; // pool full — deterministic no-op.
    const p = this.particles[slot]!;
    const c = this.cfg;
    // Deterministic position inside the spawn box.
    const px = c.origin[0] + this.rng.nextRange(-c.spread[0], c.spread[0]);
    const py = c.origin[1] + this.rng.nextRange(-c.spread[1], c.spread[1]);
    const pz = c.origin[2] + this.rng.nextRange(-c.spread[2], c.spread[2]);
    p.pos.set(px, py, pz);
    // Deterministic initial velocity (radial + buoyancy).
    const speed = this.rng.nextRange(c.speed[0], c.speed[1]);
    const theta = this.rng.nextRange(0, Math.PI * 2);
    p.vel.set(Math.cos(theta) * speed, c.buoyancy + speed * 0.5, Math.sin(theta) * speed);
    p.maxLife = c.lifespan;
    p.life = 1;
    // Advance RNG by the slot seed so respawn order stays deterministic.
    this.rng.nextU64(); void p.slotSeed;
  }

  /** Advance one tick: spawn, integrate, kill dead. Pure given (seed, cfg). */
  step(): void {
    const c = this.cfg;
    this.spawnAccumulator += c.spawnPerTick;
    while (this.spawnAccumulator >= 1) {
      this.spawnOne();
      this.spawnAccumulator -= 1;
    }
    for (let i = 0; i < this.capacity; i++) {
      const p = this.particles[i]!;
      if (p.life <= 0) continue;
      // Integrate velocity (damping + gravity), then position.
      p.vel.x = p.vel.x * c.damping + c.gravity[0];
      p.vel.y = p.vel.y * c.damping + c.gravity[1];
      p.vel.z = p.vel.z * c.damping + c.gravity[2];
      p.pos.x += p.vel.x;
      p.pos.y += p.vel.y;
      p.pos.z += p.vel.z;
      // Decay life (1/lifespan per tick).
      p.life = clamp01(p.life - 1 / Math.max(1, p.maxLife));
    }
    this.tick++;
  }

  /** Read-only snapshot of live particles (life > 0). */
  live(): readonly Particle[] {
    return this.particles.filter((p) => p.life > 0);
  }

  /**
   * Pack the live particles into a flat interleaved GPU buffer:
   *   [x, y, z, life, size, ...]  (size derived from life for fade).
   * Dead slots are emitted with life=0 (backend can discard via alpha).
   * Deterministic: identical (seed, cfg, ticks) => identical bytes.
   */
  pack(stride = 6): Float32Array {
    const out = new Float32Array(this.capacity * stride);
    for (let i = 0; i < this.capacity; i++) {
      const p = this.particles[i]!;
      const o = i * stride;
      out[o + 0] = p.pos.x;
      out[o + 1] = p.pos.y;
      out[o + 2] = p.pos.z;
      out[o + 3] = p.life;
      out[o + 4] = 0.15 + p.life * 0.25; // size fades in/out with life
      out[o + 5] = p.life; // alpha = life (redundant w/ life for clarity)
    }
    return out;
  }
}
