/**
 * @omega/physics — constraints for bound / soft bodies (rope, cloth).
 *
 * Position-Based Dynamics (PBD) style constraint solver, layered on top of the
 * same semi-implicit integration used by `PhysicsWorld`. A `Particle` is a
 * point mass with a position and (PBD) previous-position; constraints are
 * solved by directly projecting particle positions toward satisfaction over a
 * fixed number of solver iterations.
 *
 * Determinism contract (same as the rigid-body world):
 *   - No Math.random / Date.now / performance.now anywhere in the core.
 *   - Particles are iterated in ascending id order; constraints in insertion
 *     order; the result is a pure function of (initial state, dt sequence).
 *   - Feeding two `ConstraintWorld`s identical initial conditions and dt
 *     sequences yields byte-identical particle trajectories.
 *
 * Rope = a chain of distance constraints; cloth = a grid of distance
 * constraints (structural + optional shear/bend). Stiffness in [0,1] acts as a
 * compliant-PBD correction factor: 1 = rigid distance, <1 = springy.
 */

import { Vec3 } from '@omega/engine-math';

/** A point mass for the constraint solver. */
export interface Particle {
  id: number;
  position: Vec3;
  /** Previous-step position (PBD velocity reconstruction). */
  prevPosition: Vec3;
  /** Linear velocity, integrated from position deltas after solving. */
  velocity: Vec3;
  mass: number;
  invMass: number;
  /** True for immovable particles (invMass === 0). */
  pinned: boolean;
}

export interface ParticleOptions {
  /** Mass; <= 0 or `pinned` yields invMass 0. Default 1. */
  mass?: number;
  /** Initial velocity. Default zero. */
  velocity?: Vec3;
  /** Pin the particle in place (immovable). Default false. */
  pinned?: boolean;
}

/**
 * Create a Particle. `position` is cloned so the caller keeps its Vec3.
 * The id is assigned by the `ConstraintWorld` (auto-incrementing) to avoid
 * collisions; prefer `world.addParticle(...)`.
 */
export function createParticle(
  id: number,
  position: Vec3,
  opts: ParticleOptions = {},
): Particle {
  const mass = opts.mass ?? 1;
  const pinned = opts.pinned ?? false;
  const invMass = pinned || mass <= 0 ? 0 : 1 / mass;
  return {
    id,
    position: position.clone(),
    prevPosition: position.clone(),
    velocity: opts.velocity ? opts.velocity.clone() : new Vec3(0, 0, 0),
    mass: pinned ? Infinity : mass,
    invMass,
    pinned,
  };
}

/** A distance constraint between two particles, optionally compliant (springy). */
export interface DistanceConstraint {
  type: 'distance';
  /** Particle id A (always the smaller id — see `createDistanceConstraint`). */
  a: number;
  /** Particle id B. */
  b: number;
  /** Rest length. */
  rest: number;
  /**
   * Stiffness in [0,1]. 1 = rigid (fully corrected each iteration),
   * <1 = springy (fraction of the error corrected per iteration). Cloth/rope
   * typically use a high value (≈0.9–1) with multiple iterations.
   */
  stiffness: number;
}

/**
 * Create a distance (rope/cloth link) constraint. Ids are normalized so the
 * smaller id is `a`, making the constraint representation order-independent and
 * deterministic regardless of which endpoint the caller listed first.
 */
export function createDistanceConstraint(
  a: number,
  b: number,
  rest: number,
  stiffness = 1,
): DistanceConstraint {
  return {
    type: 'distance',
    a: Math.min(a, b),
    b: Math.max(a, b),
    rest,
    stiffness,
  };
}

export interface ConstraintWorldOptions {
  /** Constant acceleration applied to all dynamic particles. Default (0,-9.81,0). */
  gravity?: Vec3;
  /** Ground plane height (y). Set to -Infinity to disable. Default -Infinity. */
  groundY?: number;
  /** Constraint solver iterations per step. Default 4. */
  solverIterations?: number;
  /**
   * Per-step velocity damping (multiplicative). 1 = none, 0.99 = slight drag.
   * Default 1 (no damping) for pure determinism; lower for visual settle.
   */
  damping?: number;
}

/**
 * A small world of particles + distance constraints solved with PBD.
 *
 * The step is:
 *   1) integrate velocity (gravity) and predict position (semi-implicit).
 *   2) solve all constraints over `solverIterations` passes (deterministic order).
 *   3) reconstruct velocity from (position - prevPosition) / dt, apply damping.
 */
export class ConstraintWorld {
  readonly gravity: Vec3;
  groundY: number;
  solverIterations: number;
  damping: number;

  private readonly particles = new Map<number, Particle>();
  private readonly constraints: DistanceConstraint[] = [];
  private nextId = 0;

  constructor(opts: ConstraintWorldOptions = {}) {
    this.gravity = opts.gravity ? opts.gravity.clone() : new Vec3(0, -9.81, 0);
    this.groundY = opts.groundY ?? -Infinity;
    this.solverIterations = opts.solverIterations ?? 4;
    this.damping = opts.damping ?? 1;
  }

  /** Add a particle, auto-assigning a fresh, collision-free id. Returns it. */
  addParticle(position: Vec3, opts: ParticleOptions = {}): Particle {
    const p = createParticle(this.nextId++, position, opts);
    this.particles.set(p.id, p);
    return p;
  }

  /** Add an existing particle (must carry its own id). Returns it. */
  addExistingParticle(p: Particle): Particle {
    this.nextId = Math.max(this.nextId, p.id + 1);
    this.particles.set(p.id, p);
    return p;
  }

  addConstraint(c: DistanceConstraint): DistanceConstraint {
    this.constraints.push(c);
    return c;
  }

  getParticle(id: number): Particle | undefined {
    return this.particles.get(id);
  }

  /** All particles, ascending by id (deterministic iteration order). */
  particles_(): Particle[] {
    return [...this.particles.values()].sort((a, b) => a.id - b.id);
  }

  constraints_(): readonly DistanceConstraint[] {
    return this.constraints;
  }

  /** Advance the simulation by dt seconds. */
  step(dt: number): void {
    const ps = this.particles_();

    // 1) Integrate velocity (gravity) and predict position (semi-implicit Euler).
    for (const p of ps) {
      if (p.invMass === 0) continue;
      p.velocity.x += this.gravity.x * dt;
      p.velocity.y += this.gravity.y * dt;
      p.velocity.z += this.gravity.z * dt;
      p.prevPosition.copy(p.position);
      p.position.x += p.velocity.x * dt;
      p.position.y += p.velocity.y * dt;
      p.position.z += p.velocity.z * dt;
    }

    // 2) Resolve constraints over several solver iterations for stiffness.
    for (let iter = 0; iter < this.solverIterations; iter++) {
      for (const c of this.constraints) this.solveDistance(c);
      if (this.groundY !== -Infinity) {
        for (const p of ps) this.projectGround(p);
      }
    }

    // 3) Reconstruct velocity from the position delta and apply damping.
    const invDt = dt > 0 ? 1 / dt : 0;
    for (const p of ps) {
      if (p.invMass === 0) continue;
      p.velocity.set(
        (p.position.x - p.prevPosition.x) * invDt,
        (p.position.y - p.prevPosition.y) * invDt,
        (p.position.z - p.prevPosition.z) * invDt,
      );
      p.velocity.scale(this.damping);
    }
  }

  /** PBD distance projection, weighted by inverse mass. Mutates both particles. */
  private solveDistance(c: DistanceConstraint): void {
    const pa = this.particles.get(c.a);
    const pb = this.particles.get(c.b);
    if (!pa || !pb) return;
    const w = pa.invMass + pb.invMass;
    if (w === 0) return; // both static

    let dx = pa.position.x - pb.position.x;
    let dy = pa.position.y - pb.position.y;
    let dz = pa.position.z - pb.position.z;
    let dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

    // Degenerate coincidence: pick a stable axis so projection is well-defined.
    if (dist < 1e-9) {
      dx = 0; dy = 1; dz = 0; dist = 0;
    } else {
      const inv = 1 / dist;
      dx *= inv; dy *= inv; dz *= inv;
    }

    const C = dist - c.rest;
    // Compliant PBD: scale the correction by stiffness (<1 = springy).
    const lambda = -((C / w) * c.stiffness);
    const cx = dx * lambda;
    const cy = dy * lambda;
    const cz = dz * lambda;

    pa.position.x += cx * pa.invMass;
    pa.position.y += cy * pa.invMass;
    pa.position.z += cz * pa.invMass;
    pb.position.x -= cx * pb.invMass;
    pb.position.y -= cy * pb.invMass;
    pb.position.z -= cz * pb.invMass;
  }

  /** Clamp a particle above the ground plane (position-only, like a floor). */
  private projectGround(p: Particle): void {
    if (p.invMass === 0) return;
    if (p.position.y < this.groundY) p.position.y = this.groundY;
  }
}

export interface RopeOptions {
  /** World-space start position of the first node. */
  start: Vec3;
  /** Direction the rope extends (need not be normalized). Default +X. */
  dir?: Vec3;
  /** Number of links (nodes = segments + 1). Default 8. */
  segments?: number;
  /** Rest length of each link. Default 0.5. */
  segmentLength?: number;
  /** Mass per node. Default 1. */
  massPerNode?: number;
  /** Distance constraint stiffness in [0,1]. Default 1 (rigid rope). */
  stiffness?: number;
  /** Pin the first node in place. Default true (so the rope hangs). */
  pinFirst?: boolean;
  /** Pin the last node in place. Default false. */
  pinLast?: boolean;
}

/**
 * Build a hanging rope: a chain of `segments` distance constraints linking
 * `segments + 1` particles along `dir`. Returns the particle ids head→tail.
 * Fully deterministic given the options.
 */
export function buildRope(world: ConstraintWorld, opts: RopeOptions): number[] {
  const dir = (opts.dir ?? new Vec3(1, 0, 0)).clone().normalize();
  const segments = opts.segments ?? 8;
  const len = opts.segmentLength ?? 0.5;
  const mass = opts.massPerNode ?? 1;
  const stiffness = opts.stiffness ?? 1;
  const pinFirst = opts.pinFirst ?? true;
  const pinLast = opts.pinLast ?? false;

  const ids: number[] = [];
  for (let i = 0; i <= segments; i++) {
    const pos = new Vec3(
      opts.start.x + dir.x * len * i,
      opts.start.y + dir.y * len * i,
      opts.start.z + dir.z * len * i,
    );
    const pinned = (i === 0 && pinFirst) || (i === segments && pinLast);
    const p = world.addParticle(pos, { mass, pinned });
    ids.push(p.id);
  }
  for (let i = 0; i < segments; i++) {
    const a = ids[i];
    const b = ids[i + 1];
    world.addConstraint(createDistanceConstraint(a, b, len, stiffness));
  }
  return ids;
}

export interface ClothOptions {
  /** World-space position of the top-left corner node. Default origin. */
  origin?: Vec3;
  /** Number of nodes across (columns). Default 10. */
  cols?: number;
  /** Number of nodes down (rows). Default 10. */
  rows?: number;
  /** Grid spacing (rest length of structural links). Default 0.5. */
  spacing?: number;
  /** Mass per node. Default 1. */
  massPerNode?: number;
  /** Structural (horizontal/vertical) link stiffness. Default 1. */
  structuralStiffness?: number;
  /** Add diagonal shear links for shape retention. Default true. */
  shear?: boolean;
  /** Shear link stiffness. Default 1. */
  shearStiffness?: number;
  /** Pin the entire top row in place (so cloth hangs). Default true. */
  pinTopRow?: boolean;
  /**
   * Pin the two top corners only (classic hanging cloth) instead of the whole
   * top row. Ignored when pinTopRow is false. Default false.
   */
  pinTopCornersOnly?: boolean;
}

/** A rectangular cloth grid result. */
export interface Cloth {
  /** rows x cols grid of particle ids. */
  ids: number[][];
  rows: number;
  cols: number;
}

/**
 * Build a hanging cloth: a rows×cols grid of particles with structural
 * (and optional shear) distance constraints. Returns the id grid plus bounds.
 * Fully deterministic given the options.
 */
export function buildCloth(world: ConstraintWorld, opts: ClothOptions = {}): Cloth {
  const origin = opts.origin ?? new Vec3(0, 0, 0);
  const cols = opts.cols ?? 10;
  const rows = opts.rows ?? 10;
  const spacing = opts.spacing ?? 0.5;
  const mass = opts.massPerNode ?? 1;
  const structuralStiffness = opts.structuralStiffness ?? 1;
  const shear = opts.shear ?? true;
  const shearStiffness = opts.shearStiffness ?? 1;
  const pinTopRow = opts.pinTopRow ?? true;
  const pinTopCornersOnly = opts.pinTopCornersOnly ?? false;

  const ids: number[][] = [];
  for (let r = 0; r < rows; r++) {
    const row: number[] = [];
    for (let c = 0; c < cols; c++) {
      const pos = new Vec3(
        origin.x + spacing * c,
        origin.y - spacing * r,
        origin.z,
      );
      const pinned =
        pinTopRow &&
        r === 0 &&
        (pinTopCornersOnly ? c === 0 || c === cols - 1 : true);
      const p = world.addParticle(pos, { mass, pinned });
      row.push(p.id);
    }
    ids.push(row);
  }

  // Structural links: right + down neighbors.
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (c + 1 < cols) {
        world.addConstraint(
          createDistanceConstraint(ids[r][c], ids[r][c + 1], spacing, structuralStiffness),
        );
      }
      if (r + 1 < rows) {
        world.addConstraint(
          createDistanceConstraint(ids[r][c], ids[r + 1][c], spacing, structuralStiffness),
        );
      }
    }
  }

  // Shear links: both diagonals of each cell.
  if (shear) {
    const diag = Math.SQRT2 * spacing;
    for (let r = 0; r + 1 < rows; r++) {
      for (let c = 0; c + 1 < cols; c++) {
        world.addConstraint(
          createDistanceConstraint(ids[r][c], ids[r + 1][c + 1], diag, shearStiffness),
        );
        world.addConstraint(
          createDistanceConstraint(ids[r][c + 1], ids[r + 1][c], diag, shearStiffness),
        );
      }
    }
  }

  return { ids, rows, cols };
}
