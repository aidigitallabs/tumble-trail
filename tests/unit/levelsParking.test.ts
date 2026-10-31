import RAPIER from '@dimforge/rapier3d-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import { tuning } from '../../src/config/tuning';
import { GameWorld } from '../../src/game/GameWorld';
import { levelTest } from '../../src/levels/levelTest';

beforeAll(async () => {
  await RAPIER.init();
});

/** levelTest without obstacles: its ramp up (about 48-66 m, 15 degrees) is what matters here. */
const bare = { ...levelTest, id: 'levelTestBare', obstacles: [] };

describe('parking rule (Phase 3, task 0)', () => {
  for (const tier of ['bigkid', 'tiny'] as const) {
    it(`${tier}: letting go mid-ramp stops the ball within 2 s and it stays parked`, () => {
      const w = new GameWorld(bare, tier);
      w.autopilot = true;
      while (w.progress.arcM < 57) w.step({ driving: true, steer: 0 }); // on the 15 degree ramp
      w.autopilot = false;
      const releasedAt = w.progress.arcM;

      for (let i = 0; i < 2 * tuning.physicsHz; i++) w.step({ driving: false, steer: 0 });
      const restAt = w.progress.arcM;
      expect(w.ball.speed()).toBeLessThan(tuning.ball.parkSpeed);

      // Then it holds: 6 more seconds on the ramp, the arc mark stays within 1.5 m.
      let lo = restAt;
      let hi = restAt;
      for (let i = 0; i < 6 * tuning.physicsHz; i++) {
        w.step({ driving: false, steer: 0 });
        lo = Math.min(lo, w.progress.arcM);
        hi = Math.max(hi, w.progress.arcM);
      }
      expect(hi - lo).toBeLessThan(1.5);
      expect(w.ball.speed()).toBeLessThan(0.05);
      const spin = Math.hypot(...Object.values(w.ball.body.angvel()));
      expect(spin).toBeLessThan(0.1); // one step of gravity between the zeroing and this read
      expect(w.respawnCount).toBe(0);
      // It braked to a stop where it was (a few metres of run-out at most), not far back down.
      expect(restAt - releasedAt).toBeGreaterThan(-1.5);
      expect(restAt - releasedAt).toBeLessThan(4);
    });
  }

  it('driving again after parking moves the ball on up the ramp', () => {
    const w = new GameWorld(bare, 'bigkid');
    w.autopilot = true;
    while (w.progress.arcM < 57) w.step({ driving: true, steer: 0 });
    w.autopilot = false;
    for (let i = 0; i < 3 * tuning.physicsHz; i++) w.step({ driving: false, steer: 0 });
    const parkedAt = w.progress.arcM;
    w.autopilot = true;
    for (let i = 0; i < 2 * tuning.physicsHz; i++) w.step({ driving: true, steer: 0 });
    expect(w.progress.arcM).toBeGreaterThan(parkedAt + 3);
  });

  it('does not hold a falling ball in mid-air: the spawn drop still lands', () => {
    const w = new GameWorld(bare, 'bigkid');
    const y0 = w.ball.position().y;
    for (let i = 0; i < 60; i++) w.step({ driving: false, steer: 0 });
    expect(y0 - w.ball.position().y).toBeGreaterThan(0.4); // fell 1.0 m to rest 0.5 m above the floor
    expect(w.ball.speed()).toBeLessThan(0.05);
  });

  it('is deterministic', () => {
    const run = (): number => {
      const w = new GameWorld(bare, 'bigkid');
      w.autopilot = true;
      while (w.progress.arcM < 57) w.step({ driving: true, steer: 0 });
      w.autopilot = false;
      for (let i = 0; i < 300; i++) w.step({ driving: false, steer: 0 });
      return w.progress.arcM;
    };
    expect(run()).toBe(run());
  });
});
