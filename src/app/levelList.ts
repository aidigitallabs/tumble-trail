import type { PaletteId } from '../config/brand';
import type { LevelDef } from '../levels/schema';

/** What the screens need to know about a playable level. */
export interface LevelInfo {
  def: LevelDef;
  id: string;
  name: string;
  palette: PaletteId;
  /** One star per checkpoint plus one for finishing (PLAN section 6). */
  maxStars: number;
}

/** The test course stays in the registry for the tests; it is not part of the game's level list. */
export const TEST_LEVEL_ID = 'levelTest';

/**
 * The levels a child plays, in order: the registry without the test course, unless the registry
 * has nothing else (then the test course is the only level, so the game is still playable).
 */
export function playableLevels(registry: readonly LevelDef[]): LevelInfo[] {
  const real = registry.filter((l) => l.id !== TEST_LEVEL_ID);
  const list = real.length > 0 ? real : registry;
  return list.map((def) => ({
    def,
    id: def.id,
    name: def.name,
    palette: def.palette,
    maxStars: def.checkpointsM.length + 1,
  }));
}
