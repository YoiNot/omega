/**
 * @omega/render-ecs — the Render<->ECS bridge.
 *
 * `EcsRenderer` consumes an `@omega/ecs` `World` and drives an `@omega/render`
 * `Renderer` to draw it, tick after tick, deterministically.
 *
 * IMPORTANT — real API surface: the upstream `Renderer` interface is a single
 * `render(mesh, camera, gradient)` entry point (it clears, draws, and presents
 * internally). We therefore issue one `renderer.render(...)` call per draw item
 * rather than inventing `clear`/`draw`/`present` methods that do not exist.
 * Each call is a pure function of (draw list, camera), so the same world state
 * always yields the same, id-ordered draw sequence.
 */

import { type World } from '@omega/ecs';
import { type Renderer, type Camera, type MeshData, ColorGradient } from '@omega/render';
import { type DrawItem } from './components.js';
import { extractDrawList, applyMatrix } from './drawlist.js';

/** Resolves a `meshId` to its concrete {@link MeshData}. */
export type MeshResolver = (meshId: string) => MeshData | undefined;

/**
 * Build a 2-stop {@link ColorGradient} that paints every vertex with the same
 * flat RGBA color. Deterministic; the bridge uses this to tint each item.
 */
function flatGradient(color: readonly [number, number, number, number]): ColorGradient {
  const c: [number, number, number, number] = [color[0], color[1], color[2], color[3]];
  return new ColorGradient([
    { t: 0, color: c },
    { t: 1, color: c },
  ]);
}

/**
 * Drives a `Renderer` from an ECS `World`. Pure function of world + camera:
 * identical inputs produce an identical draw sequence.
 */
export class EcsRenderer {
  private readonly _world: World;
  private readonly _renderer: Renderer;
  private _camera: Camera;
  private readonly _meshes: Map<string, MeshData> = new Map();

  /**
   * @param world      source of truth (ECS world).
   * @param renderer   backend-agnostic draw surface (real or recording fake).
   * @param camera     view/projection camera.
   */
  constructor(world: World, renderer: Renderer, camera: Camera) {
    this._world = world;
    this._renderer = renderer;
    this._camera = camera;
  }

  /** Register (or replace) a mesh by id so it can be drawn when referenced. */
  setMesh(id: string, mesh: MeshData): void {
    this._meshes.set(id, mesh);
  }

  /** Replace the active camera (e.g. after an orbit/pan). */
  setCamera(camera: Camera): void {
    this._camera = camera;
  }

  getCamera(): Camera {
    return this._camera;
  }

  /**
   * Build the draw list from the world (world-space model matrices) and issue
   * one `renderer.render(...)` per visible, mesh-resolved item, in ascending
   * entity-id order. Each item's local transform is baked into the mesh
   * vertices so the renderer projects already-world-space geometry through the
   * camera. Items with no registered mesh are deterministically skipped.
   */
  render(): void {
    const items: DrawItem[] = extractDrawList(this._world);

    for (const item of items) {
      const mesh = this._meshes.get(item.meshId);
      if (!mesh) continue;
      const worldMesh = applyMatrix(mesh, item.transform);
      const gradient = flatGradient(item.color);
      // The upstream renderer clears + draws + presents internally; this single
      // call is the deterministic draw command for one entity.
      this._renderer.render(worldMesh, this._camera, gradient);
    }
  }
}
