import type { LevelDef, Vec3 } from './schema';

/**
 * Test course (PLAN section 16, Phase 1a): straight -> S-bend -> ramp up 15 deg -> plateau ->
 * ramp down -> straight, about 100 m of track (arc length 99.6 m), flat everywhere except the
 * two ramps. Phase 2 fills it with every obstacle kind (Tiny: bumps and balloons; Big kid adds
 * two pillars and a gate).
 *
 * Built with a tiny generator so the numbers stay readable; the result is a plain point list.
 */
const RAMP_DEG = 15;
const RAMP_STEP_M = 2.5; // horizontal metres per ramp control point
/** Ease-in / ease-out multipliers on the 15 deg slope so the spline does not overshoot it. */
const RAMP_SLOPE_FACTORS = [0.4, 0.8, 1, 1, 0.8, 0.4];
const SHIFT_M = 3; // lateral size of each half of the S-bend
const SHIFT_LENGTH_M = 14; // length of each half of the S-bend
const SHIFT_POINTS = 4;

function buildPoints(): Vec3[] {
  const pts: Vec3[] = [
    [0, 0, 0],
    [0, 0, 8],
    [0, 0, 14],
  ];
  // S-bend: a lane shift right then the same back left. Each half has zero heading error at both
  // ends (x = D * (u - sin(2 pi u) / (2 pi))), so the track is straight where they meet.
  const shift = (u: number): number => SHIFT_M * (u - Math.sin(2 * Math.PI * u) / (2 * Math.PI));
  const dz = SHIFT_LENGTH_M / SHIFT_POINTS;
  for (let k = 1; k <= SHIFT_POINTS; k++) pts.push([shift(k / SHIFT_POINTS), 0, 14 + dz * k]);
  for (let k = 1; k <= SHIFT_POINTS; k++) {
    pts.push([SHIFT_M - shift(k / SHIFT_POINTS), 0, 14 + SHIFT_LENGTH_M + dz * k]);
  }
  // Straight run-in, ramp up, plateau, ramp down, straight run-out.
  const rise = Math.tan((RAMP_DEG * Math.PI) / 180);
  let y = 0;
  let z = 49;
  pts.push([0, 0, 46], [0, 0, 49]);
  for (const f of RAMP_SLOPE_FACTORS) {
    z += RAMP_STEP_M;
    y += rise * RAMP_STEP_M * f;
    pts.push([0, y, z]);
  }
  const plateauY = y;
  pts.push([0, plateauY, z + 4], [0, plateauY, z + 8]);
  z += 8;
  for (const f of RAMP_SLOPE_FACTORS) {
    z += RAMP_STEP_M;
    y -= rise * RAMP_STEP_M * f;
    pts.push([0, Math.max(0, y), z]);
  }
  pts.push([0, 0, z + 3], [0, 0, z + 11]);
  return pts;
}

export const levelTest: LevelDef = {
  id: 'levelTest',
  name: 'Test Course',
  palette: 'meadow',
  points: buildPoints(),
  // Arc-length positions (m). Ramp up is about 48-66 m, plateau 66-74 m, ramp down 74-90 m.
  checkpointsM: [25, 50, 72],
  // Everything the track system has, placed where the validator wants it (PLAN section 5):
  // bumps and balloons in both tiers (balloons near the centreline so the autopilot pops them),
  // pillars and a gate in Big kid only, on flat, straight stretches (the S-bend, 14-44 m, has
  // radii under 12 m and the ramps are steeper than 8 degrees).
  obstacles: [
    { atM: 8, offset: 0.9, kind: 'pillar', tiers: ['bigkid'] },
    { atM: 12, offset: 0, kind: 'bump', tiers: ['tiny', 'bigkid'] },
    { atM: 19, offset: 0, kind: 'balloon', tiers: ['tiny', 'bigkid'] },
    { atM: 34, offset: 0, kind: 'bump', tiers: ['tiny', 'bigkid'] },
    { atM: 41, offset: 0.4, kind: 'balloon', tiers: ['tiny', 'bigkid'] },
    { atM: 46, offset: 0, kind: 'gate', tiers: ['bigkid'] },
    { atM: 62, offset: -0.4, kind: 'balloon', tiers: ['tiny', 'bigkid'] },
    { atM: 68.5, offset: -0.9, kind: 'pillar', tiers: ['bigkid'] },
    { atM: 84, offset: 0, kind: 'balloon', tiers: ['tiny', 'bigkid'] },
  ],
};
