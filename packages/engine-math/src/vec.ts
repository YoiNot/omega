/**
 * @omega/engine-math — vector types (Vec2, Vec3, Vec4) and operations.
 * Plain mutable-friendly classes with deterministic, allocation-light methods.
 */

export class Vec2 {
  constructor(public x = 0, public y = 0) {}

  static of(x: number, y: number): Vec2 { return new Vec2(x, y); }
  clone(): Vec2 { return new Vec2(this.x, this.y); }
  set(x: number, y: number): this { this.x = x; this.y = y; return this; }
  copy(o: Vec2): this { this.x = o.x; this.y = o.y; return this; }

  add(o: Vec2): this { this.x += o.x; this.y += o.y; return this; }
  sub(o: Vec2): this { this.x -= o.x; this.y -= o.y; return this; }
  scale(s: number): this { this.x *= s; this.y *= s; return this; }
  addScaled(o: Vec2, s: number): this { this.x += o.x * s; this.y += o.y * s; return this; }

  dot(o: Vec2): number { return this.x * o.x + this.y * o.y; }
  lengthSq(): number { return this.x * this.x + this.y * this.y; }
  length(): number { return Math.sqrt(this.lengthSq()); }

  normalize(): this {
    const l = this.length();
    if (l > 1e-9) { this.x /= l; this.y /= l; }
    return this;
  }

  static dot(a: Vec2, b: Vec2): number { return a.x * b.x + a.y * b.y; }
  static distance(a: Vec2, b: Vec2): number { return Math.hypot(a.x - b.x, a.y - b.y); }
  static sub(a: Vec2, b: Vec2): Vec2 { return new Vec2(a.x - b.x, a.y - b.y); }
  static add(a: Vec2, b: Vec2): Vec2 { return new Vec2(a.x + b.x, a.y + b.y); }
}

export class Vec3 {
  constructor(public x = 0, public y = 0, public z = 0) {}

  static of(x: number, y: number, z: number): Vec3 { return new Vec3(x, y, z); }
  clone(): Vec3 { return new Vec3(this.x, this.y, this.z); }
  set(x: number, y: number, z: number): this { this.x = x; this.y = y; this.z = z; return this; }
  copy(o: Vec3): this { this.x = o.x; this.y = o.y; this.z = o.z; return this; }

  add(o: Vec3): this { this.x += o.x; this.y += o.y; this.z += o.z; return this; }
  sub(o: Vec3): this { this.x -= o.x; this.y -= o.y; this.z -= o.z; return this; }
  scale(s: number): this { this.x *= s; this.y *= s; this.z *= s; return this; }
  addScaled(o: Vec3, s: number): this { this.x += o.x * s; this.y += o.y * s; this.z += o.z * s; return this; }

  dot(o: Vec3): number { return this.x * o.x + this.y * o.y + this.z * o.z; }
  cross(o: Vec3): Vec3 {
    return new Vec3(
      this.y * o.z - this.z * o.y,
      this.z * o.x - this.x * o.z,
      this.x * o.y - this.y * o.x,
    );
  }
  lengthSq(): number { return this.x * this.x + this.y * this.y + this.z * this.z; }
  length(): number { return Math.sqrt(this.lengthSq()); }

  normalize(): this {
    const l = this.length();
    if (l > 1e-9) { this.x /= l; this.y /= l; this.z /= l; }
    return this;
  }

  static dot(a: Vec3, b: Vec3): number { return a.x * b.x + a.y * b.y + a.z * b.z; }
  static cross(a: Vec3, b: Vec3): Vec3 { return a.cross(b); }
  static distance(a: Vec3, b: Vec3): number {
    return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2);
  }
  static sub(a: Vec3, b: Vec3): Vec3 { return new Vec3(a.x - b.x, a.y - b.y, a.z - b.z); }
  static add(a: Vec3, b: Vec3): Vec3 { return new Vec3(a.x + b.x, a.y + b.y, a.z + b.z); }
  static lerp(a: Vec3, b: Vec3, t: number): Vec3 {
    return new Vec3(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t);
  }
}

export class Vec4 {
  constructor(public x = 0, public y = 0, public z = 0, public w = 0) {}

  static of(x: number, y: number, z: number, w: number): Vec4 { return new Vec4(x, y, z, w); }
  clone(): Vec4 { return new Vec4(this.x, this.y, this.z, this.w); }
  set(x: number, y: number, z: number, w: number): this { this.x = x; this.y = y; this.z = z; this.w = w; return this; }

  dot(o: Vec4): number { return this.x * o.x + this.y * o.y + this.z * o.z + this.w * o.w; }
  lengthSq(): number { return this.dot(this); }
  length(): number { return Math.sqrt(this.lengthSq()); }

  static dot(a: Vec4, b: Vec4): number { return a.dot(b); }
}
