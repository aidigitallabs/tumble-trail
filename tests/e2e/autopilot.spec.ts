import { expect, test } from '@playwright/test';

/** Seconds budget per tier (PLAN section 13: Tiny 120 s, Big kid 150 s). */
const BUDGET_SECONDS = { tiny: 120, bigkid: 150 } as const;
/** tuning.bigkidLevelSeconds (PLAN section 13), duplicated here on purpose so a tuning change is noticed. */
const BIGKID_WINDOW = [12, 60] as const;

for (const tier of ['tiny', 'bigkid'] as const) {
  test(`autopilot completes levelTest in ${tier}`, async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(`console: ${msg.text()}`);
    });
    page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));

    await page.goto('/');
    await page.waitForFunction(() => window.__tt?.state === 'playing', undefined, {
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
        const r = tt.fastForward(budget, 'finished');
        return { stateAfterLoad, width, ...r, ball: tt.ball() };
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

    // Record the finish time in the test report.
    test
      .info()
      .annotations.push({ type: 'finish-seconds', description: result.seconds.toFixed(2) });
    console.log(`autopilot levelTest ${tier}: finished in ${result.seconds.toFixed(2)} s`);

    expect(errors).toEqual([]);
  });
}

test('fastForward stops early at `until` and leaves a finished level finished', async ({
  page,
}) => {
  await page.goto('/');
  await page.waitForFunction(() => window.__tt?.state === 'playing', undefined, {
    timeout: 30_000,
  });
  const r = await page.evaluate(() => {
    const tt = window.__tt;
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
