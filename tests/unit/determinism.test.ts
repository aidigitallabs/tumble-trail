import RAPIER from '@dimforge/rapier3d-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import { GameWorld } from '../../src/game/GameWorld';
import { levelTest } from '../../src/levels/levelTest';
import type { Tier } from '../../src/levels/schema';

beforeAll(async () => {
  // The only unit tests that need Rapier: it is initialised in Node here.
  await RAPIER.init();
});

const STEPS = 600;

/** Step a fresh levelTest world with the autopilot and record Progress after every step. */
function run(tier: Tier): { marks: Array<[number, number, number]>; pos: number[] } {
  const w = new GameWorld(levelTest, tier);
  w.autopilot = true;
  const marks: Array<[number, number, number]> = [];
  for (let i = 0; i < STEPS; i++) {
    w.step({ driving: false, steer: 0 });
    marks.push([w.progress.t, w.progress.arcM, w.progress.lateralOffset]);
  }
  const p = w.ball.position();
  w.dispose();
  return { marks, pos: [p.x, p.y, p.z] };
}

describe('determinism (PLAN section 13)', () => {
  for (const tier of ['tiny', 'bigkid'] as const) {
    it(`two ${STEPS}-step autopilot runs of levelTest give identical Progress marks (${tier})`, () => {
      const a = run(tier);
      const b = run(tier);
      expect(a.marks).toEqual(b.marks);
      expect(a.pos).toEqual(b.pos);
      // ... and they actually moved: 10 simulated seconds is well past the first checkpoint.
      expect((a.marks[STEPS - 1] as [number, number, number])[0]).toBeGreaterThan(20);
    });
  }
});
