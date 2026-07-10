/**
 * @omega/physics — soft body via a mass-spring lattice.
 *
 * A soft body is a 3D lattice of `Particle`s (see `constraints.ts`) wired
 * together with distance constraints: structural (axis neighbours), shear
 * (face/space diagonals) and bend (two-step axis neighbours). Because it rides
 * on the deterministic `ConstraintWorld` PBD solver, the soft body is a pure
 * function of its initial lattice + dt sequence — identical inputs reproduce
 * identical deformation, tick for tick.
 *
 * The lattice itself *is* the body: its deformation is read out by sampling the
 * particle grid (e.g. the surface shell for rendering). No rotation/volume
 * solver is included — volume retention emerges from the constraint network.
 */

import { Vec3 } from '@omega/engine-math';
import {
  ConstraintWorld,
  createDistanceConstraint,
  type Particle,
} from './constraints.js';

export interface SoftBodyOptions {
  /** World-space position of the lattice origin (minimum corner). Default origin. */
  origin?: Vec3;
  /** Node counts along each axis (>= 2 each). Default (4,4,4). */
  dimX?: number;
  dimY?: number;
  dimZ?: number;
  /** Rest spacing between neighbouring nodes. Default 0.5. */
  spacing?: number;
  /** Mass per node. Default 1. */
  massPerNode?: number;
  /** Stiffness of structural (axis) links in [0,1]. Default 1. */
  structuralStiffness?: number;
  /** Stiffness of shear (diagonal) links. Default 0.8. */
  shearStiffness?: number;
  /** Stiffness of bend (two-step) links. Default 0.5. */
  bendStiffness?: number;
  /** Pin the 8 corner nodes in place (rigid fixture). Default false. */
  pinCorners?: boolean;
}

/** A mass-spring lattice soft body. `ids[x][y][z]` maps to particle ids. */
export interface SoftBody {
  readonly world: ConstraintWorld;
  readonly ids: number[][][];
  readonly dimX: number;
  readonly dimY: number;
  readonly dimZ: number;
  readonly spacing: number;
}

/**
 * Build a cubic (or box) soft body as a mass-spring lattice. All constraints are
 * distance constraints on the shared `ConstraintWorld`, so the whole body is
 * stepped by `world.step(dt)`. Returns the id grid so callers can read/skin it.
 */
export function buildSoftBody(
  world: ConstraintWorld,
  opts: SoftBodyOptions = {},
): SoftBody {
  const origin = opts.origin ?? new Vec3(0, 0, 0);
  const dimX = Math.max(2, opts.dimX ?? 4);
  const dimY = Math.max(2, opts.dimY ?? 4);
  const dimZ = Math.max(2, opts.dimZ ?? 4);
  const spacing = opts.spacing ?? 0.5;
  const mass = opts.massPerNode ?? 1;
  const sStiff = opts.structuralStiffness ?? 1;
  const shStiff = opts.shearStiffness ?? 0.8;
  const bStiff = opts.bendStiffness ?? 0.5;
  const pinCorners = opts.pinCorners ?? false;

  const idAt = (x: number, y: number, z: number): number => ids[x][y][z];

  // 1) Create the lattice nodes.
  const ids: number[][][] = [];
  for (let x = 0; x < dimX; x++) {
    const slab: number[][] = [];
    for (let y = 0; y < dimY; y++) {
      const col: number[] = [];
      for (let z = 0; z < dimZ; z++) {
        const pos = new Vec3(
          origin.x + spacing * x,
          origin.y + spacing * y,
          origin.z + spacing * z,
        );
        const isCorner =
          (x === 0 || x === dimX - 1) &&
          (y === 0 || y === dimY - 1) &&
          (z === 0 || z === dimZ - 1);
        const p = world.addParticle(pos, { mass, pinned: pinCorners && isCorner });
        col.push(p.id);
      }
      slab.push(col);
    }
    ids.push(slab);
  }

  // 2) Structural links (orthogonal neighbours, spacing apart).
  for (let x = 0; x < dimX; x++) {
    for (let y = 0; y < dimY; y++) {
      for (let z = 0; z < dimZ; z++) {
        if (x + 1 < dimX) {
          world.addConstraint(createDistanceConstraint(
            idAt(x, y, z), idAt(x + 1, y, z), spacing, sStiff));
        }
        if (y + 1 < dimY) {
          world.addConstraint(createDistanceConstraint(
            idAt(x, y, z), idAt(x, y + 1, z), spacing, sStiff));
        }
        if (z + 1 < dimZ) {
          world.addConstraint(createDistanceConstraint(
            idAt(x, y, z), idAt(x, y, z + 1), spacing, sStiff));
        }
      }
    }
  }

  // 3) Shear links (face diagonals within each cell, spacing*sqrt(2) apart).
  const diag = Math.SQRT2 * spacing;
  for (let x = 0; x + 1 < dimX; x++) {
    for (let y = 0; y + 1 < dimY; y++) {
      for (let z = 0; z < dimZ; z++) {
        world.addConstraint(createDistanceConstraint(
          idAt(x, y, z), idAt(x + 1, y + 1, z), diag, shStiff));
        world.addConstraint(createDistanceConstraint(
          idAt(x + 1, y, z), idAt(x, y + 1, z), diag, shStiff));
      }
    }
    for (let y = 0; y < dimY; y++) {
      for (let z = 0; z + 1 < dimZ; z++) {
        world.addConstraint(createDistanceConstraint(
          idAt(x, y, z), idAt(x + 1, y, z + 1), diag, shStiff));
        world.addConstraint(createDistanceConstraint(
          idAt(x + 1, y, z), idAt(x, y, z + 1), diag, shStiff));
      }
    }
  }
  for (let x = 0; x < dimX; x++) {
    for (let y = 0; y + 1 < dimY; y++) {
      for (let z = 0; z + 1 < dimZ; z++) {
        world.addConstraint(createDistanceConstraint(
          idAt(x, y, z), idAt(x, y + 1, z + 1), diag, shStiff));
        world.addConstraint(createDistanceConstraint(
          idAt(x, y + 1, z), idAt(x, y, z + 1), diag, shStiff));
      }
    }
  }

  // 4) Bend links (two-step axis neighbours, 2*spacing apart) for stiffness.
  const bend = 2 * spacing;
  for (let x = 0; x + 2 < dimX; x++) {
    for (let y = 0; y < dimY; y++) {
      for (let z = 0; z < dimZ; z++) {
        world.addConstraint(createDistanceConstraint(
          idAt(x, y, z), idAt(x + 2, y, z), bend, bStiff));
      }
    }
  }
  for (let x = 0; x < dimX; x++) {
    for (let y = 0; y + 2 < dimY; y++) {
      for (let z = 0; z < dimZ; z++) {
        world.addConstraint(createDistanceConstraint(
          idAt(x, y, z), idAt(x, y + 2, z), bend, bStiff));
      }
    }
  }
  for (let x = 0; x < dimX; x++) {
    for (let y = 0; y < dimY; y++) {
      for (let z = 0; z + 2 < dimZ; z++) {
        world.addConstraint(createDistanceConstraint(
          idAt(x, y, z), idAt(x, y, z + 2), bend, bStiff));
      }
    }
  }

  return { world, ids, dimX, dimY, dimZ, spacing };
}

/** Center of mass of the soft body's particles (deterministic). */
export function softBodyCenter(body: SoftBody): Vec3 {
  const c = new Vec3(0, 0, 0);
  let n = 0;
  for (let x = 0; x < body.dimX; x++) {
    for (let y = 0; y < body.dimY; y++) {
      for (let z = 0; z < body.dimZ; z++) {
        const p = body.world.getParticle(body.ids[x][y][z]) as Particle | undefined;
        if (!p) continue;
        c.add(p.position);
        n++;
      }
    }
  }
  if (n > 0) c.scale(1 / n);
  return c;
}
