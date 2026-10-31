import { tuning } from '../config/tuning';
import { buildSpline } from '../game/Spline';

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

/**
 * STUB (Phase 1a): implements only rule 1 of PLAN section 5 -- at least 4 control points,
 * consecutive points at least 2 m apart, arc length 80-120 m. Rules 2-7 arrive in Phase 2.
 */
export function validateLevel(level: LevelDef): ValidationResult {
  const v = tuning.validation;
  const errors: ValidationError[] = [];
  const pts = level.points;

  if (pts.length < v.minPoints) {
    errors.push({
      rule: 1,
      message: `needs at least ${v.minPoints} control points, has ${pts.length}`,
    });
  }

  let spacingOk = true;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1] as Vec3;
    const b = pts[i] as Vec3;
    const d = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    if (!(d >= v.minPointSpacingM)) {
      spacingOk = false;
      errors.push({
        rule: 1,
        message: `control points ${i - 1} and ${i} are ${d.toFixed(2)} m apart (min ${v.minPointSpacingM} m)`,
      });
    }
  }

  // The curve is only well defined (no NaN from coincident points) when the spacing is fine.
  if (pts.length >= 2 && spacingOk) {
    const length = buildSpline(pts).finishM;
    if (length < v.minLengthM || length > v.maxLengthM) {
      errors.push({
        rule: 1,
        message: `arc length ${length.toFixed(1)} m is outside ${v.minLengthM}-${v.maxLengthM} m`,
      });
    }
  }

  return { ok: errors.length === 0, errors };
}
