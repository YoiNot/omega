import { Vec3 } from '@omega/engine-math';

/** Result of building a heightfield mesh. */
export interface MeshData {
  /** xyz triplets, 3 floats per vertex, row-major (row = z, col = x). */
  positions: Float32Array;
  /** Triangle indices into the position array. */
  indices: Uint32Array;
  vertexCount: number;
  indexCount: number;
}

/**
 * Builds a triangle mesh from a row-major heightmap.
 *
 * Vertices are laid out as a regular grid. For a heightmap of size
 * `width * height`, there are `width * height` vertices and
 * `(width - 1) * (height - 1) * 2` triangles (6 indices each).
 *
 * World coordinates: x = column, z = row, y = height * heightScale.
 */
export class HeightfieldMeshBuilder {
  constructor(
    public heightmap: Float32Array,
    public width: number,
    public height: number,
    public heightScale = 1,
  ) {}

  /** Build positions + indices for the heightfield. Pure & deterministic. */
  build(): MeshData {
    const { heightmap, width, height, heightScale } = this;
    const vertexCount = width * height;
    const positions = new Float32Array(vertexCount * 3);

    for (let r = 0; r < height; r++) {
      for (let c = 0; c < width; c++) {
        const i = r * width + c;
        const vi = i * 3;
        positions[vi + 0] = c;                       // x
        positions[vi + 1] = heightmap[i] * heightScale; // y (up)
        positions[vi + 2] = r;                       // z
      }
    }

    const quads = (width - 1) * (height - 1);
    const indexCount = quads * 6;
    const indices = new Uint32Array(indexCount);

    let o = 0;
    for (let r = 0; r < height - 1; r++) {
      for (let c = 0; c < width - 1; c++) {
        const a = r * width + c;
        const b = (r + 1) * width + c;
        const d = r * width + (c + 1);
        const e = (r + 1) * width + (c + 1);
        // Triangle 1: a, b, d
        indices[o++] = a;
        indices[o++] = b;
        indices[o++] = d;
        // Triangle 2: b, e, d
        indices[o++] = b;
        indices[o++] = e;
        indices[o++] = d;
      }
    }

    return { positions, indices, vertexCount, indexCount };
  }
}

/**
 * Compute per-vertex normals from triangulated positions via face cross
 * products, accumulated and normalized per vertex. Deterministic.
 */
export function computeNormals(positions: Float32Array, indices: Uint32Array): Float32Array {
  const normals = new Float32Array(positions.length);
  const triCount = Math.floor(indices.length / 3);

  const a = new Vec3();
  const b = new Vec3();
  const c = new Vec3();
  const ab = new Vec3();
  const ac = new Vec3();
  const face = new Vec3();

  for (let t = 0; t < triCount; t++) {
    const i0 = indices[t * 3 + 0];
    const i1 = indices[t * 3 + 1];
    const i2 = indices[t * 3 + 2];

    a.x = positions[i0 * 3]; a.y = positions[i0 * 3 + 1]; a.z = positions[i0 * 3 + 2];
    b.x = positions[i1 * 3]; b.y = positions[i1 * 3 + 1]; b.z = positions[i1 * 3 + 2];
    c.x = positions[i2 * 3]; c.y = positions[i2 * 3 + 1]; c.z = positions[i2 * 3 + 2];

    ab.x = b.x - a.x; ab.y = b.y - a.y; ab.z = b.z - a.z;
    ac.x = c.x - a.x; ac.y = c.y - a.y; ac.z = c.z - a.z;
    face.copy(ab).cross(ac);

    // Accumulate to all three vertices of the face.
    normals[i0 * 3] += face.x;
    normals[i0 * 3 + 1] += face.y;
    normals[i0 * 3 + 2] += face.z;
    normals[i1 * 3] += face.x;
    normals[i1 * 3 + 1] += face.y;
    normals[i1 * 3 + 2] += face.z;
    normals[i2 * 3] += face.x;
    normals[i2 * 3 + 1] += face.y;
    normals[i2 * 3 + 2] += face.z;
  }

  // Normalize each vertex normal.
  for (let v = 0; v < normals.length; v += 3) {
    const nx = normals[v];
    const ny = normals[v + 1];
    const nz = normals[v + 2];
    const len = Math.hypot(nx, ny, nz);
    if (len > 1e-9) {
      normals[v] = nx / len;
      normals[v + 1] = ny / len;
      normals[v + 2] = nz / len;
    }
  }

  return normals;
}
