import { BufferGeometry, Color, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { palettes } from '../../src/config/brand';
import { tuning } from '../../src/config/tuning';
import { buildSpline, type Frame } from '../../src/game/Spline';
import { buildRibbonGeometry, wallHeight } from '../../src/game/Track';
import { levelTest } from '../../src/levels/levelTest';
import { straightPoints } from './fixtures';

interface Tri {
  a: Vector3;
  b: Vector3;
  c: Vector3;
  /** Geometric normal from the vertex order (independent of the normal attribute). */
  n: Vector3;
  centroid: Vector3;
  /** Stored normal of the first vertex. */
  stored: Vector3;
  color: Color;
}

function triangles(g: BufferGeometry): Tri[] {
  const pos = g.getAttribute('position');
  const nor = g.getAttribute('normal');
  const col = g.getAttribute('color');
  expect(g.getIndex()).toBeNull();
  expect(pos.count % 3).toBe(0);
  const out: Tri[] = [];
  for (let i = 0; i < pos.count; i += 3) {
    const a = new Vector3().fromBufferAttribute(pos, i);
    const b = new Vector3().fromBufferAttribute(pos, i + 1);
    const c = new Vector3().fromBufferAttribute(pos, i + 2);
    const n = new Vector3().subVectors(b, a).cross(new Vector3().subVectors(c, a)).normalize();
    out.push({
      a,
      b,
      c,
      n,
      centroid: a.clone().add(b).add(c).divideScalar(3),
      stored: new Vector3().fromBufferAttribute(nor, i),
      color: new Color().fromBufferAttribute(col, i),
    });
  }
  return out;
}

const sameColour = (a: Color, b: Color): boolean =>
  Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b) < 1e-5;

const straight = buildSpline(straightPoints);
const W = 6;
const HW = W / 2;
const T = tuning.track.wallThicknessM;
const lastZ = (straight.frames[straight.frames.length - 1] as Frame).pos.z;

describe('floor', () => {
  const { floor } = buildRibbonGeometry(straight.frames, W, 'full', []);
  const tris = triangles(floor);

  it('has 3 strips x 2 triangles per frame segment', () => {
    expect(floor.getAttribute('position').count).toBe((straight.frames.length - 1) * 3 * 6);
    expect(tris.length).toBe((straight.frames.length - 1) * 6);
  });

  it('is wound counter-clockwise seen from above, and the stored normals agree', () => {
    for (const t of tris) {
      expect(t.n.y).toBeGreaterThan(0.999);
      expect(t.stored.distanceTo(t.n)).toBeLessThan(1e-5);
    }
  });

  it('is wound counter-clockwise on slopes and curves too (levelTest)', () => {
    const spline = buildSpline(levelTest.points);
    const g = buildRibbonGeometry(spline.frames, 6, 'full', [], { finishM: spline.finishM });
    for (const t of triangles(g.floor)) expect(t.n.y).toBeGreaterThan(0.9);
  });

  it('spans exactly the track width and follows the centreline', () => {
    floor.computeBoundingBox();
    const bb = floor.boundingBox!;
    expect(bb.min.x).toBeCloseTo(-HW, 5);
    expect(bb.max.x).toBeCloseTo(HW, 5);
    expect(bb.min.z).toBeCloseTo(0, 5);
    expect(bb.max.z).toBeCloseTo(lastZ, 5);
  });

  it('carries vertex colours: a dashed centre stripe on a plain track', () => {
    const track = new Color(palettes.meadow.track);
    const stripe = new Color(palettes.meadow.trackStripe);
    let stripeTris = 0;
    let trackTris = 0;
    for (const t of tris) {
      const isStripe = sameColour(t.color, stripe);
      const isTrack = sameColour(t.color, track);
      expect(isStripe || isTrack).toBe(true);
      if (isStripe) {
        stripeTris++;
        expect(Math.abs(t.centroid.x)).toBeLessThanOrEqual(tuning.track.stripeWidthM / 2);
      } else {
        trackTris++;
      }
    }
    expect(stripeTris).toBeGreaterThan(0);
    expect(trackTris).toBeGreaterThan(stripeTris);
  });

  it('uses the supplied colours', () => {
    const { floor: f } = buildRibbonGeometry(straight.frames, W, 'low', [], {
      colors: { track: 0xff0000, stripe: 0x00ff00, wall: 0x0000ff },
    });
    const colours = new Set(triangles(f).map((t) => t.color.getHex()));
    expect(colours).toEqual(new Set([0xff0000, 0x00ff00]));
  });
});

describe('walls (no end pad: one run per side)', () => {
  const run = (mode: 'full' | 'low' | 'none', spans: Array<[number, number]> = []) =>
    triangles(buildRibbonGeometry(straight.frames, W, mode, spans).walls);

  it('full is 1.5 m and low is 0.35 m tall, vertical, and none has no walls', () => {
    for (const [mode, h] of [
      ['full', 1.5],
      ['low', 0.35],
    ] as const) {
      expect(wallHeight(mode)).toBe(h);
      const tris = run(mode);
      expect(tris.length).toBeGreaterThan(0);
      const ys = tris.flatMap((t) => [t.a.y, t.b.y, t.c.y]);
      expect(Math.max(...ys)).toBeCloseTo(h, 6);
      expect(Math.min(...ys)).toBeCloseTo(0, 6);
      // Inner faces are vertical: x stays at +/- HW for every inner-face vertex.
      for (const t of tris) {
        if (Math.abs(t.n.x) > 0.999) {
          const x = Math.abs(t.centroid.x);
          expect(Math.min(Math.abs(x - HW), Math.abs(x - (HW + T)))).toBeLessThan(1e-6);
        }
      }
    }
    expect(run('none')).toHaveLength(0);
  });

  it('has 18 vertices per segment per side plus 6 per end cap', () => {
    const segments = straight.frames.length - 1;
    const verts = buildRibbonGeometry(straight.frames, W, 'full', []).walls.getAttribute(
      'position',
    ).count;
    expect(verts).toBe(2 * (segments * 18 + 2 * 6));
  });

  it('every triangle faces out of the wall solid, and stored normals agree', () => {
    const h = 1.5;
    const zMid = lastZ / 2;
    for (const t of run('full')) {
      expect(t.stored.distanceTo(t.n)).toBeLessThan(1e-5);
      const side = Math.sign(t.centroid.x);
      const solidCentre = new Vector3(side * (HW + T / 2), h / 2, zMid);
      expect(t.n.dot(t.centroid.clone().sub(solidCentre))).toBeGreaterThan(0);
    }
  });

  it('omits the walls inside noWallSpansM and nowhere else', () => {
    const tris = run('low', [[10, 20]]);
    const zs = tris.flatMap((t) => [t.a.z, t.b.z, t.c.z]);
    // Nothing strictly inside the span (caps sit exactly on its edges).
    expect(zs.some((z) => z > 10 + 1e-6 && z < 20 - 1e-6)).toBe(false);
    expect(zs.some((z) => z < 10)).toBe(true);
    expect(zs.some((z) => z > 20)).toBe(true);
    // Both edges of the gap are capped, so there are 2 runs per side.
    expect(zs.some((z) => Math.abs(z - 10) < 1e-6)).toBe(true);
    expect(zs.some((z) => Math.abs(z - 20) < 1e-6)).toBe(true);
  });

  it('noWallSpansM covering everything removes all walls', () => {
    expect(run('full', [[-1, 1e6]])).toHaveLength(0);
  });
});

describe('finish and end pad', () => {
  const F = straight.finishM; // 40
  const { walls } = buildRibbonGeometry(straight.frames, W, 'full', [], { finishM: F });
  const tris = triangles(walls);
  const sideTris = tris.filter((t) => Math.abs(t.centroid.x) > HW - 1e-6 && t.centroid.z <= lastZ);

  it('omits side walls for the 2 m before the finish line', () => {
    const noWall = tuning.track.noWallBeforeFinishM;
    expect(noWall).toBe(2);
    const zs = sideTris.flatMap((t) => [t.a.z, t.b.z, t.c.z]);
    expect(zs.some((z) => z > F - noWall + 1e-6 && z < F - 1e-6)).toBe(false);
    expect(zs.some((z) => z > F)).toBe(true); // pad side walls
    expect(zs.some((z) => z < F - noWall)).toBe(true); // track side walls
  });

  it('has pad side walls and a back wall across the end', () => {
    const ys = tris.flatMap((t) => [t.a.y, t.b.y, t.c.y]);
    expect(Math.max(...ys)).toBeCloseTo(1.5, 6);
    const zs = tris.flatMap((t) => [t.a.z, t.b.z, t.c.z]);
    expect(Math.max(...zs)).toBeCloseTo(lastZ + T, 5);
    // Inner face of the back wall: normal -Z at the last frame, wider than the track.
    const inner = tris.filter((t) => t.n.z < -0.999 && Math.abs(t.centroid.z - lastZ) < 1e-6);
    const xs = inner.flatMap((t) => [t.a.x, t.b.x, t.c.x]);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(W + 2 * T, 5);
    // Outer face looks away from the track.
    expect(tris.some((t) => t.n.z > 0.999 && Math.abs(t.centroid.z - (lastZ + T)) < 1e-6)).toBe(
      true,
    );
  });

  it('keeps pad walls (low) when the mode is none', () => {
    const t = triangles(buildRibbonGeometry(straight.frames, W, 'none', [], { finishM: F }).walls);
    expect(t.length).toBeGreaterThan(0);
    const zs = t.flatMap((x) => [x.a.z, x.b.z, x.c.z]);
    expect(Math.min(...zs)).toBeGreaterThanOrEqual(F - 1e-6 - 0.5);
    const ys = t.flatMap((x) => [x.a.y, x.b.y, x.c.y]);
    expect(Math.max(...ys)).toBeCloseTo(0.35, 6);
  });
});

describe('levelTest ribbon', () => {
  it('stays well inside the triangle budget', () => {
    const spline = buildSpline(levelTest.points);
    const g = buildRibbonGeometry(spline.frames, 6, 'full', [], { finishM: spline.finishM });
    const triCount =
      (g.floor.getAttribute('position').count + g.walls.getAttribute('position').count) / 3;
    expect(triCount).toBeLessThan(10000);
  });
});
