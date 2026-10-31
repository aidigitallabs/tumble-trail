import { buildSpline } from '../../src/game/Spline';
import type { LevelDef, Vec3 } from '../../src/levels/schema';

/** Straight, flat track along +Z, finishM = 40. */
export const straightPoints: Vec3[] = [
  [0, 0, 0],
  [0, 0, 10],
  [0, 0, 20],
  [0, 0, 30],
  [0, 0, 40],
];

/**
 * Hairpin: leg A along +Z at x = 0 (z 0..20), a semicircle of radius ~2 m, leg B back along -Z at
 * x = 4 (z 20..0). The legs are 4 m apart.
 */
export const hairpinPoints: Vec3[] = [
  [0, 0, 0],
  [0, 0, 10],
  [0, 0, 20],
  [0.586, 0, 21.414],
  [2, 0, 22],
  [3.414, 0, 21.414],
  [4, 0, 20],
  [4, 0, 10],
  [4, 0, 0],
];

/**
 * A level around any points, with checkpoints every 20 m (20, 40, ...) and a balloon halfway
 * between them (10, 30, ...), no other obstacles. Whether it is valid depends on the points.
 */
export function scaffold(points: Vec3[], id = 'scaffold'): LevelDef {
  const finishM = buildSpline(points).finishM;
  const checkpointsM: number[] = [];
  for (let m = 20; m <= finishM - 10; m += 20) checkpointsM.push(m);
  const obstacles: LevelDef['obstacles'] = [];
  for (let m = 10; m <= finishM - 8; m += 20) {
    obstacles.push({ atM: m, offset: 0, kind: 'balloon', tiers: ['tiny', 'bigkid'] });
  }
  return { id, name: id, palette: 'meadow', points, checkpointsM, obstacles };
}

/** A valid, plain level: a straight, flat track of `lengthM` metres. Passes every rule. */
export function plainLevel(lengthM = 100): LevelDef {
  return scaffold(
    [0, 1, 2, 3].map((i) => [0, 0, (i * lengthM) / 3] as Vec3),
    'plain',
  );
}
