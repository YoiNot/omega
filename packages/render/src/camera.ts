import { Vec3, Mat4, DEG2RAD, clamp } from '@omega/engine-math';

/**
 * Perspective camera that produces a combined view-projection matrix.
 * Pure math (no GL) so it is fully Node-testable.
 */
export class Camera {
  fovYRad: number;
  aspect: number;
  near: number;
  far: number;

  private position: Vec3;
  private center: Vec3;
  private up: Vec3;

  private readonly view: Mat4;
  private readonly projection: Mat4;
  private readonly viewProjection: Mat4;

  constructor(
    fovYDeg = 60,
    aspect = 1,
    near = 0.1,
    far = 1000,
  ) {
    this.fovYRad = fovYDeg * DEG2RAD;
    this.aspect = aspect;
    this.near = near;
    this.far = far;

    this.position = new Vec3(0, 0, 5);
    this.center = new Vec3(0, 0, 0);
    this.up = new Vec3(0, 1, 0);

    this.view = new Mat4();
    this.projection = new Mat4();
    this.viewProjection = new Mat4();
    this.update();
  }

  /** Configure the perspective projection. */
  perspective(fovYDeg: number, aspect: number, near: number, far: number): this {
    this.fovYRad = fovYDeg * DEG2RAD;
    this.aspect = aspect;
    this.near = near;
    this.far = far;
    return this.update();
  }

  setPosition(p: Vec3): this {
    this.position.copy(p);
    return this.update();
  }

  lookAt(center: Vec3): this {
    this.center.copy(center);
    return this.update();
  }

  setUp(up: Vec3): this {
    this.up.copy(up);
    return this.update();
  }

  getPosition(): Vec3 {
    return this.position.clone();
  }

  getCenter(): Vec3 {
    return this.center.clone();
  }

  /** Position the camera on a sphere around `target` and look at it. */
  orbit(azimuthRad: number, elevationRad: number, radius: number, target: Vec3): this {
    const ce = Math.cos(elevationRad);
    const x = target.x + radius * ce * Math.cos(azimuthRad);
    const y = target.y + radius * Math.sin(elevationRad);
    const z = target.z + radius * ce * Math.sin(azimuthRad);
    this.position.set(x, y, z);
    this.center.copy(target);
    return this.update();
  }

  /** Recompute view & projection matrices. */
  private update(): this {
    Mat4.perspective(this.projection, this.fovYRad, this.aspect, this.near, this.far);
    Mat4.lookAt(this.view, this.position, this.center, this.up);
    Mat4.multiply(this.viewProjection, this.projection, this.view);
    return this;
  }

  getView(): Mat4 { return this.view.clone(); }
  getProjection(): Mat4 { return this.projection.clone(); }

  /** The combined view-projection matrix (projection * view). */
  getViewProjection(): Mat4 {
    return this.viewProjection.clone();
  }

  /** Transform a world point into clip space via the view-projection matrix. */
  project(p: Vec3): Vec3 {
    return this.viewProjection.transformPoint(p);
  }

  /** Clamp elevation to keep the camera from flipping at the poles. */
  static clampElevation(e: number): number {
    return clamp(e, -Math.PI / 2 + 1e-3, Math.PI / 2 - 1e-3);
  }
}
