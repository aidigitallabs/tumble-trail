import { describe, expect, it } from 'vitest';
import { palettes } from '../../src/config/brand';
import { tuning } from '../../src/config/tuning';
import { buildDecorGeometries, hashSeed, mulberry32, placeDecor } from '../../src/game/Decor';
import { buildSpline, type Spline } from '../../src/game/Spline';
import { levelTest } from '../../src/levels/levelTest';
import type { Vec3 } from '../../src/levels/schema';

/** Plan-view distance from a point to the nearest centreline frame. */
function nearest(spline: Spline, x: number, z: number): number {
  let best = Infinity;
  for (const f of spline.frames) best = Math.min(best, Math.hypot(f.pos.x - x, f.pos.z - z));
  return best;
}

describe('seeded PRNG', () => {
  it('is deterministic, in [0, 1) and differs per seed', () => {
    const a = mulberry32(123);
    const b = mulberry32(123);
    const c = mulberry32(124);
    const xs = Array.from({ length: 50 }, () => a());
    expect(xs).toEqual(Array.from({ length: 50 }, () => b()));
    expect(xs).not.toEqual(Array.from({ length: 50 }, () => c()));
    for (const x of xs) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });

  it('the seed comes from the level id', () => {
    expect(hashSeed('level01')).toBe(hashSeed('level01'));
    expect(hashSeed('level01')).not.toBe(hashSeed('level02'));
  });
});

describe('decor placement (PLAN section 9)', () => {
  const spline = buildSpline(levelTest.points);

  it('is deterministic per level id, different between levels', () => {
    const a = placeDecor('levelTest', spline);
    const b = placeDecor('levelTest', spline);
    expect(a.map((d) => d.pos.toArray())).toEqual(b.map((d) => d.pos.toArray()));
    expect(placeDecor('other', spline).map((d) => d.pos.toArray())).not.toEqual(
      a.map((d) => d.pos.toArray()),
    );
  });

  it('has about decorPerMetre items per metre, with all three shapes', () => {
    const items = placeDecor('levelTest', spline);
    const want = tuning.decor.perMetre * spline.totalM;
    expect(items.length).toBeGreaterThan(want * 0.9);
    expect(items.length).toBeLessThanOrEqual(Math.round(want));
    expect(new Set(items.map((d) => d.kind))).toEqual(new Set(['tree', 'cloud', 'disc']));
  });

  it('puts every item 8-16 m from the centreline (plan view), on both sides', () => {
    const items = placeDecor('levelTest', spline);
    let left = 0;
    let right = 0;
    for (const d of items) {
      const dist = nearest(spline, d.pos.x, d.pos.z);
      expect(dist).toBeGreaterThanOrEqual(8);
      expect(dist).toBeLessThanOrEqual(16);
      const f = spline.frames.reduce((best, g) =>
        Math.hypot(g.pos.x - d.pos.x, g.pos.z - d.pos.z) <
        Math.hypot(best.pos.x - d.pos.x, best.pos.z - d.pos.z)
          ? g
          : best,
      );
      if (d.pos.clone().sub(f.pos).dot(f.right) > 0) right++;
      else left++;
    }
    expect(left).toBeGreaterThan(5);
    expect(right).toBeGreaterThan(5);
  });

  it('keeps the distance even where the track curves back near itself', () => {
    // A 350 degree circle of radius 14 m ends right beside its start.
    const loop: Vec3[] = [];
    for (let deg = 0; deg <= 350; deg += 20) {
      const a = (deg * Math.PI) / 180;
      loop.push([14 * Math.sin(a), 0, 14 - 14 * Math.cos(a)]);
    }
    const curved = buildSpline(loop);
    const items = placeDecor('loop', curved);
    expect(items.length).toBeGreaterThan(10);
    for (const d of items) {
      const dist = nearest(curved, d.pos.x, d.pos.z);
      expect(dist).toBeGreaterThanOrEqual(8);
      expect(dist).toBeLessThanOrEqual(16);
    }
  });

  it('trees and discs sit on the ground, clouds float above it', () => {
    for (const d of placeDecor('levelTest', spline)) {
      const f = spline.frames.reduce((best, g) =>
        Math.hypot(g.pos.x - d.pos.x, g.pos.z - d.pos.z) <
        Math.hypot(best.pos.x - d.pos.x, best.pos.z - d.pos.z)
          ? g
          : best,
      );
      if (d.kind === 'cloud') expect(d.pos.y).toBeGreaterThan(f.pos.y + 3);
      else expect(d.pos.y).toBeLessThan(f.pos.y);
    }
  });
});

describe('decor shapes', () => {
  it('are small, vertex-coloured, and use the palette', () => {
    for (const palette of Object.values(palettes)) {
      const shapes = buildDecorGeometries(palette);
      for (const g of Object.values(shapes)) {
        const tris = g.getAttribute('position').count / 3;
        expect(tris).toBeGreaterThan(8);
        expect(tris).toBeLessThan(600);
        expect(g.getAttribute('color').count).toBe(g.getAttribute('position').count);
      }
    }
    // The tree uses decorA (crown) and decorB (trunk) of the palette.
    const col = buildDecorGeometries(palettes.beach).tree.getAttribute('color');
    const seen = new Set<string>();
    for (let i = 0; i < col.count; i++) {
      seen.add([col.getX(i), col.getY(i), col.getZ(i)].map((v) => v.toFixed(3)).join(','));
    }
    expect(seen.size).toBe(2);
  });
});
