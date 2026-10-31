import { arc, buildPath, straight, toLength } from './path';
import type { LevelDef } from './schema';

/**
 * 1. Meadow Roll (PLAN Appendix B): straight, wide S-bend, straight. Flat, 83 m.
 * Tiny's new thing: balloons (the only obstacle). Big kid: kerbs and one pillar at +0.9.
 *
 *   0-24 m straight | 24-55 m S-bend (two 45 degree arcs, radius 16) | 55-83 m straight
 */
export const level01: LevelDef = {
  id: 'level01',
  name: 'Meadow Roll',
  palette: 'meadow',
  points: buildPath(toLength(83, [straight(24), arc(45, 16), arc(-45, 16)])),
  checkpointsM: [20, 41, 62],
  obstacles: [
    { atM: 9, offset: 0, kind: 'balloon', tiers: ['tiny', 'bigkid'] },
    { atM: 16, offset: 0.5, kind: 'balloon', tiers: ['tiny'] },
    { atM: 28, offset: -0.4, kind: 'balloon', tiers: ['tiny', 'bigkid'] },
    { atM: 35, offset: 0.4, kind: 'balloon', tiers: ['tiny'] },
    { atM: 47, offset: 0, kind: 'balloon', tiers: ['tiny', 'bigkid'] },
    { atM: 54, offset: -0.5, kind: 'balloon', tiers: ['tiny'] },
    { atM: 66, offset: -0.4, kind: 'balloon', tiers: ['tiny', 'bigkid'] },
    { atM: 69, offset: 0.9, kind: 'pillar', tiers: ['bigkid'] },
    { atM: 73, offset: 0, kind: 'balloon', tiers: ['tiny', 'bigkid'] },
  ],
};
