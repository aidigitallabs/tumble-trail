import { CatmullRomCurve3, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { tuning } from '../../src/config/tuning';
import {
  buildSpline,
  frameIndexAtArc,
  makeFrame,
  pointAtArc,
  type Frame,
} from '../../src/game/Spline';
import { levelTest } from '../../src/levels/levelTest';
import { hairpinPoints, straightPoints } from './fixtures';

const near = (a: number, b: number, eps = 1e-6): void => expect(Math.abs(a - b)).toBeLessThan(eps);

describe('arc-length lookup table', () => {
  it('has at least 2000 samples', () => {
    expect(tuning.spline.lutSamples).toBeGreaterThanOrEqual(2000);
    expect(buildSpline(levelTest.points).lut.length).toBeGreaterThanOrEqual(2001);
  });

  it('finishM matches an independent high-resolution polyline length', () => {
    for (const pts of [levelTest.points, hairpinPoints]) {
      const spline = buildSpline(pts);
      const curve = new CatmullRomCurve3(
        pts.map(([x, y, z]) => new Vector3(x, y, z)),
        false,
        'centripetal',
        0.5,
      );
      const poly = curve.getPoints(50000);
      let len = 0;
      for (let i = 1; i < poly.length; i++)
        len += (poly[i] as Vector3).distanceTo(poly[i - 1] as Vector3);
      expect(Math.abs(spline.finishM - len) / len).toBeLessThan(0.001);
    }
  });

  it('is uniform within 3 %: points 1 m apart in arc are about 1 m apart in space', () => {
    for (const pts of [levelTest.points, hairpinPoints]) {
      const spline = buildSpline(pts);
      let prev = pointAtArc(spline, 0);
      for (let s = 1; s <= spline.finishM; s += 1) {
        const p = pointAtArc(spline, s);
        const d = p.distanceTo(prev);
        expect(Math.abs(d - 1)).toBeLessThan(0.03);
        prev = p;
      }
    }
  });

  it('is monotone and starts at 0', () => {
    const { lut } = buildSpline(levelTest.points);
    expect(lut[0]).toBe(0);
    for (let k = 1; k < lut.length; k++) {
      expect(lut[k] as number).toBeGreaterThan(lut[k - 1] as number);
    }
  });
});

describe('frames', () => {
  it('are sampled every 0.5 m from 0 to the end of the pad', () => {
    const spline = buildSpline(levelTest.points);
    expect(spline.ds).toBe(0.5);
    spline.frames.forEach((f, i) => near(f.arcM, i * 0.5));
    expect(spline.totalM).toBeGreaterThanOrEqual(spline.finishM + tuning.spline.endPadM);
    expect(spline.totalM).toBeLessThan(spline.finishM + tuning.spline.endPadM + spline.ds + 1e-9);
    expect(spline.frames[0]?.pos.distanceTo(new Vector3(...levelTest.points[0]!))).toBeLessThan(
      1e-6,
    );
  });

  it('are orthonormal', () => {
    for (const pts of [levelTest.points, hairpinPoints]) {
      for (const f of buildSpline(pts).frames) {
        near(f.tangent.length(), 1);
        near(f.right.length(), 1);
        near(f.up.length(), 1);
        near(f.tangent.dot(f.right), 0, 1e-9);
        near(f.tangent.dot(f.up), 0, 1e-9);
        near(f.right.dot(f.up), 0, 1e-9);
        // up = cross(right, tangent), so right x up = -tangent.
        const cr = new Vector3().crossVectors(f.right, f.up);
        near(cr.dot(f.tangent), -1, 1e-9);
        near(f.right.y, 0, 1e-12); // right is always horizontal
        expect(f.up.y).toBeGreaterThan(0.9); // slopes stay well below vertical
      }
    }
  });

  it('right is screen-right: tangent +Z gives right = -X', () => {
    const f = makeFrame(new Vector3(), new Vector3(0, 0, 1), 0);
    near(f.right.x, -1);
    near(f.right.y, 0);
    near(f.right.z, 0);
    near(f.up.y, 1);
    const g = makeFrame(new Vector3(), new Vector3(1, 0, 0), 0);
    near(g.right.z, 1); // heading +X: screen-right is +Z
  });

  it('a straight spline along +Z has right = -X on every frame', () => {
    for (const f of buildSpline(straightPoints).frames) {
      near(f.tangent.z, 1, 1e-6);
      near(f.right.x, -1, 1e-6);
    }
  });

  it('up equals cross(right, tangent)', () => {
    for (const f of buildSpline(levelTest.points).frames) {
      const u = new Vector3().crossVectors(f.right, f.tangent);
      expect(u.distanceTo(f.up)).toBeLessThan(1e-9);
    }
  });
});

describe('end pad and finish', () => {
  it('finishM is the arc length at the last control point', () => {
    const spline = buildSpline(straightPoints);
    near(spline.finishM, 40, 1e-3);
    const at = pointAtArc(spline, spline.finishM);
    expect(at.distanceTo(new Vector3(0, 0, 40))).toBeLessThan(1e-6);
  });

  it('continues 6 m or more straight and flat beyond the last control point', () => {
    const spline = buildSpline(levelTest.points);
    const last = spline.frames[spline.frames.length - 1] as Frame;
    expect(last.arcM - spline.finishM).toBeGreaterThanOrEqual(6);
    const pad = spline.frames.filter((f) => f.arcM > spline.finishM + 1e-9);
    expect(pad.length).toBeGreaterThanOrEqual(12);
    const dir = (pad[0] as Frame).tangent;
    for (const f of pad) {
      near(f.tangent.y, 0, 1e-12);
      expect(f.tangent.distanceTo(dir)).toBeLessThan(1e-9);
      near(f.pos.y, (pad[0] as Frame).pos.y, 1e-9);
    }
  });

  it('frameIndexAtArc clamps', () => {
    const spline = buildSpline(straightPoints);
    expect(frameIndexAtArc(spline, -5)).toBe(0);
    expect(frameIndexAtArc(spline, 10)).toBe(20);
    expect(frameIndexAtArc(spline, 1e6)).toBe(spline.frames.length - 1);
  });

  it('rejects fewer than two points', () => {
    expect(() => buildSpline([[0, 0, 0]])).toThrow();
  });
});
