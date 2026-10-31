import { levelTest } from './levelTest';
import type { LevelDef } from './schema';

/** Ordered level registry. Phase 3 appends level01 ... level06; levelTest stays for tests. */
export const levels: readonly LevelDef[] = [levelTest];

export function getLevel(id: string): LevelDef | undefined {
  return levels.find((l) => l.id === id);
}

export { levelTest };
