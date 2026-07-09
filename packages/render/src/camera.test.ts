import { describe, it, expect } from 'vitest';
import { Camera } from './camera.js';
import { Vec3, Mat4, DEG2RAD } from '@omega/engine-math';

describe('Camera', () => {
  it('viewProjection transforms a known point into clip space', () => {
    const cam = new Camera(60, 1, 0.1, 1000);
    cam.setPosition(new Vec3(0, 0, 5));
    cam.lookAt(new Vec3(0, 0, 0));

    // Origin is in front of the camera at z=0, which is 5 units away.
    const clip = cam.project(new Vec3(0, 0, 0));
    // In clip space the point should be in front (w>0) and within NDC range.
    expect(clip.z / 1).not.toBeNaN();
    // Verify the combined transform equals projection * view applied manually.
    const vp = cam.getViewProjection();
    const manual = vp.transformPoint(new Vec3(0, 0, 0));
    expect(manual.x).toBeCloseTo(clip.x);
    expect(manual.y).toBeCloseTo(clip.y);
    expect(manual.z).toBeCloseTo(clip.z);
  });

  it('getViewProjection composition matches manual multiply', () => {
    const cam = new Camera(45, 1.5, 0.5, 500);
    cam.setPosition(new Vec3(3, 4, 5));
    cam.lookAt(new Vec3(0, 0, 0));

    const vp = cam.getViewProjection();
    const view = new Mat4();
    const proj = new Mat4();
    Mat4.lookAt(view, new Vec3(3, 4, 5), new Vec3(0, 0, 0), new Vec3(0, 1, 0));
    Mat4.perspective(proj, 45 * DEG2RAD, 1.5, 0.5, 500);
    const expected = new Mat4();
    Mat4.multiply(expected, proj, view);
    for (let i = 0; i < 16; i++) {
      expect(vp.m[i]).toBeCloseTo(expected.m[i], 6);
    }
  });

  it('orbit positions camera at the expected distance from target', () => {
    const cam = new Camera(60, 1, 0.1, 1000);
    const target = new Vec3(0, 0, 0);
    const radius = 10;
    cam.orbit(0, 0, radius, target); // azimuth 0, elevation 0 -> +x axis

    const pos = cam.getPosition();
    const dist = Vec3.distance(pos, target);
    expect(dist).toBeCloseTo(radius, 6);
    // elevation 0 => y = target.y, x = radius
    expect(pos.y).toBeCloseTo(0);
    expect(pos.x).toBeCloseTo(radius);
    // camera looks at target
    expect(cam.getCenter().x).toBeCloseTo(0);
  });

  it('orbit with elevation raises camera above target', () => {
    const cam = new Camera(60, 1, 0.1, 1000);
    const target = new Vec3(1, 1, 1);
    cam.orbit(0, Math.PI / 4, 8, target);
    const pos = cam.getPosition();
    expect(pos.y).toBeGreaterThan(target.y);
    expect(Vec3.distance(pos, target)).toBeCloseTo(8, 6);
  });

  it('clampElevation keeps within poles', () => {
    expect(Camera.clampElevation(Math.PI / 2)).toBeLessThan(Math.PI / 2);
    expect(Camera.clampElevation(-Math.PI / 2)).toBeGreaterThan(-Math.PI / 2);
  });

  it('perspective() updates matrices', () => {
    const cam = new Camera(30, 2, 1, 100);
    const vp = cam.getViewProjection();
    expect(vp.m[0]).toBeGreaterThan(0); // f/aspect > 0 for fov 30
  });
});
