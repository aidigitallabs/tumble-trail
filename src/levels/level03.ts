import { arc, buildPath, straight, toLength } from './path';
import type { LevelDef } from './schema';

/**
 * 3. Seaside Sweep (PLAN Appendix B): a long 150 degree sweep, then a straight, 100 m. Flat.
 * The sweep has radius 15 m (the brief says at least 12; the spline's own wobble measures about
 * 1 m under the design radius, and rule 5 wants 12 m, see DECISIONS).
 * Tiny's new thing: lots of balloons in the curve. Big kid: kerbs, then no kerb on the final
 * straight, and one gate on that straight.
 *
 *   0-18 m straight | 18-60 m sweep (150 degrees, radius 15) | 60-100 m straight
 */
export const level03: LevelDef = {
  id: 'level03',
  name: 'Seaside Sweep',
  palette: 'beach',
  points: buildPath(toLength(100, [straight(18), arc(150, 15)])),
  noWallSpansM: [[64, 98]],
  checkpointsM: [15, 38, 62, 86],
  obstacles: [
    { atM: 8, offset: 0, kind: 'balloon', tiers: ['tiny', 'bigkid'] },
    // The curve: a trail of balloons for Tiny (a few for Big kid too).
    { atM: 21, offset: 0.4, kind: 'balloon', tiers: ['tiny'] },
    { atM: 25, offset: -0.4, kind: 'balloon', tiers: ['tiny', 'bigkid'] },
    { atM: 29, offset: 0.4, kind: 'balloon', tiers: ['tiny'] },
    { atM: 33, offset: -0.4, kind: 'balloon', tiers: ['tiny'] },
    { atM: 42, offset: 0.4, kind: 'balloon', tiers: ['tiny', 'bigkid'] },
    { atM: 46, offset: -0.4, kind: 'balloon', tiers: ['tiny'] },
    { atM: 50, offset: 0, kind: 'balloon', tiers: ['tiny'] },
    { atM: 57, offset: 0.4, kind: 'balloon', tiers: ['tiny', 'bigkid'] },
    { atM: 69, offset: -0.4, kind: 'balloon', tiers: ['tiny'] },
    { atM: 78, offset: 0, kind: 'gate', tiers: ['bigkid'] },
    { atM: 74, offset: 0.4, kind: 'balloon', tiers: ['tiny', 'bigkid'] },
    { atM: 90, offset: 0, kind: 'balloon', tiers: ['tiny', 'bigkid'] },
  ],
};
