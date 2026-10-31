import { expect, test } from '@playwright/test';

/** Seconds budget per tier (PLAN section 13: Tiny 120 s, Big kid 150 s). */
const BUDGET_SECONDS = { tiny: 120, bigkid: 150 } as const;
/** tuning.bigkidLevelSeconds (PLAN section 13), duplicated here on purpose so a tuning change is noticed. */
const BIGKID_WINDOW = [12, 60] as const;

for (const tier of ['tiny', 'bigkid'] as const) {
  test(`autopilot completes levelTest in ${tier} (bumps, balloons, pillars, gate)`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(`console: ${msg.text()}`);
    });
    page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));

    await page.goto('/');
    await page.waitForFunction(() => window.__tt?.state === 'title', undefined, {
      timeout: 30_000,
    });

    const result = await page.evaluate(
      async ({ tier, budget }) => {
        const tt = window.__tt;
        tt.setTier(tier);
        await tt.loadLevel('levelTest');
        const stateAfterLoad = tt.state;
        const width = tt.trackWidth();
        tt.autopilot = true;
        const obstacles = tt.obstacles();
        const r = tt.fastForward(budget, 'finished');
        return { stateAfterLoad, width, obstacles, ...r, ball: tt.ball(), balloons: tt.balloons() };
      },
      { tier, budget: BUDGET_SECONDS[tier] },
    );

    expect(result.stateAfterLoad).toBe('playing');
    expect(result.width).toBe(tier === 'tiny' ? 6 : 3.5);
    expect(result.state).toBe('finished');
    expect(result.seconds).toBeLessThan(BUDGET_SECONDS[tier]);
    if (tier === 'bigkid') {
      expect(result.seconds).toBeGreaterThanOrEqual(BIGKID_WINDOW[0]);
      expect(result.seconds).toBeLessThanOrEqual(BIGKID_WINDOW[1]);
    }
    expect(result.ball.t).toBeGreaterThan(95);

    // Phase 2: levelTest has every obstacle kind (pillars and the gate are Big kid only), and the
    // autopilot, which only follows the centreline and avoids posts, pops the balloons on its way:
    // all of them in Tiny (they are within 0.4 m of the centreline); at least one in Big kid.
    expect(result.obstacles.bump).toBe(2);
    expect(result.obstacles.balloon).toBe(4);
    expect(result.obstacles.pillar).toBe(tier === 'bigkid' ? 2 : 0);
    expect(result.obstacles.gate).toBe(tier === 'bigkid' ? 1 : 0);
    expect(result.balloons.total).toBe(4);
    if (tier === 'tiny') expect(result.balloons.popped).toBe(result.balloons.total);
    else expect(result.balloons.popped).toBeGreaterThanOrEqual(1);

    // Record the finish time in the test report.
    test
      .info()
      .annotations.push({ type: 'finish-seconds', description: result.seconds.toFixed(2) });
    console.log(
      `autopilot levelTest ${tier}: finished in ${result.seconds.toFixed(2)} s, balloons ${result.balloons.popped}/${result.balloons.total}`,
    );

    expect(errors).toEqual([]);
  });
}

test('fastForward stops early at `until` and leaves a finished level finished', async ({
  page,
}) => {
  await page.goto('/');
  await page.waitForFunction(() => window.__tt?.state === 'title', undefined, {
    timeout: 30_000,
  });
  const r = await page.evaluate(async () => {
    const tt = window.__tt;
    await tt.loadLevel('levelTest');
    tt.autopilot = true;
    const first = tt.fastForward(5); // not finished after 5 s
    const done = tt.fastForward(120, 'finished');
    const again = tt.fastForward(120, 'finished');
    return { first, done, again };
  });
  expect(r.first).toEqual({ state: 'playing', seconds: 5 });
  expect(r.done.state).toBe('finished');
  expect(r.done.seconds).toBeLessThan(120);
  expect(r.again).toEqual({ state: 'finished', seconds: 0 });
});
