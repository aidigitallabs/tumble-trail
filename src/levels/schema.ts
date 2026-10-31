import { tuning } from '../config/tuning';
import { buildSpline, frameSlopeDeg, turningRadii, type Frame } from '../game/Spline';

export type Vec3 = [number, number, number];
export type Tier = 'tiny' | 'bigkid';

export interface LevelDef {
  id: string; // 'level01'
  name: string; // decorative
  palette: 'meadow' | 'beach' | 'sky';
  points: Vec3[]; // centripetal Catmull-Rom control points, metres. points[0] = start.
  width?: { tiny?: number; bigkid?: number }; // defaults from tuning
  walls?: { tiny?: 'full'; bigkid?: 'low' | 'none' }; // defaults: tiny 'full', bigkid 'low'
  noWallSpansM?: Array<[number, number]>; // bigkid only: arc-length ranges (m) with NO kerb (straights only)
  obstacles: Array<{
    atM: number; // arc-length position in metres
    offset: number; // metres, +ve = viewer's right
    kind: 'bump' | 'pillar' | 'gate' | 'balloon';
    tiers: Tier[];
  }>;
  checkpointsM: number[]; // arc-length positions, ascending
}

export interface ValidationError {
  rule: number;
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  errors: ValidationError[];
}

const TIERS: readonly Tier[] = ['tiny', 'bigkid'];
/** Tolerance for comparing sums of decimals that are meant to be exactly on a limit. */
const EPS = 1e-9;

/** Track width for a level and tier (level override, else the tier default). */
export function levelWidth(level: Pick<LevelDef, 'width'>, tier: Tier): number {
  return level.width?.[tier] ?? tuning.tiers[tier].width;
}

/**
 * Validates a level against the 7 rules of PLAN section 5. Returns every failure, each tagged
 * with its rule number; a level is `ok` only when there is none.
 *
 * Rule 1 is a precondition: if the control points are unusable (too few, too close, or an
 * arc length outside 80-120 m) the spline-based rules 2-7 are not evaluated.
 */
export function validateLevel(level: LevelDef): ValidationResult {
  const errors: ValidationError[] = [];
  const fail = (rule: number, message: string): void => {
    errors.push({ rule, message });
  };

  const spline = checkRule1(level, fail);
  if (!spline) return { ok: false, errors };
  checkRules2To7(level, spline, fail);
  return { ok: errors.length === 0, errors };
}

type Fail = (rule: number, message: string) => void;
type BuiltSpline = ReturnType<typeof buildSpline>;

/** Rule 1: at least 4 points, consecutive points >= 2 m apart, arc length 80-120 m. */
function checkRule1(level: LevelDef, fail: Fail): BuiltSpline | null {
  const v = tuning.validation;
  const pts = level.points;
  let ok = true;

  if (pts.length < v.minPoints) {
    ok = false;
    fail(1, `needs at least ${v.minPoints} control points, has ${pts.length}`);
  }

  let spacingOk = true;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1] as Vec3;
    const b = pts[i] as Vec3;
    const d = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    if (!(d >= v.minPointSpacingM)) {
      spacingOk = false;
      ok = false;
      fail(
        1,
        `control points ${i - 1} and ${i} are ${d.toFixed(2)} m apart (min ${v.minPointSpacingM} m)`,
      );
    }
  }

  // The curve is only well defined (no NaN from coincident points) when the spacing is fine.
  if (pts.length < 2 || !spacingOk) return null;
  const spline = buildSpline(pts);
  if (spline.finishM < v.minLengthM || spline.finishM > v.maxLengthM) {
    ok = false;
    fail(
      1,
      `arc length ${spline.finishM.toFixed(1)} m is outside ${v.minLengthM}-${v.maxLengthM} m`,
    );
  }
  return ok ? spline : null;
}

function checkRules2To7(level: LevelDef, spline: BuiltSpline, fail: Fail): void {
  const v = tuning.validation;
  const { frames, finishM } = spline;
  const radii = turningRadii(frames);
  /** Index of the last frame on the control-point curve (the end pad is flat and straight). */
  const lastTrackFrame = Math.min(frames.length - 1, Math.floor(finishM / spline.ds));

  // Rule 2: slope between consecutive frames.
  let maxSlope = 0;
  let maxSlopeAt = 0;
  for (let i = 1; i <= lastTrackFrame; i++) {
    const a = frames[i - 1] as Frame;
    const b = frames[i] as Frame;
    const deg =
      (Math.atan2(Math.abs(b.pos.y - a.pos.y), Math.hypot(b.pos.x - a.pos.x, b.pos.z - a.pos.z)) *
        180) /
      Math.PI;
    if (deg > maxSlope) {
      maxSlope = deg;
      maxSlopeAt = b.arcM;
    }
  }
  if (maxSlope > v.maxSlopeDeg) {
    fail(
      2,
      `slope reaches ${maxSlope.toFixed(1)} degrees at ${maxSlopeAt.toFixed(1)} m (max ${v.maxSlopeDeg})`,
    );
  }

  // Rule 3: turning radius per tier, and no overlap of the wall ribbon with itself.
  let minRadius = Infinity;
  let minRadiusAt = 0;
  for (let i = 0; i <= lastTrackFrame; i++) {
    if ((radii[i] as number) < minRadius) {
      minRadius = radii[i] as number;
      minRadiusAt = (frames[i] as Frame).arcM;
    }
  }
  for (const tier of TIERS) {
    const width = levelWidth(level, tier);
    if (minRadius < v.minRadiusPerWidth * width) {
      fail(
        3,
        `${tier}: turning radius ${minRadius.toFixed(1)} m at ${minRadiusAt.toFixed(1)} m is below ${(v.minRadiusPerWidth * width).toFixed(1)} m (${v.minRadiusPerWidth} x width ${width})`,
      );
    }
    const clash = findRibbonOverlap(frames, width);
    if (clash) {
      fail(
        3,
        `${tier}: the wall ribbon intersects itself (track at ${clash[0].toFixed(1)} m comes within ${clash[2].toFixed(1)} m of the track at ${clash[1].toFixed(1)} m; needs ${(width + 2 * tuning.track.wallThicknessM).toFixed(1)} m)`,
      );
    }
  }

  // Rule 4: checkpoints.
  const cps = level.checkpointsM;
  if (cps.length < 1) {
    fail(4, 'needs at least 1 checkpoint');
  } else {
    let ascending = true;
    for (let i = 1; i < cps.length; i++) {
      if (!((cps[i] as number) > (cps[i - 1] as number))) ascending = false;
    }
    if (!ascending) fail(4, 'checkpoints must be in strictly ascending order');
    if ((cps[0] as number) < v.checkpointFirstMinM) {
      fail(4, `first checkpoint at ${cps[0]} m is before ${v.checkpointFirstMinM} m`);
    }
    const last = cps[cps.length - 1] as number;
    if (last > finishM - v.checkpointLastBeforeFinishM) {
      fail(
        4,
        `last checkpoint at ${last} m is after ${(finishM - v.checkpointLastBeforeFinishM).toFixed(1)} m (finish - ${v.checkpointLastBeforeFinishM})`,
      );
    }
    const marks = [0, ...cps, finishM];
    for (let i = 1; i < marks.length; i++) {
      const gap = (marks[i] as number) - (marks[i - 1] as number);
      if (gap > v.maxCheckpointStretchM) {
        fail(
          4,
          `${gap.toFixed(1)} m between ${(marks[i - 1] as number).toFixed(1)} m and ${(marks[i] as number).toFixed(1)} m (max ${v.maxCheckpointStretchM})`,
        );
      }
    }
  }

  // Rule 5: obstacles.
  const o = tuning.obstacles;
  level.obstacles.forEach((ob, n) => {
    const name = `obstacle ${n} (${ob.kind} at ${ob.atM} m)`;
    if (ob.tiers.length === 0) fail(5, `${name} applies to no tier`);
    if (!Number.isFinite(ob.atM) || !Number.isFinite(ob.offset)) {
      fail(5, `${name} has a non-finite position`);
      return;
    }
    if (ob.atM < v.obstacleMinAtM || ob.atM > finishM - v.obstacleMaxBeforeFinishM) {
      fail(
        5,
        `${name} is outside [${v.obstacleMinAtM}, ${(finishM - v.obstacleMaxBeforeFinishM).toFixed(1)}] m`,
      );
    }
    for (const c of cps) {
      if (Math.abs(ob.atM - c) < v.obstacleCheckpointClearM) {
        fail(5, `${name} is within ${v.obstacleCheckpointClearM} m of the checkpoint at ${c} m`);
      }
    }
    if (ob.tiers.includes('tiny') && ob.kind !== 'bump' && ob.kind !== 'balloon') {
      fail(5, `${name}: Tiny may only contain bumps and balloons`);
    }
    for (const tier of ob.tiers) {
      const w = levelWidth(level, tier);
      const off = Math.abs(ob.offset);
      if (ob.kind === 'pillar') {
        const max = w / 2 - v.pillarEdgeMarginM;
        if (off < v.pillarMinOffsetM - EPS || off > max + EPS) {
          fail(
            5,
            `${name}: ${tier} pillar offset ${ob.offset} is outside ${v.pillarMinOffsetM} <= |offset| <= ${max.toFixed(2)}`,
          );
        }
      } else if (ob.kind === 'gate') {
        const reach = off + o.gate.halfSpanM + o.pillar.radiusM;
        if (reach > w / 2 + EPS) {
          fail(
            5,
            `${name}: ${tier} gate posts reach ${reach.toFixed(2)} m from the centre, more than half the width ${w / 2}`,
          );
        }
      } else if (ob.kind === 'bump') {
        const reach = off + (w * o.bump.spanFraction) / 2;
        if (reach > w / 2 + EPS) fail(5, `${name}: ${tier} bump pokes out of the ${w} m track`);
      } else if (off > w / 2 - v.balloonEdgeMarginM + EPS) {
        fail(5, `${name}: ${tier} balloon offset ${ob.offset} is too close to the wall`);
      }
    }
    if (ob.kind === 'pillar' || ob.kind === 'gate') {
      for (let i = 0; i < frames.length; i++) {
        const f = frames[i] as Frame;
        const d = Math.abs(f.arcM - ob.atM);
        if (d <= v.postSlopeWindowM && Math.abs(frameSlopeDeg(f)) > v.postMaxSlopeDeg) {
          fail(5, `${name} stands on a slope of ${Math.abs(frameSlopeDeg(f)).toFixed(1)} degrees`);
          break;
        }
      }
      for (let i = 0; i <= lastTrackFrame; i++) {
        const f = frames[i] as Frame;
        if (
          Math.abs(f.arcM - ob.atM) <= v.postRadiusWindowM &&
          (radii[i] as number) < v.postMinRadiusM
        ) {
          fail(
            5,
            `${name} is within ${v.postRadiusWindowM} m of a bend tighter than ${v.postMinRadiusM} m (${(radii[i] as number).toFixed(1)} m at ${f.arcM.toFixed(1)} m)`,
          );
          break;
        }
      }
    }
  });

  // Rule 6: no-wall spans only on gentle straights.
  (level.noWallSpansM ?? []).forEach(([lo, hi], n) => {
    if (!(lo < hi) || lo < 0 || hi > finishM) {
      fail(6, `noWallSpansM[${n}] = [${lo}, ${hi}] is not a range inside the track`);
      return;
    }
    for (let i = 0; i <= lastTrackFrame; i++) {
      const f = frames[i] as Frame;
      if (f.arcM >= lo && f.arcM <= hi && (radii[i] as number) <= v.noWallMinRadiusM) {
        fail(
          6,
          `noWallSpansM[${n}] = [${lo}, ${hi}] includes a bend of radius ${(radii[i] as number).toFixed(1)} m at ${f.arcM.toFixed(1)} m (needs > ${v.noWallMinRadiusM})`,
        );
        break;
      }
    }
  });

  // Rule 7: Tiny balloons, no stretch (start and finish included) longer than 25 m without one.
  const balloons = level.obstacles
    .filter((ob) => ob.kind === 'balloon' && ob.tiers.includes('tiny'))
    .map((ob) => ob.atM)
    .sort((a, b) => a - b);
  const marks = [0, ...balloons, finishM];
  for (let i = 1; i < marks.length; i++) {
    const gap = (marks[i] as number) - (marks[i - 1] as number);
    if (gap > v.tinyMaxBalloonGapM) {
      fail(
        7,
        `Tiny has ${gap.toFixed(1)} m without a balloon between ${(marks[i - 1] as number).toFixed(1)} m and ${(marks[i] as number).toFixed(1)} m (max ${v.tinyMaxBalloonGapM})`,
      );
    }
  }
}

/**
 * First pair of frames that belong to different parts of the track (arc distance beyond
 * `selfIntersectMinArcWidths` x width) yet are closer in plan view than the ribbon is wide
 * (width + two wall thicknesses). Returns [arcA, arcB, distance] or null.
 *
 * With a turning radius >= width, parts of the ribbon closer than that along the arc are
 * adjacent by construction, so only the far pairs can overlap.
 */
function findRibbonOverlap(
  frames: readonly Frame[],
  width: number,
): [number, number, number] | null {
  const needed = width + 2 * tuning.track.wallThicknessM;
  const farArc = tuning.validation.selfIntersectMinArcWidths * width;
  for (let i = 0; i < frames.length; i++) {
    const a = frames[i] as Frame;
    for (let j = i + 1; j < frames.length; j++) {
      const b = frames[j] as Frame;
      if (b.arcM - a.arcM < farArc) continue;
      const d = Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z);
      if (d < needed) return [a.arcM, b.arcM, d];
    }
  }
  return null;
}
