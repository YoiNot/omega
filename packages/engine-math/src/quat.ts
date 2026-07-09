/**
 * @omega/engine-math — quaternion (x, y, z, w) for rotations.
 */
import { Vec3 } from './vec.js';
import { HALF_PI } from './math.js';

export class Quat {
  constructor(public x = 0, public y = 0, public z = 0, public w = 1) {}

  static identity(): Quat { return new Quat(0, 0, 0, 1); }
  clone(): Quat { return new Quat(this.x, this.y, this.z, this.w); }
  set(x: number, y: number, z: number, w: number): this { this.x = x; this.y = y; this.z = z; this.w = w; return this; }
  copy(o: Quat): this { return this.set(o.x, o.y, o.z, o.w); }

  lengthSq(): number { return this.x ** 2 + this.y ** 2 + this.z ** 2 + this.w ** 2; }
  length(): number { return Math.sqrt(this.lengthSq()); }

  normalize(): this {
    const l = this.length();
    if (l > 1e-9) { const inv = 1 / l; this.x *= inv; this.y *= inv; this.z *= inv; this.w *= inv; }
    return this;
  }

  static fromAxisAngle(axis: Vec3, rad: number): Quat {
    const a = axis.clone().normalize();
    const s = Math.sin(rad * 0.5);
    return new Quat(a.x * s, a.y * s, a.z * s, Math.cos(rad * 0.5));
  }

  static fromEuler(xRad: number, yRad: number, zRad: number): Quat {
    const cx = Math.cos(xRad * 0.5), sx = Math.sin(xRad * 0.5);
    const cy = Math.cos(yRad * 0.5), sy = Math.sin(yRad * 0.5);
    const cz = Math.cos(zRad * 0.5), sz = Math.sin(zRad * 0.5);
    return new Quat(
      sx * cy * cz + cx * sy * sz,
      cx * sy * cz - sx * cy * sz,
      cx * cy * sz - sx * sy * cz,
      cx * cy * cz + sx * sy * sz,
    );
  }

  multiply(o: Quat): Quat {
    return Quat.multiply(new Quat(), this, o);
  }

  static multiply(out: Quat, a: Quat, b: Quat): Quat {
    const ax = a.x, ay = a.y, az = a.z, aw = a.w;
    const bx = b.x, by = b.y, bz = b.z, bw = b.w;
    out.x = aw * bx + ax * bw + ay * bz - az * by;
    out.y = aw * by - ax * bz + ay * bw + az * bx;
    out.z = aw * bz + ax * by - ay * bx + az * bw;
    out.w = aw * bw - ax * bx - ay * by - az * bz;
    return out;
  }

  /** Rotate vector v by this quaternion. */
  rotate(v: Vec3): Vec3 {
    const qv = new Quat(v.x, v.y, v.z, 0);
    const conj = new Quat(-this.x, -this.y, -this.z, this.w);
    const tmp = Quat.multiply(new Quat(), this, qv);
    const r = Quat.multiply(new Quat(), tmp, conj);
    return new Vec3(r.x, r.y, r.z);
  }

  /** Spherical linear interpolation. */
  static slerp(a: Quat, b: Quat, t: number): Quat {
    let cos = a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w;
    let bx = b.x, by = b.y, bz = b.z, bw = b.w;
    if (cos < 0) { cos = -cos; bx = -bx; by = -by; bz = -bz; bw = -bw; }
    if (cos > 0.9995) {
      return new Quat(
        a.x + (bx - a.x) * t,
        a.y + (by - a.y) * t,
        a.z + (bz - a.z) * t,
        a.w + (bw - a.w) * t,
      ).normalize();
    }
    const theta0 = Math.acos(cos);
    const theta = theta0 * t;
    const sin = Math.sin(theta), sin0 = Math.sin(theta0);
    const s0 = Math.cos(theta) - cos * sin / sin0;
    const s1 = sin / sin0;
    return new Quat(
      a.x * s0 + bx * s1,
      a.y * s0 + by * s1,
      a.z * s0 + bz * s1,
      a.w * s0 + bw * s1,
    );
  }

  toEuler(): Vec3 {
    const x = this.x, y = this.y, z = this.z, w = this.w;
    const sinrCosp = 2 * (w * x + y * z);
    const cosrCosp = 1 - 2 * (x * x + y * y);
    const roll = Math.atan2(sinrCosp, cosrCosp);
    const sinp = 2 * (w * y - z * x);
    const pitch = Math.abs(sinp) >= 1 ? Math.sign(sinp) * HALF_PI : Math.asin(sinp);
    const sinyCosp = 2 * (w * z + x * y);
    const cosyCosp = 1 - 2 * (y * y + z * z);
    const yaw = Math.atan2(sinyCosp, cosyCosp);
    return new Vec3(roll, pitch, yaw);
  }
}

export const QUAT_IDENTITY = Quat.identity();
