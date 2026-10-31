import { arc, buildPath, ramp, straight, toLength } from './path';
import type { LevelDef } from './schema';

/**
 * 4. Up in the Clouds (PLAN Appendix B): ramp up 15 degrees, a plateau with a wiggle, ramp down
 * 15 degrees, 101 m. Tiny's new thing: balloons on the plateau. Big kid: kerbs, one gate on the
 * plateau (flat for 10 m after it: the 6 m banner would catch the camera if the track climbed
 * right after a gate), and one pillar 10 m after the descent (the ball is fastest there, so
 * there are no bumps and no posts on or right after it).
 *
 *   ramp up 12-28 m | plateau 28-66 m (wiggle 30-52 m, two 30 degree arcs, radius 15) |
 *   ramp down 66-82 m | flat run-out 82-101 m
 */
export const level04: LevelDef = {
  id: 'level04',
  name: 'Up in the Clouds',
  palette: 'sky',
  points: buildPath(toLength(100, [straight(30), arc(30, 15), arc(-30, 15)]), [
    ramp(12, 28, 3.6),
    ramp(66, 82, -3.6),
  ]),
  checkpointsM: [11, 38, 62, 87],
  obstacles: [
    { atM: 7, offset: 0, kind: 'balloon', tiers: ['tiny', 'bigkid'] },
    { atM: 20, offset: 0, kind: 'balloon', tiers: ['tiny', 'bigkid'] },
    { atM: 31, offset: 0.4, kind: 'balloon', tiers: ['tiny', 'bigkid'] },
    { atM: 43, offset: -0.4, kind: 'balloon', tiers: ['tiny', 'bigkid'] },
    { atM: 48, offset: 0.4, kind: 'balloon', tiers: ['tiny'] },
    { atM: 52, offset: 0, kind: 'balloon', tiers: ['tiny'] },
    { atM: 56, offset: 0, kind: 'gate', tiers: ['bigkid'] },
    { atM: 57.5, offset: -0.4, kind: 'balloon', tiers: ['tiny'] },
    { atM: 72, offset: 0, kind: 'balloon', tiers: ['tiny', 'bigkid'] },
    { atM: 78, offset: 0.4, kind: 'balloon', tiers: ['tiny'] },
    { atM: 90.5, offset: 0.4, kind: 'balloon', tiers: ['tiny'] },
    { atM: 92, offset: -0.9, kind: 'pillar', tiers: ['bigkid'] },
  ],
};
