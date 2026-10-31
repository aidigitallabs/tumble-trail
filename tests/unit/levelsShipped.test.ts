import RAPIER from '@dimforge/rapier3d-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import { tuning } from '../../src/config/tuning';
import { GameWorld } from '../../src/game/GameWorld';
import { buildSpline, frameSlopeDeg, turningRadii, type Frame } from '../../src/game/Spline';
import {
  getLevel,
  level01,
  level02,
  level03,
  level04,
  level05,
  level06,
  levels,
  levelTest,
  shippedLevels,
  testLevels,
} from '../../src/levels';
import {
  arc,
  buildPath,
  heightAt,
  ramp,
  routeLength,
  straight,
  toLength,
} from '../../src/levels/path';
import { levelWidth, validateLevel, type LevelDef, type Tier } from '../../src/levels/schema';

beforeAll(async () => {
  await RAPIER.init();
});

const TIERS: readonly Tier[] = ['tiny', 'bigkid'];
const IDLE = { driving: false, steer: 0 } as const;

interface Metrics {
  lengthM: number;
  maxSlopeDeg: number;
  minRadiusM: number;
  frames: Frame[];
  radii: number[];
  finishM: number;
}

function metrics(level: LevelDef): Metrics {
  const sp = buildSpline(level.points);
  const radii = turningRadii(sp.frames);
  const last = Math.floor(sp.finishM / sp.ds);
  let maxSlopeDeg = 0;
  let minRadiusM = Infinity;
  for (let i = 0; i <= last; i++) {
    maxSlopeDeg = Math.max(maxSlopeDeg, Math.abs(frameSlopeDeg(sp.frames[i] as Frame)));
    minRadiusM = Math.min(minRadiusM, radii[i] as number);
  }
  return {
    lengthM: sp.finishM,
    maxSlopeDeg,
    minRadiusM,
    frames: sp.frames,
    radii,
    finishM: sp.finishM,
  };
}

const M = new Map(shippedLevels.map((l) => [l.id, metrics(l)] as const));
const m = (l: LevelDef): Metrics => M.get(l.id) as Metrics;
const frameAt = (l: LevelDef, s: number): Frame => m(l).frames[Math.round(s / 0.5)] as Frame;
const ofKind = (l: LevelDef, kind: string, tier: Tier): LevelDef['obstacles'] =>
  l.obstacles.filter((o) => o.kind === kind && o.tiers.includes(tier));

describe('registry', () => {
  it('lists the six shipped levels in order, then the test course', () => {
    expect(shippedLevels.map((l) => l.id)).toEqual([
      'level01',
      'level02',
      'level03',
      'level04',
      'level05',
      'level06',
    ]);
    expect(testLevels).toEqual([levelTest]);
    expect(levels.map((l) => l.id)).toEqual([...shippedLevels.map((l) => l.id), 'levelTest']);
    for (const l of levels) expect(getLevel(l.id)).toBe(l);
    expect(getLevel('nope')).toBeUndefined();
  });

  it('matches the Appendix B names and palettes', () => {
    expect(shippedLevels.map((l) => [l.name, l.palette])).toEqual([
      ['Meadow Roll', 'meadow'],
      ['Little Hills', 'meadow'],
      ['Seaside Sweep', 'beach'],
      ['Up in the Clouds', 'sky'],
      ['Zigzag Beach', 'beach'],
      ['Big Sky Finale', 'sky'],
    ]);
  });
});

describe.each(shippedLevels.map((l) => [l.id, l] as const))('%s', (_id, level) => {
  it('passes validateLevel', () => {
    const r = validateLevel(level);
    if (!r.ok)
      console.log(`${level.id}: ${r.errors.map((e) => `rule ${e.rule}: ${e.message}`).join('\n')}`);
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it('is 80-120 m long, with a start pad, checkpoints and a finish', () => {
    expect(m(level).lengthM).toBeGreaterThanOrEqual(80);
    expect(m(level).lengthM).toBeLessThanOrEqual(120);
    expect(level.checkpointsM.length).toBeGreaterThanOrEqual(3);
    expect(level.points[0]).toEqual([0, 0, 0]);
  });

  it('keeps Tiny to bumps and balloons, with a balloon at least every 25 m', () => {
    for (const o of level.obstacles.filter((x) => x.tiers.includes('tiny'))) {
      expect(['bump', 'balloon']).toContain(o.kind);
    }
    const marks = [
      0,
      ...ofKind(level, 'balloon', 'tiny')
        .map((o) => o.atM)
        .sort((a, b) => a - b),
      m(level).finishM,
    ];
    for (let i = 1; i < marks.length; i++)
      expect(marks[i]! - marks[i - 1]!).toBeLessThanOrEqual(25);
  });

  it('also has balloons in Big kid, and never a bump on or soon after a descent', () => {
    expect(ofKind(level, 'balloon', 'bigkid').length).toBeGreaterThanOrEqual(3);
    for (const b of level.obstacles.filter((o) => o.kind === 'bump')) {
      // Flat under the bump, and no descent steeper than 2 degrees in the 12 m before it.
      for (let s = b.atM - 12; s <= b.atM + 1; s += 0.5) {
        if (s < 0) continue;
        expect(
          frameSlopeDeg(frameAt(level, s)),
          `${level.id} bump ${b.atM} at ${s}`,
        ).toBeGreaterThan(-2);
      }
      expect(Math.abs(frameSlopeDeg(frameAt(level, b.atM)))).toBeLessThan(2);
    }
  });

  it('keeps 8 m of flat track after every gate (the 6 m banner and the camera)', () => {
    for (const g of level.obstacles.filter((o) => o.kind === 'gate')) {
      const y0 = frameAt(level, g.atM).pos.y;
      for (let s = g.atM; s <= g.atM + 8; s += 0.5) {
        const f = frameAt(level, s);
        expect(f.pos.y - y0, `${level.id} gate ${g.atM} at ${s}`).toBeLessThan(0.05);
        expect(Math.abs(frameSlopeDeg(f))).toBeLessThan(1);
      }
    }
  });

  for (const tier of TIERS) {
    it(`${tier}: the autopilot finishes without a respawn, at bump speeds Tiny can take`, () => {
      const w = new GameWorld(level, tier);
      w.autopilot = true;
      const bumps = ofKind(level, 'bump', tier).map((o) => o.atM);
      const seen = new Set<number>();
      let steps = 0;
      let worstBump = 0;
      while (w.state === 'playing' && steps < 150 * tuning.physicsHz) {
        w.step(IDLE);
        steps++;
        for (const b of bumps) {
          if (!seen.has(b) && w.progress.arcM >= b) {
            seen.add(b);
            worstBump = Math.max(worstBump, w.ball.speed());
          }
        }
      }
      expect(w.state).toBe('finished');
      expect(w.respawnCount).toBe(0);
      expect(w.progress.checkpointsPassed).toBe(level.checkpointsM.length);
      if (tier === 'tiny') expect(worstBump).toBeLessThanOrEqual(4.5);
      else {
        expect(steps / tuning.physicsHz).toBeGreaterThanOrEqual(tuning.bigkidLevelSeconds[0]);
        expect(steps / tuning.physicsHz).toBeLessThanOrEqual(tuning.bigkidLevelSeconds[1]);
      }
      console.log(
        `${level.id} ${tier}: ${(steps / tuning.physicsHz).toFixed(1)} s, ${w.respawnCount} respawns, ` +
          `bump speed ${bumps.length ? worstBump.toFixed(2) : '-'} m/s, balloons ${w.balloonsPopped}/${w.balloons.length}`,
      );
      w.dispose();
    });
  }
});

describe('arc lengths, slopes and radii (recorded)', () => {
  it('table', () => {
    const rows = shippedLevels.map((l) => {
      const x = m(l);
      return {
        id: l.id,
        lengthM: +x.lengthM.toFixed(1),
        maxSlopeDeg: +x.maxSlopeDeg.toFixed(1),
        minRadiusM: +x.minRadiusM.toFixed(1),
      };
    });
    console.log(
      `level length slope radius\n${rows.map((r) => `${r.id} ${r.lengthM} m ${r.maxSlopeDeg} deg ${r.minRadiusM} m`).join('\n')}`,
    );
    for (const r of rows) {
      expect(r.lengthM).toBeGreaterThanOrEqual(80);
      expect(r.lengthM).toBeLessThanOrEqual(120);
      expect(r.maxSlopeDeg).toBeLessThanOrEqual(tuning.validation.maxSlopeDeg);
    }
    // Brief lengths (Appendix B), within a metre or two.
    const len = (l: LevelDef): number => m(l).lengthM;
    expect(len(level01)).toBeGreaterThan(80);
    expect(len(level01)).toBeLessThan(86);
    expect(len(level02)).toBeCloseTo(90, -0.5);
    expect(len(level03)).toBeCloseTo(100, -0.5);
    expect(len(level04)).toBeCloseTo(100, -0.5);
    expect(len(level05)).toBeCloseTo(110, -0.5);
    expect(len(level06)).toBeGreaterThan(112);
    expect(len(level06)).toBeLessThanOrEqual(120);
  });

  it('every turn is wide enough for the wider track and, where posts stand, above rule 5 limit', () => {
    for (const l of shippedLevels) {
      for (const tier of TIERS) {
        expect(m(l).minRadiusM).toBeGreaterThanOrEqual(levelWidth(l, tier));
      }
    }
    expect(m(level03).minRadiusM).toBeGreaterThanOrEqual(12);
    expect(m(level05).minRadiusM).toBeGreaterThanOrEqual(12);
  });
});

describe('Appendix B briefs', () => {
  const heading = (l: LevelDef, s: number): number => {
    const t = frameAt(l, s).tangent;
    return (Math.atan2(-t.x, t.z) * 180) / Math.PI; // positive = turned right
  };

  it('1 Meadow Roll: flat, straight, S-bend, straight; Tiny has only balloons; Big kid one pillar at +0.9', () => {
    expect(m(level01).maxSlopeDeg).toBeLessThan(0.01);
    expect(heading(level01, 10)).toBeCloseTo(0, 1);
    expect(Math.abs(heading(level01, 40))).toBeGreaterThan(30); // inside the S
    expect(heading(level01, 70)).toBeCloseTo(0, 1);
    expect(
      level01.obstacles.filter((o) => o.tiers.includes('tiny')).every((o) => o.kind === 'balloon'),
    ).toBe(true);
    expect(ofKind(level01, 'pillar', 'bigkid')).toEqual([
      { atM: 69, offset: 0.9, kind: 'pillar', tiers: ['bigkid'] },
    ]);
    expect(level01.noWallSpansM).toBeUndefined();
  });

  it('2 Little Hills: two humps of at most 12 degrees with a curve between; 2 centred Tiny bumps; 2 alternating pillars', () => {
    const lo = m(level02);
    expect(lo.maxSlopeDeg).toBeLessThanOrEqual(12);
    expect(lo.maxSlopeDeg).toBeGreaterThan(5);
    const crests = [21, 69].map((s) => frameAt(level02, s).pos.y);
    for (const y of crests) expect(y).toBeGreaterThan(0.9);
    expect(frameAt(level02, 45).pos.y).toBeCloseTo(0, 1); // flat between
    expect(Math.abs(heading(level02, 55))).toBeGreaterThan(40); // the curve between
    expect(ofKind(level02, 'bump', 'tiny').map((o) => o.offset)).toEqual([0, 0]);
    const pillars = ofKind(level02, 'pillar', 'bigkid').map((o) => o.offset);
    expect(pillars).toHaveLength(2);
    expect(Math.abs(pillars[0] as number)).toBe(0.9);
    expect(pillars[0]).toBe(-(pillars[1] as number));
  });

  it('3 Seaside Sweep: a 150 degree sweep (radius >= 13) then a straight; most Tiny balloons in the curve; one gate; no kerb on the final straight', () => {
    expect(Math.abs(heading(level03, 80) - heading(level03, 10))).toBeGreaterThan(148);
    expect(Math.abs(heading(level03, 80) - heading(level03, 10))).toBeLessThan(152);
    const { frames, radii } = m(level03);
    const sweepRadii = frames
      .map((f, i) => [f.arcM, radii[i] as number] as const)
      .filter(([s]) => s > 21 && s < 55);
    expect(Math.min(...sweepRadii.map(([, r]) => r))).toBeGreaterThanOrEqual(13);
    const inCurve = ofKind(level03, 'balloon', 'tiny').filter((o) => o.atM > 18 && o.atM < 58);
    expect(inCurve.length).toBeGreaterThanOrEqual(6);
    expect(inCurve.length).toBeGreaterThan(ofKind(level03, 'balloon', 'tiny').length / 2);
    expect(ofKind(level03, 'gate', 'bigkid')).toHaveLength(1);
    expect(level03.noWallSpansM).toBeDefined();
    const gate = ofKind(level03, 'gate', 'bigkid')[0]!;
    const [lo, hi] = (level03.noWallSpansM as Array<[number, number]>)[0] as [number, number];
    expect(gate.atM).toBeGreaterThan(lo);
    expect(gate.atM).toBeLessThan(hi);
  });

  it('4 Up in the Clouds: ramp up about 15, plateau with a wiggle, ramp down; gate on the plateau; pillar 10 m after the descent', () => {
    const slopes = m(level04)
      .frames.slice(0, Math.floor(m(level04).finishM / 0.5))
      .map(frameSlopeDeg);
    expect(Math.max(...slopes)).toBeGreaterThan(14);
    expect(Math.max(...slopes)).toBeLessThan(17);
    expect(Math.min(...slopes)).toBeLessThan(-14);
    expect(Math.min(...slopes)).toBeGreaterThan(-17);
    const top = frameAt(level04, 45).pos.y;
    expect(top).toBeGreaterThan(3.4);
    for (let s = 30; s <= 66; s += 1) expect(frameAt(level04, s).pos.y).toBeCloseTo(top, 1);
    expect(Math.abs(heading(level04, 41))).toBeGreaterThan(10); // the wiggle
    const gate = ofKind(level04, 'gate', 'bigkid')[0]!;
    expect(gate.atM).toBeGreaterThan(30);
    expect(gate.atM).toBeLessThan(66);
    const pillar = ofKind(level04, 'pillar', 'bigkid')[0]!;
    expect(pillar.atM - 82).toBeGreaterThanOrEqual(10);
    expect(
      ofKind(level04, 'balloon', 'tiny').filter((o) => o.atM > 28 && o.atM < 66).length,
    ).toBeGreaterThanOrEqual(4);
  });

  it('5 Zigzag Beach: three alternating 70 degree turns (radius >= 13); pillars on the outside of each turn', () => {
    const h = (s: number): number => heading(level05, s);
    expect(h(8)).toBeCloseTo(0, 1);
    expect(h(38.3)).toBeCloseTo(70, 0);
    expect(h(71.6)).toBeCloseTo(0, 0);
    expect(h(104)).toBeCloseTo(70, 0);
    const { frames, radii } = m(level05);
    const turning = frames
      .map((f, i) => [f.arcM, radii[i] as number] as const)
      .filter(([, r]) => r < 100);
    expect(Math.min(...turning.map(([, r]) => r))).toBeGreaterThanOrEqual(13);
    // Pillar on the outside: right turn (heading increasing) -> negative offset.
    const pillars = ofKind(level05, 'pillar', 'bigkid');
    expect(pillars).toHaveLength(3);
    for (const p of pillars) {
      const turn = h(p.atM + 2) - h(p.atM - 2);
      expect(Math.sign(p.offset)).toBe(-Math.sign(turn));
      expect(Math.abs(p.offset)).toBe(0.9);
    }
    // Tiny bumps stand on straights.
    const bumps = ofKind(level05, 'bump', 'tiny');
    expect(bumps.length).toBeGreaterThanOrEqual(3);
    for (const b of bumps) expect(Math.abs(h(b.atM + 2) - h(b.atM - 2))).toBeLessThan(0.5);
  });

  it('6 Big Sky Finale: S-bend, hump, sweep, long gentle downhill; Big kid 1 gate, 3 pillars, no kerb-free spans', () => {
    expect(level06.noWallSpansM ?? []).toEqual([]);
    expect(ofKind(level06, 'gate', 'bigkid')).toHaveLength(1);
    expect(ofKind(level06, 'pillar', 'bigkid')).toHaveLength(3);
    expect(Math.max(...[20, 24, 28].map((s) => Math.abs(heading(level06, s))))).toBeGreaterThan(10);
    expect(frameAt(level06, 49).pos.y).toBeGreaterThan(1.1); // the hump
    expect(frameAt(level06, 61).pos.y).toBeCloseTo(0, 1);
    expect(Math.abs(heading(level06, 92) - heading(level06, 40))).toBeGreaterThan(85); // the sweep
    const end = m(level06).finishM;
    expect(frameAt(level06, end - 1).pos.y).toBeLessThan(-2.5); // the downhill
    for (let s = 92; s < end - 1; s += 1) {
      const d = frameSlopeDeg(frameAt(level06, s));
      expect(d).toBeLessThan(0.5);
      expect(d).toBeGreaterThan(-8);
    }
    // Everything for Tiny: both bumps and plenty of balloons.
    expect(ofKind(level06, 'bump', 'tiny').length).toBeGreaterThanOrEqual(2);
    expect(ofKind(level06, 'balloon', 'tiny').length).toBeGreaterThanOrEqual(12);
    // Posts and bumps all stand before the downhill.
    for (const o of level06.obstacles.filter((x) => x.kind !== 'balloon'))
      expect(o.atM).toBeLessThan(88);
  });
});

describe('path builder (src/levels/path.ts)', () => {
  it("a straight heads +Z; a right turn bends towards -X (the viewer's right)", () => {
    const pts = buildPath([straight(10), arc(90, 10, 0.001)]);
    expect(pts[0]).toEqual([0, 0, 0]);
    const first = pts[4] as number[];
    expect(first[0]).toBeCloseTo(0, 6);
    expect(first[2]).toBeCloseTo(10, 6);
    const end = pts[pts.length - 1] as number[];
    expect(end[0]).toBeLessThan(-9);
    expect(end[2]).toBeGreaterThan(19);
  });

  it('arcs end at the requested heading and the route has the requested length', () => {
    const segs = toLength(60, [straight(10), arc(-70, 14), arc(70, 14)]);
    expect(routeLength(segs)).toBeCloseTo(60, 9);
    const pts = buildPath(segs);
    const sp = buildSpline(pts);
    expect(sp.finishM).toBeGreaterThan(59.9);
    expect(sp.finishM).toBeLessThan(60.1);
    const t = (sp.frames[Math.floor(55 / 0.5)] as Frame).tangent;
    expect(t.x).toBeCloseTo(0, 2); // heading is back to +Z after turning left then right
  });

  it('keeps control points at least 2 m apart and refuses a route that is too long', () => {
    const pts = buildPath([straight(20), arc(150, 14), arc(-150, 14), straight(10)]);
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1] as number[];
      const b = pts[i] as number[];
      expect(Math.hypot(b[0]! - a[0]!, b[1]! - a[1]!, b[2]! - a[2]!)).toBeGreaterThanOrEqual(2);
    }
    expect(() => toLength(10, [straight(20)])).toThrow();
  });

  it('ramps rise by exactly riseM, with a steepest slope of riseM / (length - ease)', () => {
    const ramps = [ramp(10, 28, 3.6), ramp(40, 58, -3.6)];
    expect(heightAt(ramps, 5)).toBe(0);
    expect(heightAt(ramps, 28)).toBeCloseTo(3.6, 9);
    expect(heightAt(ramps, 35)).toBeCloseTo(3.6, 9);
    expect(heightAt(ramps, 58)).toBeCloseTo(0, 9);
    let steepest = 0;
    for (let s = 10; s < 28; s += 0.01)
      steepest = Math.max(steepest, heightAt(ramps, s + 0.01) - heightAt(ramps, s));
    expect(steepest / 0.01).toBeCloseTo(3.6 / 15, 3);
    // monotone on the way up
    for (let s = 10; s < 28; s += 0.5)
      expect(heightAt(ramps, s + 0.5)).toBeGreaterThan(heightAt(ramps, s));
  });
});
