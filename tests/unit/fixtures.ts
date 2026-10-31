import type { Vec3 } from '../../src/levels/schema';

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
