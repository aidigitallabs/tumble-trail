import { level01 } from './level01';
import { level02 } from './level02';
import { level03 } from './level03';
import { level04 } from './level04';
import { level05 } from './level05';
import { level06 } from './level06';
import { levelTest } from './levelTest';
import type { LevelDef } from './schema';

/** The six shipped levels, in play order (PLAN Appendix B). */
export const shippedLevels: readonly LevelDef[] = [
  level01,
  level02,
  level03,
  level04,
  level05,
  level06,
];

/** Levels that exist for tests only; never shown in the level select. */
export const testLevels: readonly LevelDef[] = [levelTest];

/** Ordered level registry: the six shipped levels, then the test course (PLAN section 4). */
export const levels: readonly LevelDef[] = [...shippedLevels, ...testLevels];

export function getLevel(id: string): LevelDef | undefined {
  return levels.find((l) => l.id === id);
}

export { level01, level02, level03, level04, level05, level06, levelTest };
