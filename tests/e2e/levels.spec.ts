import { expect, test } from '@playwright/test';

/** Phase 3: the autopilot completes every shipped level in both tiers, within the stats budget. */
const LEVELS = ['level01', 'level02', 'level03', 'level04', 'level05', 'level06'] as const;
const BUDGET_SECONDS = 150;
/** tuning.bigkidLevelSeconds (PLAN section 13), duplicated here on purpose so a tuning change is noticed. */
const BIGKID_WINDOW = [12, 60] as const;
/** Performance budget (PLAN section 14). */
const MAX_TRIANGLES = 40_000;
const MAX_DRAW_CALLS = 40;
/** The ball never moves this far in a 0.25 s slice (top speed ~7 m/s), a respawn teleport always does. */
const TELEPORT_M = 4;

for (const id of LEVELS) {
  for (const tier of ['tiny', 'bigkid'] as const) {
    test(`autopilot completes ${id} in ${tier}, within the stats budget`, async ({ page }) => {
      const errors: string[] = [];
      page.on('console', (msg) => {
        if (msg.type() === 'error') errors.push(`console: ${msg.text()}`);
      });
      page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));

      await page.goto('/');
      await page.waitForFunction(() => window.__tt?.state === 'playing', undefined, {
        timeout: 30_000,
      });

      await page.evaluate(
        async ({ tier, id }) => {
          window.__tt.setTier(tier);
          await window.__tt.loadLevel(id);
        },
        { tier, id },
      );
      const loaded = await page.evaluate(() => ({
        state: window.__tt.state,
        width: window.__tt.trackWidth(),
        obstacles: window.__tt.obstacles(),
        balloons: window.__tt.balloons(),
      }));
      expect(loaded.state).toBe('playing');
      expect(loaded.width).toBe(tier === 'tiny' ? 6 : 3.5);
      expect(loaded.balloons.total).toBeGreaterThanOrEqual(3);
      if (tier === 'tiny') {
        expect(loaded.obstacles.pillar).toBe(0);
        expect(loaded.obstacles.gate).toBe(0);
      }

      // Two rendered frames, then a stats sample (renderer.info is the last rendered frame).
      const sample = async (): Promise<{ triangles: number; drawCalls: number }> => {
        await page.evaluate(
          () =>
            new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
        );
        return page.evaluate(() => window.__tt.stats());
      };
      const start = await sample();

      // Fast-forward in 0.25 s slices (inside one evaluate, so the rAF loop cannot interleave) to
      // count respawns: a respawn teleports the ball back by metres, nothing else moves it that far.
      const run = await page.evaluate(
        ({ budget, teleport }) => {
          const tt = window.__tt;
          tt.autopilot = true;
          let seconds = 0;
          let respawns = 0;
          let last = tt.ball().pos;
          while (tt.state === 'playing' && seconds < budget) {
            const r = tt.fastForward(0.25, 'finished');
            seconds += r.seconds;
            const p = tt.ball().pos;
            if (Math.hypot(p[0] - last[0], p[1] - last[1], p[2] - last[2]) > teleport) respawns++;
            last = p;
          }
          return { state: tt.state, seconds, respawns, ball: tt.ball(), balloons: tt.balloons() };
        },
        { budget: BUDGET_SECONDS, teleport: TELEPORT_M },
      );
      const end = await sample();

      expect(run.state).toBe('finished');
      expect(run.seconds).toBeLessThan(BUDGET_SECONDS);
      expect(run.respawns).toBe(0);
      if (tier === 'bigkid') {
        expect(run.seconds).toBeGreaterThanOrEqual(BIGKID_WINDOW[0]);
        expect(run.seconds).toBeLessThanOrEqual(BIGKID_WINDOW[1]);
      }
      expect(run.ball.t).toBeGreaterThan(79);

      // Stats: at the start and at the end (the ball is beside the finish arch, end pad in view).
      // A mid-run sample needs rendered frames, so fast-forward half way on a fresh load.
      await page.evaluate(
        async ({ tier, id, half }) => {
          window.__tt.setTier(tier);
          await window.__tt.loadLevel(id);
          window.__tt.autopilot = true;
          window.__tt.fastForward(half);
        },
        { tier, id, half: run.seconds / 2 },
      );
      const middle = await sample();
      for (const s of [start, middle, end]) {
        expect(s.triangles).toBeGreaterThan(0);
        expect(s.triangles).toBeLessThanOrEqual(MAX_TRIANGLES);
        expect(s.drawCalls).toBeGreaterThan(0);
        expect(s.drawCalls).toBeLessThanOrEqual(MAX_DRAW_CALLS);
      }

      const summary =
        `${id} ${tier}: ${run.seconds.toFixed(2)} s, respawns ${run.respawns}, ` +
        `balloons ${run.balloons.popped}/${run.balloons.total}, ` +
        `tris ${Math.max(start.triangles, middle.triangles, end.triangles)}, ` +
        `draws ${Math.max(start.drawCalls, middle.drawCalls, end.drawCalls)}`;
      test.info().annotations.push({ type: 'finish-seconds', description: run.seconds.toFixed(2) });
      test.info().annotations.push({ type: 'respawns', description: String(run.respawns) });
      test.info().annotations.push({ type: 'summary', description: summary });
      console.log(`autopilot ${summary}`);

      expect(errors).toEqual([]);
    });
  }
}
