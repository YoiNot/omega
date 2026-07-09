import { describe, it, expect } from 'vitest';
import { Vec2, Vec3, Vec4 } from './vec.js';

describe('Vec2', () => {
  it('add/sub/scale', () => {
    const a = new Vec2(1, 2).add(new Vec2(3, 4));
    expect([a.x, a.y]).toEqual([4, 6]);
    const b = new Vec2(4, 6).sub(new Vec2(1, 1));
    expect([b.x, b.y]).toEqual([3, 5]);
    const c = new Vec2(2, -3).scale(2);
    expect([c.x, c.y]).toEqual([4, -6]);
  });
  it('dot/length/normalize', () => {
    expect(new Vec2(3, 4).length()).toBe(5);
    expect(new Vec2(3, 4).dot(new Vec2(1, 0))).toBe(3);
    const n = new Vec2(3, 4).normalize();
    expect(n.length()).toBeCloseTo(1, 10);
  });
  it('clone/copy/set', () => {
    const a = new Vec2(1, 2);
    const b = a.clone(); b.x = 9;
    expect(a.x).toBe(1);
    a.copy(b);
    expect(a.x).toBe(9);
    a.set(0, 0);
    expect([a.x, a.y]).toEqual([0, 0]);
  });
  it('static helpers', () => {
    expect(Vec2.distance(new Vec2(0, 0), new Vec2(3, 4))).toBe(5);
    const d = Vec2.sub(new Vec2(5, 5), new Vec2(2, 1));
    expect([d.x, d.y]).toEqual([3, 4]);
  });
});

describe('Vec3', () => {
  it('cross product is perpendicular', () => {
    const a = new Vec3(1, 0, 0);
    const b = new Vec3(0, 1, 0);
    const c = a.cross(b).clone();
    expect([c.x, c.y, c.z]).toEqual([0, 0, 1]);
    expect(c.dot(a)).toBeCloseTo(0, 10);
    expect(c.dot(b)).toBeCloseTo(0, 10);
  });
  it('length/normalize', () => {
    expect(new Vec3(1, 2, 2).length()).toBe(3);
    const n = new Vec3(0, 0, 5).normalize();
    expect(n.length()).toBeCloseTo(1, 10);
    expect(n.z).toBeCloseTo(1, 10);
  });
  it('static lerp', () => {
    const r = Vec3.lerp(new Vec3(0, 0, 0), new Vec3(10, 20, 30), 0.5);
    expect([r.x, r.y, r.z]).toEqual([5, 10, 15]);
  });
  it('addScaled', () => {
    const v = new Vec3(1, 1, 1).addScaled(new Vec3(1, 2, 3), 2);
    expect([v.x, v.y, v.z]).toEqual([3, 5, 7]);
  });
});

describe('Vec4', () => {
  it('dot/length', () => {
    const a = new Vec4(1, 2, 3, 4);
    expect(a.dot(new Vec4(1, 0, 0, 0))).toBe(1);
    expect(a.length()).toBeCloseTo(Math.sqrt(30), 10);
  });
});
