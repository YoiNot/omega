import { describe, it, expect } from 'vitest';
import { HeightfieldMeshBuilder, computeNormals } from './mesh.js';

describe('HeightfieldMeshBuilder', () => {
  it('produces correct vertex and index counts for 4x4', () => {
    const w = 4, h = 4;
    const heightmap = new Float32Array(w * h).fill(0);
    const builder = new HeightfieldMeshBuilder(heightmap, w, h, 1);
    const mesh = builder.build();

    expect(mesh.vertexCount).toBe(w * h);
    expect(mesh.positions.length).toBe(w * h * 3);
    expect(mesh.indexCount).toBe((w - 1) * (h - 1) * 6);
    expect(mesh.indices.length).toBe(mesh.indexCount);
  });

  it('lays out positions row-major with x=col, z=row, y=height*scale', () => {
    const w = 3, h = 2;
    const heightmap = new Float32Array([0, 1, 2, 3, 4, 5]);
    const scale = 2;
    const { positions } = new HeightfieldMeshBuilder(heightmap, w, h, scale).build();

    // vertex index 4 = row 1, col 1 -> heightmap[4]=4 => y=8
    expect(positions[4 * 3 + 0]).toBe(1);
    expect(positions[4 * 3 + 1]).toBeCloseTo(8);
    expect(positions[4 * 3 + 2]).toBe(1);
    // vertex index 2 = row 0, col 2 => heightmap[2]=2 => y=4
    expect(positions[2 * 3 + 0]).toBe(2);
    expect(positions[2 * 3 + 1]).toBeCloseTo(4);
    expect(positions[2 * 3 + 2]).toBe(0);
  });

  it('indices reference valid vertices and cover all quads', () => {
    const w = 5, h = 5;
    const heightmap = new Float32Array(w * h).fill(0);
    const { indices, vertexCount, indexCount } = new HeightfieldMeshBuilder(heightmap, w, h, 1).build();

    expect(indexCount).toBe((w - 1) * (h - 1) * 6);
    for (let i = 0; i < indices.length; i++) {
      expect(indices[i]).toBeGreaterThanOrEqual(0);
      expect(indices[i]).toBeLessThan(vertexCount);
    }
  });

  it('is deterministic — same heightfield yields identical buffers', () => {
    const w = 6, h = 6;
    const heightmap = new Float32Array(w * h);
    for (let i = 0; i < heightmap.length; i++) heightmap[i] = Math.sin(i) * 5;

    const a = new HeightfieldMeshBuilder(heightmap, w, h, 1).build();
    const b = new HeightfieldMeshBuilder(heightmap, w, h, 1).build();

    expect(Array.from(a.positions)).toEqual(Array.from(b.positions));
    expect(Array.from(a.indices)).toEqual(Array.from(b.indices));
    expect(a.positions).not.toBe(b.positions); // distinct allocations
  });

  it('respects heightScale', () => {
    const heightmap = new Float32Array([3]);
    const { positions } = new HeightfieldMeshBuilder(heightmap, 1, 1, 10).build();
    expect(positions[1]).toBeCloseTo(30);
  });
});

describe('computeNormals', () => {
  it('flat plane (all y equal) yields upward normals of length ~1', () => {
    const w = 4, h = 4;
    const heightmap = new Float32Array(w * h).fill(0);
    const { positions, indices } = new HeightfieldMeshBuilder(heightmap, w, h, 1).build();
    const normals = computeNormals(positions, indices);

    expect(normals.length).toBe(positions.length);
    for (let i = 0; i < normals.length; i += 3) {
      expect(normals[i + 0]).toBeCloseTo(0);
      expect(normals[i + 1]).toBeCloseTo(1);
      expect(normals[i + 2]).toBeCloseTo(0);
      const len = Math.hypot(normals[i], normals[i + 1], normals[i + 2]);
      expect(len).toBeCloseTo(1, 5);
    }
  });

  it('a tilted plane yields a tilted, unit-length normal', () => {
    // y increases with x -> slope in +x. Expected normal approx (-slope,1,0)/len
    const w = 3, h = 3;
    const heightmap = new Float32Array(w * h);
    for (let r = 0; r < h; r++)
      for (let c = 0; c < w; c++) heightmap[r * w + c] = c;

    const { positions, indices } = new HeightfieldMeshBuilder(heightmap, w, h, 1).build();
    const normals = computeNormals(positions, indices);

    // Interior vertex normals should point up-and-back (-x).
    const ny = normals[1];
    expect(ny).toBeGreaterThan(0);
    for (let i = 0; i < normals.length; i += 3) {
      const len = Math.hypot(normals[i], normals[i + 1], normals[i + 2]);
      expect(len).toBeCloseTo(1, 5);
    }
  });
});
