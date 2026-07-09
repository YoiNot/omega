/**
 * @omega/engine-math — 4x4 matrix, column-major (matches WebGL/WebGPU expectations).
 * Layout: m[0..3] = column 0, m[4..7] = column 1, ... m[12..15] = column 3.
 */
import { Vec3 } from './vec.js';
import { DEG2RAD, clamp } from './math.js';

export class Mat4 {
  m: Float32Array;

  constructor() {
    this.m = new Float32Array(16);
    this.identity();
  }

  identity(): this {
    this.m.fill(0);
    this.m[0] = this.m[5] = this.m[10] = this.m[15] = 1;
    return this;
  }

  clone(): Mat4 {
    const r = new Mat4();
    r.m.set(this.m);
    return r;
  }

  copy(o: Mat4): this { this.m.set(o.m); return this; }

  /** this = a * b (matrix product), result stored in this. */
  multiply(o: Mat4): Mat4 { return Mat4.multiply(this, this, o); }

  static multiply(out: Mat4, a: Mat4, b: Mat4): Mat4 {
    const am = a.m, bm = b.m, r = out.m;
    for (let c = 0; c < 4; c++) {
      const b0 = bm[c * 4], b1 = bm[c * 4 + 1], b2 = bm[c * 4 + 2], b3 = bm[c * 4 + 3];
      r[c * 4 + 0] = am[0] * b0 + am[4] * b1 + am[8] * b2 + am[12] * b3;
      r[c * 4 + 1] = am[1] * b0 + am[5] * b1 + am[9] * b2 + am[13] * b3;
      r[c * 4 + 2] = am[2] * b0 + am[6] * b1 + am[10] * b2 + am[14] * b3;
      r[c * 4 + 3] = am[3] * b0 + am[7] * b1 + am[11] * b2 + am[15] * b3;
    }
    return out;
  }

  static perspective(out: Mat4, fovYRad: number, aspect: number, near: number, far: number): Mat4 {
    const f = 1 / Math.tan(fovYRad / 2);
    out.identity();
    const m = out.m;
    m[0] = f / aspect;
    m[5] = f;
    m[10] = (far + near) / (near - far);
    m[11] = -1;
    m[14] = (2 * far * near) / (near - far);
    m[15] = 0;
    return out;
  }

  static ortho(out: Mat4, left: number, right: number, bottom: number, top: number, near: number, far: number): Mat4 {
    out.identity();
    const m = out.m;
    m[0] = 2 / (right - left);
    m[5] = 2 / (top - bottom);
    m[10] = -2 / (far - near);
    m[12] = -(right + left) / (right - left);
    m[13] = -(top + bottom) / (top - bottom);
    m[14] = -(far + near) / (far - near);
    return out;
  }

  static lookAt(out: Mat4, eye: Vec3, center: Vec3, up: Vec3): Mat4 {
    const z = Vec3.sub(eye, center).normalize();
    const x = Vec3.cross(up, z).normalize();
    const y = Vec3.cross(z, x);
    const m = out.m;
    out.identity();
    m[0] = x.x; m[4] = x.y; m[8] = x.z;
    m[1] = y.x; m[5] = y.y; m[9] = y.z;
    m[2] = z.x; m[6] = z.y; m[10] = z.z;
    m[12] = -Vec3.dot(x, eye);
    m[13] = -Vec3.dot(y, eye);
    m[14] = -Vec3.dot(z, eye);
    return out;
  }

  static translation(out: Mat4, x: number, y: number, z: number): Mat4 {
    out.identity();
    out.m[12] = x; out.m[13] = y; out.m[14] = z;
    return out;
  }

  static scaling(out: Mat4, x: number, y: number, z: number): Mat4 {
    out.identity();
    out.m[0] = x; out.m[5] = y; out.m[10] = z;
    return out;
  }

  /** Transform a point (w=1). */
  transformPoint(p: Vec3): Vec3 {
    const m = this.m;
    const x = p.x, y = p.y, z = p.z;
    const w = m[3] * x + m[7] * y + m[11] * z + m[15];
    const iw = w !== 0 ? 1 / w : 1;
    return new Vec3(
      (m[0] * x + m[4] * y + m[8] * z + m[12]) * iw,
      (m[1] * x + m[5] * y + m[9] * z + m[13]) * iw,
      (m[2] * x + m[6] * y + m[10] * z + m[14]) * iw,
    );
  }

  /** Transform a direction (w=0). */
  transformDir(d: Vec3): Vec3 {
    const m = this.m;
    const x = d.x, y = d.y, z = d.z;
    return new Vec3(
      m[0] * x + m[4] * y + m[8] * z,
      m[1] * x + m[5] * y + m[9] * z,
      m[2] * x + m[6] * y + m[10] * z,
    );
  }

  /** Extract translation column as Vec3. */
  getTranslation(): Vec3 {
    return new Vec3(this.m[12], this.m[13], this.m[14]);
  }
}

/** Build a perspective matrix in degrees (convenience wrapper). */
export function perspectiveFov(out: Mat4, fovYDeg: number, aspect: number, near: number, far: number): Mat4 {
  return Mat4.perspective(out, fovYDeg * DEG2RAD, aspect, near, far);
}

/** Clamp a value to the NDC range after projection (used in tests). */
export function clampToNdc(v: number): number {
  return clamp(v, -1, 1);
}
