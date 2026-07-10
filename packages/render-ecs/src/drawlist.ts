/**
 * @omega/render-ecs — draw-list extraction.
 *
 * Turns a deterministic ECS `World` into an ordered list of {@link DrawItem}s,
 * one per visible renderable entity, sorted by ascending entity id. This is the
 * pure bridge from world state to "what to draw, in what order".
 *
 * Determinism: entity iteration comes straight from `world.query`, which already
 * returns ascending-id order, so the same world always yields the same sequence.
 * No clock / randomness is read here.
 */

import { type World } from '@omega/ecs';
import { Vec3, Mat4, Quat } from '@omega/engine-math';
import type { Camera, MeshData } from '@omega/render';
import {
  Renderable,
  Transform,
  type DrawItem,
  type RenderableData,
  type TransformData,
} from './components.js';

/**
 * Build a local->world model matrix from a {@link TransformData}.
 * `model = T * R * S`, where R is built from the euler XYZ `rot` (radians).
 * Missing `rot` => identity rotation; missing `scale` => uniform scale 1.
 */
export function modelMatrix(t: TransformData): Mat4 {
  const tx = t.pos.x;
  const ty = t.pos.y;
  const tz = t.pos.z;

  let rx = 0;
  let ry = 0;
  let rz = 0;
  if (t.rot) {
    rx = t.rot.x;
    ry = t.rot.y;
    rz = t.rot.z;
  }

  let sx = 1;
  let sy = 1;
  let sz = 1;
  if (t.scale) {
    sx = t.scale.x;
    sy = t.scale.y;
    sz = t.scale.z;
  }

  const trans = new Mat4();
  Mat4.translation(trans, tx, ty, tz);

  const rot = new Mat4();
  quatToMat4(rot, Quat.fromEuler(rx, ry, rz));

  const scale = new Mat4();
  Mat4.scaling(scale, sx, sy, sz);

  // model = T * R * S  (apply scale, then rotate, then translate).
  const tr = new Mat4();
  Mat4.multiply(tr, trans, rot);
  const model = new Mat4();
  Mat4.multiply(model, tr, scale);
  return model;
}

/** Convert a quaternion into a column-major rotation {@link Mat4}. */
function quatToMat4(out: Mat4, q: Quat): void {
  const x = q.x;
  const y = q.y;
  const z = q.z;
  const w = q.w;
  const m = out.m;
  m[0] = 1 - 2 * (y * y + z * z);
  m[1] = 2 * (x * y - z * w);
  m[2] = 2 * (x * z + y * w);
  m[3] = 0;
  m[4] = 2 * (x * y + z * w);
  m[5] = 1 - 2 * (x * x + z * z);
  m[6] = 2 * (y * z - x * w);
  m[7] = 0;
  m[8] = 2 * (x * z - y * w);
  m[9] = 2 * (y * z + x * w);
  m[10] = 1 - 2 * (x * x + y * y);
  m[11] = 0;
  m[12] = 0;
  m[13] = 0;
  m[14] = 0;
  m[15] = 1;
}

/**
 * Combine a world-space model matrix with a camera's view-projection, yielding
 * the view-space matrix. Used when a draw list is requested already projected
 * into view space (see {@link extractDrawList} with a `camera` argument).
 */
export function projectModel(model: Mat4, camera: Camera): Mat4 {
  const out = new Mat4();
  Mat4.multiply(out, camera.getViewProjection(), model);
  return out;
}

/**
 * Extract a deterministic draw list from the world.
 *
 * - Queries `Renderable` components (ascending entity id order).
 * - Skips entities whose `visible === false`.
 * - Composes each entity's model matrix from its `Transform` (identity when no
 *   `Transform` is present).
 * - When `camera` is supplied, each item's `transform` is projected into view
 *   space (model * viewProjection); otherwise it stays in world space.
 *
 * The returned list is a pure function of (world, camera): identical inputs
 * always produce an identical, id-ordered sequence.
 */
export function extractDrawList(world: World, camera?: Camera): DrawItem[] {
  const items: DrawItem[] = [];

  world.query(Renderable).each((id, renderable: RenderableData) => {
    if (renderable.visible === false) return;

    let model: Mat4;
    const t = world.getComponent(id, Transform);
    if (t) {
      model = modelMatrix(t);
    } else {
      model = new Mat4();
    }

    const transform = camera ? projectModel(model, camera) : model;

    items.push({
      entity: id,
      meshId: renderable.meshId,
      color: renderable.color,
      transform,
    });
  });

  return items;
}

/** Convenience: collect just the visible mesh ids in draw order. */
export function drawOrder(world: World): string[] {
  return extractDrawList(world).map((d) => d.meshId);
}

/**
 * Bake a model matrix into a mesh, returning a NEW {@link MeshData} whose
 * positions are transformed to world space. The original mesh is not mutated.
 * Used by the bridge so the backend renderer can project already-world-space
 * vertices via the camera.
 */
export function applyMatrix(mesh: MeshData, m: Mat4): MeshData {
  const inPos = mesh.positions;
  const count = mesh.vertexCount;
  const outPos = new Float32Array(inPos.length);

  for (let i = 0; i < count; i++) {
    const x = inPos[i * 3 + 0];
    const y = inPos[i * 3 + 1];
    const z = inPos[i * 3 + 2];
    const p = m.transformPoint(new Vec3(x, y, z));
    outPos[i * 3 + 0] = p.x;
    outPos[i * 3 + 1] = p.y;
    outPos[i * 3 + 2] = p.z;
  }

  return {
    positions: outPos,
    indices: mesh.indices,
    vertexCount: mesh.vertexCount,
    indexCount: mesh.indexCount,
  };
}

/** Re-exported for callers building transforms. */
export type { Vec3 };
