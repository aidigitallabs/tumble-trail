import { arc, buildPath, ramp, straight, toLength } from './path';
import type { LevelDef } from './schema';

/**
 * 2. Little Hills (PLAN Appendix B): two gentle humps (under 10 degrees) with a curve between, 90 m.
 * Tiny's new thing: two bumps, centred, on the flat before each hill. Big kid: kerbs and two
 * pillars alternating -0.9 / +0.9 (on the flat, away from the curve).
 *
 *   hump 1 at 12-30 m | curve 36-51 m (45 degrees, radius 15) | hump 2 at 60-78 m
 */
export const level02: LevelDef = {
  id: 'level02',
  name: 'Little Hills',
  palette: 'meadow',
  points: buildPath(toLength(90, [straight(36), arc(45, 15)]), [
    ramp(12, 21, 1.0),
    ramp(21, 30, -1.0),
    ramp(60, 69, 1.0),
    ramp(69, 78, -1.0),
  ]),
  checkpointsM: [12, 36, 59, 79],
  obstacles: [
    { atM: 6, offset: 0, kind: 'bump', tiers: ['tiny', 'bigkid'] },
    { atM: 9, offset: -0.9, kind: 'pillar', tiers: ['bigkid'] },
    { atM: 16, offset: 0.4, kind: 'balloon', tiers: ['tiny', 'bigkid'] },
    { atM: 24, offset: -0.4, kind: 'balloon', tiers: ['tiny'] },
    { atM: 41, offset: 0, kind: 'balloon', tiers: ['tiny', 'bigkid'] },
    { atM: 46, offset: 0.4, kind: 'balloon', tiers: ['tiny'] },
    { atM: 52, offset: 0.9, kind: 'pillar', tiers: ['bigkid'] },
    { atM: 55.5, offset: 0, kind: 'bump', tiers: ['tiny', 'bigkid'] },
    { atM: 65, offset: -0.4, kind: 'balloon', tiers: ['tiny', 'bigkid'] },
    { atM: 72, offset: 0.4, kind: 'balloon', tiers: ['tiny'] },
    { atM: 82, offset: 0, kind: 'balloon', tiers: ['tiny', 'bigkid'] },
  ],
};
