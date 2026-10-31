import { arc, buildPath, straight, toLength } from './path';
import type { LevelDef } from './schema';

/**
 * 5. Zigzag Beach (PLAN Appendix B): three alternating 70 degree turns with straights, 110 m. Flat.
 * Turn radius 15 m (the brief says at least 10): rule 5 wants pillars at least 4 m from any bend
 * tighter than 12 m, so with 15 m turns the Big kid pillars can stand in the turns themselves,
 * on the outside, as the brief says (see DECISIONS).
 * Tiny's new thing: bumps on the straights. Big kid: kerbs everywhere, one pillar on the outside
 * of each turn at +/-0.9.
 *
 *   straight 0-12 | right 12-32 | straight 32-45 | left 45-65 | straight 65-78 | right 78-98 |
 *   straight 98-110
 */
const turn = (deg: number): ReturnType<typeof arc> => arc(deg, 15);

export const level05: LevelDef = {
  id: 'level05',
  name: 'Zigzag Beach',
  palette: 'beach',
  points: buildPath(
    toLength(110, [straight(11), turn(70), straight(12), turn(-70), straight(12), turn(70)]),
  ),
  checkpointsM: [12, 35, 62, 84],
  obstacles: [
    { atM: 6, offset: 0, kind: 'bump', tiers: ['tiny', 'bigkid'] },
    { atM: 17, offset: 0.4, kind: 'balloon', tiers: ['tiny'] },
    // Outside of a right turn is the left (negative offsets), and the other way round.
    { atM: 21.7, offset: -0.9, kind: 'pillar', tiers: ['bigkid'] },
    { atM: 26.5, offset: 0, kind: 'balloon', tiers: ['tiny', 'bigkid'] },
    { atM: 38.3, offset: 0, kind: 'bump', tiers: ['tiny', 'bigkid'] },
    { atM: 42, offset: -0.4, kind: 'balloon', tiers: ['tiny'] },
    { atM: 50, offset: 0.4, kind: 'balloon', tiers: ['tiny', 'bigkid'] },
    { atM: 55, offset: 0.9, kind: 'pillar', tiers: ['bigkid'] },
    { atM: 59, offset: -0.4, kind: 'balloon', tiers: ['tiny'] },
    { atM: 66, offset: 0, kind: 'balloon', tiers: ['tiny', 'bigkid'] },
    { atM: 71.6, offset: 0, kind: 'bump', tiers: ['tiny', 'bigkid'] },
    { atM: 76, offset: 0.4, kind: 'balloon', tiers: ['tiny'] },
    { atM: 88.3, offset: -0.9, kind: 'pillar', tiers: ['bigkid'] },
    { atM: 92, offset: 0.4, kind: 'balloon', tiers: ['tiny', 'bigkid'] },
    { atM: 97, offset: -0.4, kind: 'balloon', tiers: ['tiny'] },
    { atM: 101.5, offset: 0, kind: 'bump', tiers: ['tiny', 'bigkid'] },
  ],
};
