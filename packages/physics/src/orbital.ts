/**
 * @omega/physics — deterministic orbital mechanics (N-body gravity).
 *
 * Two complementary, fully-deterministic integrators:
 *
 *  1. `NBodySystem` — a direct Newtonian gravitational N-body simulation with a
 *     symplectic (velocity-Verlet / leapfrog) integrator. No RNG, no clock:
 *     identical initial masses/positions/velocities + dt sequence => identical
 *     trajectory, bit for bit.
 *
 *  2. `keplerStep` — an analytic two-body Kepler propagator (solves Kepler's
 *     equation via fixed-iteration Newton) for when only one body orbits a
 *     dominant mass. Used for cheap, drift-free planet orbits and as a reference
 *     for the N-body integrator.
 *
 * Both build on `Vec3` from `@omega/engine-math`. Units are caller-defined
 * (e.g. SI-ish) — keep G consistent with your lengths/masses.
 */

import { Vec3 } from '@omega/engine-math';

export interface OrbitalBody {
  id: number;
  position: Vec3;
  velocity: Vec3;
  mass: number;
  /** Accumulated acceleration (internal, reset each step). */
  accel: Vec3;
}

const G_DEFAULT = 6.6743e-11;

/** Create an orbital body. Position/velocity cloned. */
export function createOrbitalBody(
  id: number,
  position: Vec3,
  velocity: Vec3,
  mass: number,
): OrbitalBody {
  return {
    id,
    position: position.clone(),
    velocity: velocity.clone(),
    mass,
    accel: new Vec3(0, 0, 0),
  };
}

export interface NBodyOptions {
  /** Gravitational constant G. Default 6.6743e-11. */
  g?: number;
  /**
   * Softening length ε (avoids singularities at r→0). Default 1e-3. The
   * potential uses 1/(r²+ε²) so determinism is preserved and close passes are
   * well-defined.
   */
  softening?: number;
}

/**
 * Deterministic N-body gravity system using a leapfrog (kick-drift-kick) scheme.
 */
export class NBodySystem {
  readonly g: number;
  readonly softening: number;
  private readonly bodies: OrbitalBody[] = [];
  private nextId = 0;

  constructor(opts: NBodyOptions = {}) {
    this.g = opts.g ?? G_DEFAULT;
    this.softening = opts.softening ?? 1e-3;
  }

  addBody(position: Vec3, velocity: Vec3, mass: number): OrbitalBody {
    const b = createOrbitalBody(this.nextId++, position, velocity, mass);
    this.bodies.push(b);
    return b;
  }

  addExisting(body: OrbitalBody): OrbitalBody {
    this.nextId = Math.max(this.nextId, body.id + 1);
    this.bodies.push(body);
    return body;
  }

  all(): readonly OrbitalBody[] {
    return this.bodies;
  }

  /** Compute gravitational acceleration on every body (O(n²), deterministic). */
  private computeAccel(): void {
    const n = this.bodies.length;
    const eps2 = this.softening * this.softening;
    for (const b of this.bodies) b.accel.set(0, 0, 0);
    for (let i = 0; i < n; i++) {
      const bi = this.bodies[i];
      for (let j = i + 1; j < n; j++) {
        const bj = this.bodies[j];
        const dx = bj.position.x - bi.position.x;
        const dy = bj.position.y - bi.position.y;
        const dz = bj.position.z - bi.position.z;
        const r2 = dx * dx + dy * dy + dz * dz + eps2;
        const invR = 1 / Math.sqrt(r2);
        const invR3 = invR / r2; // 1 / r^3
        // a_i += G m_j (r_j - r_i) / r^3 ; symmetric for j.
        const fi = this.g * bj.mass * invR3;
        const fj = this.g * bi.mass * invR3;
        bi.accel.x += fi * dx; bi.accel.y += fi * dy; bi.accel.z += fi * dz;
        bj.accel.x -= fj * dx; bj.accel.y -= fj * dy; bj.accel.z -= fj * dz;
      }
    }
  }

  /** Advance by dt using leapfrog (KDK). Deterministic for fixed dt. */
  step(dt: number): void {
    const n = this.bodies.length;
    if (n === 0) return;

    // Current accelerations (from current positions).
    this.computeAccel();

    // Kick (half step velocity) + Drift (full step position).
    for (let i = 0; i < n; i++) {
      const b = this.bodies[i];
      b.velocity.x += 0.5 * b.accel.x * dt;
      b.velocity.y += 0.5 * b.accel.y * dt;
      b.velocity.z += 0.5 * b.accel.z * dt;
      b.position.x += b.velocity.x * dt;
      b.position.y += b.velocity.y * dt;
      b.position.z += b.velocity.z * dt;
    }

    // Recompute accelerations at the new positions.
    this.computeAccel();

    // Second Kick (half step velocity).
    for (let i = 0; i < n; i++) {
      const b = this.bodies[i];
      b.velocity.x += 0.5 * b.accel.x * dt;
      b.velocity.y += 0.5 * b.accel.y * dt;
      b.velocity.z += 0.5 * b.accel.z * dt;
    }
  }

  /** Total kinetic + potential energy (for conservation checks). */
  energy(): number {
    const n = this.bodies.length;
    const eps2 = this.softening * this.softening;
    let ke = 0;
    for (const b of this.bodies) {
      ke += 0.5 * b.mass * b.velocity.lengthSq();
    }
    let pe = 0;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const bi = this.bodies[i], bj = this.bodies[j];
        const dx = bj.position.x - bi.position.x;
        const dy = bj.position.y - bi.position.y;
        const dz = bj.position.z - bi.position.z;
        const r = Math.sqrt(dx * dx + dy * dy + dz * dz + eps2);
        pe -= (this.g * bi.mass * bj.mass) / r;
      }
    }
    return ke + pe;
  }
}

/**
 * Analytic two-body Kepler propagator for a small body around a dominant mass
 * M at the origin. Given the current state, returns the new state after `dt`.
 *
 * Deterministic: solves Kepler's equation E - e·sinE = M with fixed-iteration
 * Newton (no tolerance loop, so the step count is constant and reproducible).
 */
export interface KeplerElements {
  /** Semi-major axis a. */
  a: number;
  /** Eccentricity e in [0,1). */
  e: number;
  /** Standard gravitational parameter μ = G·M. */
  mu: number;
}

/** Given position/velocity relative to the primary (at origin), derive μ, a, e. */
export function elementsFromState(
  position: Vec3,
  velocity: Vec3,
  mu: number,
): KeplerElements {
  const r = position.length();
  const v2 = velocity.lengthSq();
  // Specific orbital energy ε = v²/2 - μ/r ; a = -μ/(2ε).
  const eps = v2 / 2 - mu / r;
  const a = -mu / (2 * eps);
  // Specific angular momentum h = r × v ; e = | (v×h)/μ - r/|r| |.
  const h = position.cross(velocity);
  const vxh = velocity.cross(h);
  const ex = vxh.x / mu - position.x / r;
  const ey = vxh.y / mu - position.y / r;
  const ez = vxh.z / mu - position.z / r;
  const e = Math.sqrt(ex * ex + ey * ey + ez * ez);
  return { a, e, mu };
}

/**
 * Propagate (position, velocity) around the primary by `dt` using Kepler's
 * equation. Returns the new position + velocity (cloned). Used as a fast,
 * drift-free orbit stepper and as a reference oracle for `NBodySystem`.
 */
export function keplerStep(
  position: Vec3,
  velocity: Vec3,
  mu: number,
  dt: number,
): { position: Vec3; velocity: Vec3 } {
  const el = elementsFromState(position, velocity, mu);
  const { a, e } = el;
  const n = Math.sqrt(mu / (a * a * a)); // mean motion

  // Degenerate circular orbit (e ≈ 0): rotate rigidly in the orbital plane
  // via Rodrigues' rotation by angle n·dt about the angular-momentum axis.
  if (e < 1e-9) {
    const h = position.cross(velocity);
    const hLen = h.length();
    const w = hLen > 1e-9 ? h.clone().scale(1 / hLen) : new Vec3(0, 0, 1);
    const theta = n * dt;
    const pos = rodriguesRotate(position, w, theta);
    const vel = rodriguesRotate(velocity, w, theta);
    return { position: pos, velocity: vel };
  }

  const r = position.length();
  // Solve for current eccentric/mean anomaly from state.
  const cosNu = (a * (1 - e * e) - r) / (e * r); // cos(true anomaly)
  const nu = Math.acos(Math.min(1, Math.max(-1, cosNu)));
  // true anomaly sign from radial velocity sign.
  const radialV = position.dot(velocity) / r;
  const trueAnom = radialV < 0 ? -nu : nu;
  const E0 = 2 * Math.atan2(
    Math.sqrt(1 - e) * Math.sin(trueAnom / 2),
    Math.sqrt(1 + e) * Math.cos(trueAnom / 2),
  );
  const M0 = E0 - e * Math.sin(E0);

  const M = M0 + n * dt;

  // Solve Kepler's equation E - e·sinE = M (fixed 8 Newton iterations).
  let E = M;
  for (let i = 0; i < 8; i++) {
    const f = E - e * Math.sin(E) - M;
    const fp = 1 - e * Math.cos(E);
    E -= f / fp;
  }

  // Position in perifocal frame.
  const cosE = Math.cos(E), sinE = Math.sin(E);
  const xp = a * (cosE - e);
  const yp = a * Math.sqrt(1 - e * e) * sinE;
  const rNew = a * (1 - e * cosE);

  // Velocity in perifocal frame.
  const edot = n / (1 - e * cosE); // dE/dt
  const vxp = -a * sinE * edot;
  const vyp = a * Math.sqrt(1 - e * e) * cosE * edot;

  // Rotate perifocal -> inertial using the orbit's perifocal basis derived from
  // the initial state. Reconstruct basis deterministically from h, e-vector, n.
  const h = position.cross(velocity);
  const hLen = h.length();
  const w = hLen > 1e-9 ? h.clone().scale(1 / hLen) : new Vec3(0, 0, 1);

  const eVec = new Vec3(
    (velocity.y * h.z - velocity.z * h.y) / mu - position.x / r,
    (velocity.z * h.x - velocity.x * h.z) / mu - position.y / r,
    (velocity.x * h.y - velocity.y * h.x) / mu - position.z / r,
  );
  const eLen = eVec.length();
  const pAxis = eLen > 1e-9 ? eVec.clone().scale(1 / eLen) : new Vec3(1, 0, 0);
  const qAxis = w.cross(pAxis); // perifocal y axis

  const newPos = new Vec3(
    pAxis.x * xp + qAxis.x * yp,
    pAxis.y * xp + qAxis.y * yp,
    pAxis.z * xp + qAxis.z * yp,
  );
  const newVel = new Vec3(
    pAxis.x * vxp + qAxis.x * vyp,
    pAxis.y * vxp + qAxis.y * vyp,
    pAxis.z * vxp + qAxis.z * vyp,
  );
  // Restore the actual radius magnitude (Kepler gives a unit-plane; scale).
  const scaleR = rNew / (newPos.length() || 1);
  newPos.scale(scaleR);

  return { position: newPos, velocity: newVel };
}

/**
 * Rotate vector `v` about unit axis `k` by angle `theta` (Rodrigues' formula).
 * Deterministic; used for the circular-orbit degenerate branch of `keplerStep`.
 */
function rodriguesRotate(v: Vec3, k: Vec3, theta: number): Vec3 {
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  const dot = v.dot(k);
  const cross = v.cross(k);
  return new Vec3(
    v.x * c + cross.x * s + k.x * dot * (1 - c),
    v.y * c + cross.y * s + k.y * dot * (1 - c),
    v.z * c + cross.z * s + k.z * dot * (1 - c),
  );
}
