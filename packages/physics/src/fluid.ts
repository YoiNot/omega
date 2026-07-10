/**
 * @omega/physics — deterministic SPH-lite particle fluid (Müller et al. 2003).
 *
 * A lightweight smoothed-particle hydrodynamics solver: each particle carries
 * position + velocity; density and pressure are recomputed every step from the
 * poly6 kernel, and pressure + viscosity forces are accumulated via the spiky
 * gradient / viscosity-laplacian kernels. The particle array is the single
 * source of truth and is always iterated in ascending index order, so the sim
 * is a pure function of (initial particle state, parameters, dt sequence).
 *
 * Determinism contract:
 *   - No Math.random / Date.now / performance.now in the core.
 *   - Optional initial placement can be seeded via `@omega/engine-core`'s Rng,
 *     but that call is made by the caller (per the engine's "seeded RNG lives
 *     at the boundary" convention) — the solver itself never reads a clock.
 *   - O(n²) neighbour loop (fine for a *light* fluid), index-deterministic.
 */

import { Vec3 } from '@omega/engine-math';

export interface FluidParticle {
  id: number;
  position: Vec3;
  velocity: Vec3;
  /** Force accumulator, reset each step. */
  force: Vec3;
  density: number;
  pressure: number;
  mass: number;
}

export interface FluidWorldOptions {
  /** Smoothing radius h. Default 0.6. */
  smoothingRadius?: number;
  /** Rest density ρ0. Default 1000. */
  restDensity?: number;
  /** Gas stiffness k (pressure = k*(ρ-ρ0)). Default 200. */
  stiffness?: number;
  /** Viscosity μ. Default 50. */
  viscosity?: number;
  /** Particle mass m. Default 1. */
  mass?: number;
  /** Gravity. Default (0,-9.81,0). */
  gravity?: Vec3;
  /**
   * Axis-aligned containment box [min, max] per axis. Particles outside are
   * reflected back (velocity inverted with a tiny restitution). Set an axis'
   * bound to ±Infinity to leave it open. Default (-∞..+∞) i.e. unbounded.
   */
  bounds?: { min: Vec3; max: Vec3 };
  /** Wall restitution on reflection. Default 0.2. */
  wallRestitution?: number;
}

const PI = Math.PI;

/** Precomputed kernel normalization constants for a given smoothing radius. */
function kernelCoeffs(h: number): {
  poly6: number;
  spikyGrad: number;
  viscLap: number;
} {
  const h2 = h * h;
  return {
    // 315 / (64 π h^9)
    poly6: 315 / (64 * PI * h2 * h2 * h2 * h * h * h),
    // -45 / (π h^6)
    spikyGrad: -45 / (PI * h2 * h2 * h2 * h * h * h),
    // 45 / (π h^6)
    viscLap: 45 / (PI * h2 * h2 * h2 * h * h * h),
  };
}

/**
 * A small deterministic SPH fluid world.
 */
export class FluidWorld {
  readonly h: number;
  readonly restDensity: number;
  readonly stiffness: number;
  readonly viscosity: number;
  readonly mass: number;
  readonly gravity: Vec3;
  readonly bounds: { min: Vec3; max: Vec3 } | null;
  readonly wallRestitution: number;

  private readonly coeffs: { poly6: number; spikyGrad: number; viscLap: number };
  private readonly particles: FluidParticle[] = [];
  private nextId = 0;

  constructor(opts: FluidWorldOptions = {}) {
    this.h = opts.smoothingRadius ?? 0.6;
    this.restDensity = opts.restDensity ?? 1000;
    this.stiffness = opts.stiffness ?? 200;
    this.viscosity = opts.viscosity ?? 50;
    this.mass = opts.mass ?? 1;
    this.gravity = opts.gravity ? opts.gravity.clone() : new Vec3(0, -9.81, 0);
    this.bounds = opts.bounds
      ? { min: opts.bounds.min.clone(), max: opts.bounds.max.clone() }
      : null;
    this.wallRestitution = opts.wallRestitution ?? 0.2;
    this.coeffs = kernelCoeffs(this.h);
  }

  /** Add a particle; returns it (with auto id). Position/velocity cloned. */
  addParticle(position: Vec3, velocity: Vec3 = new Vec3(0, 0, 0)): FluidParticle {
    const p: FluidParticle = {
      id: this.nextId++,
      position: position.clone(),
      velocity: velocity.clone(),
      force: new Vec3(0, 0, 0),
      density: 0,
      pressure: 0,
      mass: this.mass,
    };
    this.particles.push(p);
    return p;
  }

  all(): readonly FluidParticle[] {
    return this.particles;
  }

  get count(): number {
    return this.particles.length;
  }

  /** Advance the fluid by dt seconds using the standard SPH two-pass scheme. */
  step(dt: number): void {
    const ps = this.particles;
    const n = ps.length;
    const h = this.h;
    const h2 = h * h;
    const { poly6, spikyGrad, viscLap } = this.coeffs;

    // Pass 1: density + pressure for every particle.
    for (let i = 0; i < n; i++) {
      const pi = ps[i];
      let density = 0;
      for (let j = 0; j < n; j++) {
        const pj = ps[j];
        const dx = pj.position.x - pi.position.x;
        const dy = pj.position.y - pi.position.y;
        const dz = pj.position.z - pi.position.z;
        const r2 = dx * dx + dy * dy + dz * dz;
        if (r2 < h2) {
          const diff = h2 - r2;
          density += pj.mass * poly6 * diff * diff * diff;
        }
      }
      pi.density = density > 0 ? density : this.restDensity;
      pi.pressure = this.stiffness * (pi.density - this.restDensity);
    }

    // Pass 2: pressure + viscosity force accumulation, then gravity.
    for (let i = 0; i < n; i++) {
      const pi = ps[i];
      const f = pi.force;
      f.set(this.gravity.x * pi.density * pi.mass,
            this.gravity.y * pi.density * pi.mass,
            this.gravity.z * pi.density * pi.mass);

      for (let j = 0; j < n; j++) {
        if (j === i) continue;
        const pj = ps[j];
        const dx = pj.position.x - pi.position.x;
        const dy = pj.position.y - pi.position.y;
        const dz = pj.position.z - pi.position.z;
        const r2 = dx * dx + dy * dy + dz * dz;
        if (r2 >= h2 || r2 < 1e-12) continue;
        const r = Math.sqrt(r2);

        // Pressure force (spiky gradient), direction from j->i is -r_vec.
        const term = spikyGrad * (h - r) * (h - r);
        const pTerm =
          (pi.pressure + pj.pressure) / (2 * pj.density) * term / r;
        f.x += -pTerm * dx * pj.mass;
        f.y += -pTerm * dy * pj.mass;
        f.z += -pTerm * dz * pj.mass;

        // Viscosity force (laplacian), pulls velocity toward neighbours'.
        const vTerm = viscLap * (h - r) / pj.density;
        f.x += this.viscosity * vTerm * (pj.velocity.x - pi.velocity.x) * pj.mass;
        f.y += this.viscosity * vTerm * (pj.velocity.y - pi.velocity.y) * pj.mass;
        f.z += this.viscosity * vTerm * (pj.velocity.z - pi.velocity.z) * pj.mass;
      }
    }

    // Integrate (semi-implicit Euler) + wall reflection.
    for (let i = 0; i < n; i++) {
      const pi = ps[i];
      const invRho = 1 / pi.density;
      pi.velocity.x += pi.force.x * invRho * dt;
      pi.velocity.y += pi.force.y * invRho * dt;
      pi.velocity.z += pi.force.z * invRho * dt;
      pi.position.x += pi.velocity.x * dt;
      pi.position.y += pi.velocity.y * dt;
      pi.position.z += pi.velocity.z * dt;

      if (this.bounds) this.reflect(pi);
    }
  }

  /** Reflect a particle that has escaped the containment box. */
  private reflect(p: FluidParticle): void {
    if (!this.bounds) return;
    const { min, max } = this.bounds;
    const e = this.wallRestitution;
    if (p.position.x < min.x) { p.position.x = min.x; p.velocity.x = -p.velocity.x * e; }
    else if (p.position.x > max.x) { p.position.x = max.x; p.velocity.x = -p.velocity.x * e; }
    if (p.position.y < min.y) { p.position.y = min.y; p.velocity.y = -p.velocity.y * e; }
    else if (p.position.y > max.y) { p.position.y = max.y; p.velocity.y = -p.velocity.y * e; }
    if (p.position.z < min.z) { p.position.z = min.z; p.velocity.z = -p.velocity.z * e; }
    else if (p.position.z > max.z) { p.position.z = max.z; p.velocity.z = -p.velocity.z * e; }
  }
}

/**
 * Deterministically seed a block of fluid particles on a regular grid (no RNG).
 * Useful for reproducible initial conditions and tests.
 */
export function fillBlock(
  world: FluidWorld,
  min: Vec3,
  max: Vec3,
  spacing: number,
): FluidParticle[] {
  const out: FluidParticle[] = [];
  for (let x = min.x; x <= max.x; x += spacing) {
    for (let y = min.y; y <= max.y; y += spacing) {
      for (let z = min.z; z <= max.z; z += spacing) {
        out.push(world.addParticle(new Vec3(x, y, z)));
      }
    }
  }
  return out;
}
