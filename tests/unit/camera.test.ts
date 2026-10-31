import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { tuning } from '../../src/config/tuning';
import { FollowCamera, verticalFovFor } from '../../src/game/Camera';
import { buildSpline, frameIndexAtArc, type Frame } from '../../src/game/Spline';
import { levelTest } from '../../src/levels/levelTest';
import { straightPoints } from './fixtures';

describe('FOV (PLAN section 7)', () => {
  it('keeps the horizontal FOV at 75 degrees at any aspect ratio', () => {
    for (const aspect of [0.5, 0.75, 1, 4 / 3, 16 / 9, 2.16]) {
      const v = (verticalFovFor(75, aspect) * Math.PI) / 180;
      const h = 2 * Math.atan(Math.tan(v / 2) * aspect);
      expect((h * 180) / Math.PI).toBeCloseTo(75, 6);
    }
    const cam = new FollowCamera(tuning.tiers.tiny);
    cam.setAspect(4 / 3);
    expect(cam.camera.fov).toBeCloseTo(verticalFovFor(tuning.camera.horizontalFovDeg, 4 / 3), 6);
  });
});

describe('FollowCamera placement', () => {
  const spline = buildSpline(straightPoints); // along +Z
  const tier = tuning.tiers.tiny;
  const idx = frameIndexAtArc(spline, 10);

  it('snaps to cameraBack behind and cameraUp above, looking ahead and slightly up', () => {
    const cam = new FollowCamera(tier);
    const ball = new Vector3(0, 0.5, 10);
    cam.snap(ball, spline.frames, idx);
    const p = cam.camera.position;
    expect(p.x).toBeCloseTo(0, 5);
    expect(p.y).toBeCloseTo(0.5 + tier.cameraUp, 5);
    expect(p.z).toBeCloseTo(10 - tier.cameraBack, 5);
    // Looking down the track at a point cameraLookAhead ahead and lookAtUpM above the ball.
    const dir = cam.camera.getWorldDirection(new Vector3());
    const expected = new Vector3(0, 0.5 + tuning.camera.lookAtUpM, 10 + tier.cameraLookAhead)
      .sub(p)
      .normalize();
    expect(dir.distanceTo(expected)).toBeLessThan(1e-5);
  });

  it('never rolls: the camera right vector stays horizontal', () => {
    const spline2 = buildSpline(levelTest.points);
    const cam = new FollowCamera(tier);
    const dt = 1 / 60;
    for (let s = 0; s < spline2.finishM; s += 0.1) {
      const i = frameIndexAtArc(spline2, s);
      const f = spline2.frames[i] as Frame;
      cam.update(dt, f.pos.clone().addScaledVector(f.up, 0.5), spline2.frames, i);
      const right = new Vector3(1, 0, 0).applyQuaternion(cam.camera.quaternion);
      expect(Math.abs(right.y)).toBeLessThan(1e-6);
    }
  });

  it('raises the camera when the track behind is higher (descents)', () => {
    const spline2 = buildSpline(levelTest.points);
    const cam = new FollowCamera(tier);
    // Ramp down is about 74-90 m; plateau is ~3 m high.
    const i = frameIndexAtArc(spline2, 84);
    const f = spline2.frames[i] as Frame;
    const ball = f.pos.clone().addScaledVector(f.up, 0.5);
    cam.snap(ball, spline2.frames, i);
    const behind = spline2.frames[
      i - Math.round(tier.cameraBack / tuning.spline.frameSpacingM)
    ] as Frame;
    const rise = Math.max(0, behind.pos.y - f.pos.y);
    expect(rise).toBeGreaterThan(0.5);
    expect(cam.camera.position.y).toBeCloseTo(ball.y + tier.cameraUp + rise, 5);
  });

  it('eases its heading around a bend instead of jumping', () => {
    const spline2 = buildSpline(levelTest.points);
    const cam = new FollowCamera(tier);
    const i0 = frameIndexAtArc(spline2, 16);
    const f0 = spline2.frames[i0] as Frame;
    cam.snap(f0.pos.clone(), spline2.frames, i0);
    const before = cam.camera.getWorldDirection(new Vector3());
    const i1 = frameIndexAtArc(spline2, 22);
    const f1 = spline2.frames[i1] as Frame;
    cam.update(1 / 60, f1.pos.clone(), spline2.frames, i1);
    const after = cam.camera.getWorldDirection(new Vector3());
    // One frame later the view direction has moved only slightly.
    expect(before.angleTo(after)).toBeLessThan(0.15);
  });
});
