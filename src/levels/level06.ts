import { arc, buildPath, ramp, straight, toLength } from './path';
import type { LevelDef } from './schema';

/**
 * 6. Big Sky Finale (PLAN Appendix B): S-bend, hump, sweep, then a long gentle downhill to the
 * finish, 117 m. Tiny: everything, lots of balloons. Big kid: kerbs everywhere (no `none` spans),
 * one gate, three pillars. Posts and bumps all stand before the downhill, where the ball is fast;
 * the pillars in the bends are legal because every bend here has radius 15 m (rule 5 wants 12).
 *
 *   straight 0-14 | S-bend 14-36 (two 30 degree arcs, radius 15) | straight 36-62 with a hump
 *   at 39-59 | sweep 62-89 (90 degrees, radius 15) | downhill 89-117 (about 6.5 degrees)
 */
const sBend = (deg: number): ReturnType<typeof arc> => arc(deg, 15);

export const level06: LevelDef = {
  id: 'level06',
  name: 'Big Sky Finale',
  palette: 'sky',
  points: buildPath(
    toLength(117, [straight(14), sBend(30), sBend(-30), straight(26.3), arc(90, 15)]),
    [ramp(39, 49, 1.2), ramp(49, 59, -1.2), ramp(88.6, 117, -2.8, 4)],
  ),
  checkpointsM: [12.5, 36.5, 60, 88, 104],
  obstacles: [
    { atM: 6, offset: 0, kind: 'gate', tiers: ['bigkid'] },
    { atM: 9, offset: 0, kind: 'bump', tiers: ['tiny'] },
    { atM: 16, offset: 0.4, kind: 'balloon', tiers: ['tiny', 'bigkid'] },
    // Pillars on the outside of the S-bend's two turns, then one in the sweep.
    { atM: 19.4, offset: -0.9, kind: 'pillar', tiers: ['bigkid'] },
    { atM: 21.5, offset: 0.4, kind: 'balloon', tiers: ['tiny'] },
    { atM: 25.5, offset: -0.4, kind: 'balloon', tiers: ['tiny'] },
    { atM: 30.3, offset: 0.9, kind: 'pillar', tiers: ['bigkid'] },
    { atM: 33, offset: 0, kind: 'balloon', tiers: ['tiny'] },
    { atM: 42, offset: 0.4, kind: 'balloon', tiers: ['tiny'] },
    { atM: 48, offset: 0, kind: 'balloon', tiers: ['tiny', 'bigkid'] },
    { atM: 54, offset: -0.4, kind: 'balloon', tiers: ['tiny'] },
    { atM: 66, offset: 0.4, kind: 'balloon', tiers: ['tiny'] },
    { atM: 71, offset: 0, kind: 'bump', tiers: ['tiny', 'bigkid'] },
    { atM: 75.3, offset: -0.9, kind: 'pillar', tiers: ['bigkid'] },
    { atM: 79, offset: -0.4, kind: 'balloon', tiers: ['tiny', 'bigkid'] },
    { atM: 84, offset: 0.4, kind: 'balloon', tiers: ['tiny'] },
    { atM: 94, offset: 0, kind: 'balloon', tiers: ['tiny', 'bigkid'] },
    { atM: 99, offset: -0.4, kind: 'balloon', tiers: ['tiny'] },
    { atM: 107, offset: 0.4, kind: 'balloon', tiers: ['tiny', 'bigkid'] },
    { atM: 109, offset: 0, kind: 'balloon', tiers: ['tiny'] },
  ],
};
