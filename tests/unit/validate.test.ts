import { describe, expect, it } from 'vitest';
import { tuning } from '../../src/config/tuning';
import { buildSpline } from '../../src/game/Spline';
import { levels, levelTest } from '../../src/levels';
import { validateLevel, type LevelDef, type Vec3 } from '../../src/levels/schema';
import { plainLevel, scaffold } from './fixtures';

/** The sorted, distinct rule numbers that failed. */
const rulesOf = (level: LevelDef): number[] => [
  ...new Set(validateLevel(level).errors.map((e) => e.rule)),
];
const fails = (level: LevelDef, rule: number): boolean => rulesOf(level).includes(rule);
const messages = (level: LevelDef, rule: number): string[] =>
  validateLevel(level)
    .errors.filter((e) => e.rule === rule)
    .map((e) => e.message);

const both: Array<'tiny' | 'bigkid'> = ['tiny', 'bigkid'];

/** levelTest with extra / replaced obstacles. */
const withObstacles = (obstacles: LevelDef['obstacles']): LevelDef => ({
  ...levelTest,
  id: 'crafted',
  obstacles,
});

describe('the shipped levels pass (PLAN section 13)', () => {
  it('levelTest and the plain fixture are valid', () => {
    expect(validateLevel(levelTest)).toEqual({ ok: true, errors: [] });
    expect(validateLevel(plainLevel(100))).toEqual({ ok: true, errors: [] });
  });

  it('every registered level is valid', () => {
    for (const l of levels) expect(validateLevel(l)).toEqual({ ok: true, errors: [] });
  });

  it('levelTest exercises every obstacle kind, with Big-kid-only pillars and a gate', () => {
    const kinds = new Set(levelTest.obstacles.map((o) => o.kind));
    expect(kinds).toEqual(new Set(['bump', 'pillar', 'gate', 'balloon']));
    for (const o of levelTest.obstacles) {
      if (o.kind === 'pillar' || o.kind === 'gate') expect(o.tiers).toEqual(['bigkid']);
    }
  });

  it('returns { ok, errors: [{ rule, message }] }', () => {
    const r = validateLevel({ ...plainLevel(), checkpointsM: [] });
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toEqual({ rule: 4, message: expect.any(String) });
  });
});

describe('rule 1: points, spacing and length (precondition for the rest)', () => {
  it('reports only rule 1 when the points are unusable', () => {
    const r = validateLevel({ ...plainLevel(), points: plainLevel().points.slice(0, 3) });
    expect(r.ok).toBe(false);
    expect(new Set(r.errors.map((e) => e.rule))).toEqual(new Set([1]));
  });
});

describe('rule 2: slope <= 20 degrees', () => {
  // 25 m flat, 25 m flat, then a climb of 14 m over ~29 m (about 26 degrees), then flat.
  const steep: Vec3[] = [
    [0, 0, 0],
    [0, 0, 25],
    [0, 0, 50],
    [0, 14, 75],
    [0, 14, 100],
  ];

  it('fails a ramp steeper than 20 degrees, naming where', () => {
    const level = scaffold(steep);
    expect(rulesOf(level)).toEqual([2]);
    expect(messages(level, 2)[0]).toMatch(/degrees at \d/);
  });

  it('passes the 15 degree ramps of levelTest (max 15.5)', () => {
    expect(rulesOf(levelTest)).toEqual([]);
  });

  it('is exactly the tuning limit', () => {
    expect(tuning.validation.maxSlopeDeg).toBe(20);
  });
});

describe('rule 3: turning radius >= tier width, no ribbon self-intersection', () => {
  /** Straight in, a semicircle of radius R (turning right), straight back out. */
  function uTurn(radius: number, lead: number, stepDeg = 30): Vec3[] {
    const pts: Vec3[] = [
      [0, 0, 0],
      [0, 0, lead / 2],
      [0, 0, lead],
    ];
    for (let deg = stepDeg; deg < 180; deg += stepDeg) {
      const a = (deg * Math.PI) / 180;
      pts.push([radius - radius * Math.cos(a), 0, lead + radius * Math.sin(a)]);
    }
    pts.push([2 * radius, 0, lead], [2 * radius, 0, lead / 2], [2 * radius, 0, 0]);
    return pts;
  }

  it('a 5 m radius fails Tiny (width 6) but not Big kid (width 3.5)', () => {
    const level = scaffold(uTurn(5, 35));
    expect(rulesOf(level)).toEqual([3]);
    const msgs = messages(level, 3);
    expect(msgs.some((m) => m.startsWith('tiny: turning radius'))).toBe(true);
    expect(msgs.some((m) => m.startsWith('bigkid'))).toBe(false);
  });

  it('a 2 m radius fails both tiers', () => {
    const level = scaffold(uTurn(2.4, 40, 60));
    const msgs = messages(level, 3);
    expect(msgs.some((m) => m.startsWith('tiny: turning radius'))).toBe(true);
    expect(msgs.some((m) => m.startsWith('bigkid: turning radius'))).toBe(true);
  });

  it('a 10 m radius is fine for both', () => {
    expect(rulesOf(scaffold(uTurn(10, 30)))).toEqual([]);
  });

  it('a width override changes what the radius is compared with', () => {
    const level = { ...scaffold(uTurn(5, 35)), width: { tiny: 4 } };
    expect(rulesOf(level)).toEqual([]);
  });

  it('a track that comes back and overlaps its own start fails for both tiers', () => {
    // A 350 degree circle of radius 14 m: no tight bend, but the end lies on top of the start.
    const loop: Vec3[] = [];
    for (let deg = 0; deg <= 350; deg += 20) {
      const a = (deg * Math.PI) / 180;
      loop.push([14 * Math.sin(a), 0, 14 - 14 * Math.cos(a)]);
    }
    loop.push([14 * Math.sin((350 * Math.PI) / 180), 0, 14 - 14 * Math.cos((350 * Math.PI) / 180)]);
    loop.pop();
    const level = scaffold(loop);
    expect(buildSpline(loop).finishM).toBeGreaterThan(80);
    expect(rulesOf(level)).toEqual([3]);
    const msgs = messages(level, 3);
    expect(msgs.filter((m) => /intersects itself/.test(m))).toHaveLength(2);
    expect(msgs.some((m) => /turning radius/.test(m))).toBe(false);
  });

  it('a hairpin with legs 4 m apart fails (radius and intersection)', () => {
    const level = scaffold(uTurn(2, 45, 90));
    expect(validateLevel(level).errors.filter((e) => e.rule === 1)).toEqual([]);
    expect(fails(level, 3)).toBe(true);
    expect(messages(level, 3).some((m) => /intersects itself/.test(m))).toBe(true);
  });
});

describe('rule 4: checkpoints', () => {
  const base = plainLevel(100);
  const withCps = (checkpointsM: number[]): LevelDef => ({ ...base, checkpointsM });

  it('needs at least one', () => {
    expect(fails(withCps([]), 4)).toBe(true);
  });

  it('the first must be >= 10 m, the last <= finishM - 10', () => {
    expect(fails(withCps([9, 30, 60, 90]), 4)).toBe(true);
    expect(messages(withCps([9, 30, 60, 90]), 4)[0]).toMatch(/first checkpoint/);
    const finishM = buildSpline(base.points).finishM;
    const late = withCps([20, 45, 70, finishM - 9]);
    expect(messages(late, 4).some((m) => /last checkpoint/.test(m))).toBe(true);
    expect(fails(withCps([10, 40, 70, finishM - 10]), 4)).toBe(false);
  });

  it('every stretch is <= 30 m, including start->first and last->finish', () => {
    expect(fails(withCps([35, 60, 85]), 4)).toBe(true); // start -> first = 35
    expect(fails(withCps([20, 55, 85]), 4)).toBe(true); // 20 -> 55 = 35
    expect(fails(withCps([30, 60, 89]), 4)).toBe(false); // 30, 30, 29, ~11: all fine
    expect(fails(withCps([30, 60]), 4)).toBe(true); // 60 -> finish = 40
    // A last -> finish stretch just over 30 m (finishM is ~100): 69 -> 100 = 31
    const finishM = buildSpline(base.points).finishM;
    expect(fails(withCps([20, 40, finishM - 31]), 4)).toBe(true);
    expect(fails(withCps([20, 40, finishM - 29.9]), 4)).toBe(true); // too late for the 10 m rule
    expect(fails(withCps([20, 45, finishM - 30]), 4)).toBe(false); // exactly 30 is fine
  });

  it('must be ascending', () => {
    expect(fails(withCps([20, 50, 40, 80]), 4)).toBe(true);
  });
});

describe('rule 5: obstacles', () => {
  const ob = (
    kind: LevelDef['obstacles'][number]['kind'],
    atM: number,
    offset: number,
    tiers: Array<'tiny' | 'bigkid'> = both,
  ): LevelDef['obstacles'][number] => ({ kind, atM, offset, tiers });
  /** levelTest's balloons keep rule 7 satisfied. */
  const balloons = levelTest.obstacles.filter((o) => o.kind === 'balloon');
  const level = (...extra: LevelDef['obstacles']): LevelDef =>
    withObstacles([...balloons, ...extra]);

  it('must lie inside [5, finishM - 8]', () => {
    expect(rulesOf(level(ob('bump', 4.9, 0)))).toEqual([5]);
    const finishM = buildSpline(levelTest.points).finishM;
    expect(rulesOf(level(ob('bump', finishM - 7.9, 0)))).toEqual([5]);
    expect(rulesOf(level(ob('bump', 5, 0), ob('bump', finishM - 8, 0)))).toEqual([]);
  });

  it('must keep 3 m from every checkpoint', () => {
    expect(rulesOf(level(ob('bump', 27.9, 0)))).toEqual([5]); // checkpoint at 25
    expect(rulesOf(level(ob('bump', 22.1, 0)))).toEqual([5]);
    expect(rulesOf(level(ob('bump', 28, 0), ob('bump', 22, 0)))).toEqual([]);
  });

  it('Tiny may only contain bumps and balloons', () => {
    expect(rulesOf(level(ob('pillar', 8, 0.9, both)))).toEqual([5]);
    expect(rulesOf(level(ob('gate', 46, 0, ['tiny'])))).toEqual([5]);
    expect(rulesOf(level(ob('pillar', 8, 0.9, ['bigkid'])))).toEqual([]);
    expect(rulesOf(level(ob('bump', 8, 0.4, ['tiny'])))).toEqual([]);
  });

  it('a pillar needs 0.6 <= |offset| <= width/2 - 0.2 for each tier it applies to', () => {
    // Big kid, width 3.5: 0.6 .. 1.55
    expect(rulesOf(level(ob('pillar', 8, 0.5, ['bigkid'])))).toEqual([5]);
    expect(rulesOf(level(ob('pillar', 8, 0, ['bigkid'])))).toEqual([5]);
    expect(rulesOf(level(ob('pillar', 8, 1.6, ['bigkid'])))).toEqual([5]);
    expect(rulesOf(level(ob('pillar', 8, -1.7, ['bigkid'])))).toEqual([5]);
    expect(rulesOf(level(ob('pillar', 8, 0.6, ['bigkid'])))).toEqual([]);
    expect(rulesOf(level(ob('pillar', 8, 1.55, ['bigkid'])))).toEqual([]);
    expect(rulesOf(level(ob('pillar', 8, -1.55, ['bigkid'])))).toEqual([]);
    // The width is per tier and overridable: a 6 m Big kid track allows offset 2.5.
    expect(rulesOf({ ...level(ob('pillar', 8, 2.5, ['bigkid'])), width: { bigkid: 6 } })).toEqual(
      [],
    );
  });

  it('a gate needs |offset| + 1.5 <= width/2 (only offset ~0 on 3.5 m)', () => {
    expect(rulesOf(level(ob('gate', 46, 0, ['bigkid'])))).toEqual([]);
    expect(rulesOf(level(ob('gate', 46, 0.25, ['bigkid'])))).toEqual([]);
    expect(rulesOf(level(ob('gate', 46, 0.3, ['bigkid'])))).toEqual([5]);
    expect(rulesOf(level(ob('gate', 46, -0.5, ['bigkid'])))).toEqual([5]);
    expect(rulesOf({ ...level(ob('gate', 46, 1, ['bigkid'])), width: { bigkid: 6 } })).toEqual([]);
  });

  it('pillars and gates keep off slopes steeper than 8 degrees', () => {
    // 56 m is on the 15 degree ramp; 8 m is flat.
    expect(rulesOf(level(ob('pillar', 56, 0.9, ['bigkid'])))).toEqual([5]);
    expect(messages(level(ob('gate', 56, 0, ['bigkid'])), 5)[0]).toMatch(/slope/);
    expect(rulesOf(level(ob('pillar', 8, 0.9, ['bigkid'])))).toEqual([]);
    // Bumps and balloons do not care.
    expect(rulesOf(level(ob('bump', 56, 0)))).toEqual([]);
  });

  it('pillars and gates keep 4 m from bends tighter than 12 m', () => {
    // The S-bend (about 15 - 43 m) has radii of 8 - 12 m.
    expect(rulesOf(level(ob('pillar', 24, 0.9, ['bigkid'])))).toEqual([5]);
    expect(messages(level(ob('gate', 30, 0, ['bigkid'])), 5)[0]).toMatch(/bend tighter/);
    expect(rulesOf(level(ob('pillar', 8, 0.9, ['bigkid'])))).toEqual([]);
    expect(rulesOf(level(ob('bump', 21, 0)))).toEqual([]);
  });

  it('bumps and balloons must fit inside the track', () => {
    // Big kid width 3.5: a bump spans 1.17 m, so |offset| <= 1.17.
    expect(rulesOf(level(ob('bump', 8, 1.3, ['bigkid'])))).toEqual([5]);
    expect(rulesOf(level(ob('bump', 8, 1.1, ['bigkid'])))).toEqual([]);
    expect(rulesOf(level(ob('balloon', 8, 1.4, ['bigkid'])))).toEqual([5]);
    expect(rulesOf(level(ob('balloon', 8, 1.2, ['bigkid'])))).toEqual([]);
  });

  it('an obstacle that applies to no tier is an error', () => {
    expect(rulesOf(level(ob('bump', 8, 0, [])))).toEqual([5]);
  });
});

describe('rule 6: noWallSpansM only on gentle straights (radius > 30 m)', () => {
  it('rejects a span through the S-bend', () => {
    const level = { ...levelTest, noWallSpansM: [[20, 30]] as Array<[number, number]> };
    expect(rulesOf(level)).toEqual([6]);
    expect(messages(level, 6)[0]).toMatch(/bend of radius/);
  });

  it('accepts a span on the opening straight, and on the plain straight', () => {
    expect(rulesOf({ ...levelTest, noWallSpansM: [[2, 10]] })).toEqual([]);
    expect(rulesOf({ ...plainLevel(), noWallSpansM: [[30, 90]] })).toEqual([]);
  });

  it('rejects spans that are empty, reversed or outside the track', () => {
    for (const span of [
      [10, 10],
      [30, 20],
      [-1, 5],
      [90, 130],
    ] as Array<[number, number]>) {
      expect(rulesOf({ ...plainLevel(), noWallSpansM: [span] })).toEqual([6]);
    }
  });
});

describe('rule 7: Tiny balloons, no stretch over 25 m (start and finish included)', () => {
  const at = (...ms: number[]): LevelDef['obstacles'] =>
    ms.map((atM) => ({ atM, offset: 0, kind: 'balloon', tiers: ['tiny', 'bigkid'] }));
  const base: LevelDef = { ...plainLevel(100), checkpointsM: [22, 47, 72] };
  const finishM = buildSpline(base.points).finishM;

  it('fails with none, and with a gap in the middle', () => {
    expect(rulesOf({ ...base, obstacles: [] })).toEqual([7]);
    expect(rulesOf({ ...base, obstacles: at(10, 40) })).toEqual([7]); // 40 -> finish = 60
    expect(messages({ ...base, obstacles: at(10, 18, 60, 85) }, 7)[0]).toMatch(/between 18/);
  });

  it('the ends count: start -> first and last -> finish', () => {
    expect(rulesOf({ ...base, obstacles: at(26.5, 52, 80) })).toEqual([7]); // 0 -> 26.5
    expect(rulesOf({ ...base, obstacles: at(10, 35, 60) })).toEqual([7]); // 60 -> ~100
    expect(rulesOf({ ...base, obstacles: at(10, 34, 58, 82, finishM - 8) })).toEqual([]);
  });

  it('exactly 25 m is allowed', () => {
    expect(rulesOf({ ...base, obstacles: at(25, 50, 75) })).toEqual([]); // last -> finish = 24.6
    expect(rulesOf({ ...base, obstacles: at(25.1, 50, 75) })).toEqual([7]);
  });

  it('balloons that exist only in Big kid do not count', () => {
    const bigOnly = at(10, 30, 55, 80).map((o) => ({ ...o, tiers: ['bigkid' as const] }));
    expect(rulesOf({ ...base, obstacles: bigOnly })).toEqual([7]);
  });

  it('the limit is 25 m', () => {
    expect(tuning.validation.tinyMaxBalloonGapM).toBe(25);
  });
});
