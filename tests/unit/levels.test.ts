import { describe, expect, it } from 'vitest';
import { buildSpline } from '../../src/game/Spline';
import { getLevel, levels, levelTest } from '../../src/levels';
import { validateLevel, type LevelDef, type Vec3 } from '../../src/levels/schema';
import { plainLevel, straightPoints } from './fixtures';

const withPoints = (points: Vec3[]): LevelDef => ({ ...levelTest, id: 'crafted', points });

describe('levelTest', () => {
  it('passes validateLevel', () => {
    expect(validateLevel(levelTest)).toEqual({ ok: true, errors: [] });
  });

  it('matches the brief: ~100 m, 3 checkpoints, 4 balloons, 2 bumps, meadow', () => {
    const spline = buildSpline(levelTest.points);
    expect(spline.finishM).toBeGreaterThan(95);
    expect(spline.finishM).toBeLessThan(105);
    expect(levelTest.checkpointsM).toHaveLength(3);
    expect(levelTest.obstacles.filter((o) => o.kind === 'balloon')).toHaveLength(4);
    expect(levelTest.obstacles.filter((o) => o.kind === 'bump')).toHaveLength(2);
    expect(levelTest.palette).toBe('meadow');
  });

  it('has the shape: straight, S-bend, 15 degree ramp up, plateau, ramp down, straight', () => {
    const { frames, finishM } = buildSpline(levelTest.points);
    const slopeDeg = (i: number): number =>
      (Math.asin((frames[i] as (typeof frames)[number]).tangent.y) * 180) / Math.PI;
    const at = (s: number): number => Math.round(s / 0.5);
    // Opening straight: flat and on the Z axis.
    for (let s = 0; s <= 12; s += 0.5) {
      expect(slopeDeg(at(s))).toBeCloseTo(0, 3);
      expect(Math.abs((frames[at(s)] as (typeof frames)[number]).pos.x)).toBeLessThan(0.2);
    }
    // S-bend: sways right (viewer's right is -X for +Z travel) ... then back to the axis.
    const xs = frames.filter((f) => f.arcM > 14 && f.arcM < 44).map((f) => f.pos.x);
    expect(Math.max(...xs)).toBeGreaterThan(2.5);
    expect(Math.abs((frames[at(44)] as (typeof frames)[number]).pos.x)).toBeLessThan(0.1);
    // Ramp up reaches about 15 degrees and never much more.
    const slopes = frames.map((_, i) => slopeDeg(i));
    expect(Math.max(...slopes)).toBeGreaterThan(14);
    expect(Math.max(...slopes)).toBeLessThan(16);
    expect(Math.min(...slopes)).toBeLessThan(-14);
    expect(Math.min(...slopes)).toBeGreaterThan(-16);
    // Plateau is high and flat; the course ends back at ground level.
    const heights = frames.filter((f) => f.arcM > 67 && f.arcM < 73).map((f) => f.pos.y);
    expect(Math.min(...heights)).toBeGreaterThan(2.5);
    expect(Math.max(...heights) - Math.min(...heights)).toBeLessThan(0.1);
    for (const f of frames.filter((g) => g.arcM > finishM - 8)) {
      expect(Math.abs(f.pos.y)).toBeLessThan(0.05);
    }
  });

  it('keeps checkpoints, obstacles and balloons where the later rules will want them', () => {
    const { finishM } = buildSpline(levelTest.points);
    const cps = levelTest.checkpointsM;
    expect([...cps].sort((a, b) => a - b)).toEqual(cps);
    expect(cps[0]).toBeGreaterThanOrEqual(10);
    expect(cps[cps.length - 1]).toBeLessThanOrEqual(finishM - 10);
    for (let i = 1; i < cps.length; i++) expect(cps[i]! - cps[i - 1]!).toBeLessThanOrEqual(30);
    for (const o of levelTest.obstacles) {
      expect(o.atM).toBeGreaterThanOrEqual(5);
      expect(o.atM).toBeLessThanOrEqual(finishM - 8);
      for (const c of cps) expect(Math.abs(o.atM - c)).toBeGreaterThanOrEqual(3);
    }
    const balloons = levelTest.obstacles
      .filter((o) => o.kind === 'balloon')
      .map((o) => o.atM)
      .sort((a, b) => a - b);
    expect(balloons[0]).toBeLessThanOrEqual(25);
    for (let i = 1; i < balloons.length; i++) {
      expect(balloons[i]! - balloons[i - 1]!).toBeLessThanOrEqual(25);
    }
    expect(finishM - balloons[balloons.length - 1]!).toBeLessThanOrEqual(25);
  });
});

describe('validateLevel rule 1', () => {
  it('rejects fewer than 4 control points', () => {
    const r = validateLevel(withPoints(straightPoints.slice(0, 3)));
    expect(r.ok).toBe(false);
    expect(r.errors.length).toBeGreaterThan(0);
    expect(r.errors.every((e) => e.rule === 1)).toBe(true);
  });

  it('rejects consecutive points closer than 2 m', () => {
    const pts: Vec3[] = [
      [0, 0, 0],
      [0, 0, 1],
      [0, 0, 40],
      [0, 0, 80],
      [0, 0, 120],
    ];
    const r = validateLevel(withPoints(pts));
    expect(r.ok).toBe(false);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]?.rule).toBe(1);
    expect(r.errors[0]?.message).toMatch(/apart/);
  });

  it('rejects coincident points without throwing', () => {
    const pts: Vec3[] = [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 40],
      [0, 0, 100],
    ];
    const r = validateLevel(withPoints(pts));
    expect(r.ok).toBe(false);
    expect(r.errors[0]?.rule).toBe(1);
  });

  it('rejects a track shorter than 80 m', () => {
    const r = validateLevel(withPoints(straightPoints)); // 40 m
    expect(r.ok).toBe(false);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toMatchObject({ rule: 1 });
    expect(r.errors[0]?.message).toMatch(/arc length/);
  });

  it('rejects a track longer than 120 m', () => {
    const pts: Vec3[] = [0, 1, 2, 3, 4].map((i) => [0, 0, i * 35] as Vec3); // 140 m
    const r = validateLevel(withPoints(pts));
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatchObject({ rule: 1 });
  });

  it('accepts the boundary lengths', () => {
    // Plain levels also pass rules 2-7, so only rule 1 is in play at the edges.
    for (const len of [80.5, 119.5]) {
      expect(validateLevel(plainLevel(len))).toEqual({ ok: true, errors: [] });
    }
  });
});

describe('registry', () => {
  it('is ordered (the six shipped levels, then levelTest), unique and contains levelTest', () => {
    // Phase 3 put levelTest after the shipped levels; it was levels[0] while it was the only one.
    expect(levels.at(-1)).toBe(levelTest);
    expect(new Set(levels.map((l) => l.id)).size).toBe(levels.length);
    expect(getLevel('levelTest')).toBe(levelTest);
    expect(getLevel('nope')).toBeUndefined();
  });

  it('every registered level passes validateLevel', () => {
    for (const l of levels) expect(validateLevel(l).ok).toBe(true);
  });
});
