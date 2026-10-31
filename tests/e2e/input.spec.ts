import { expect, test, type Page } from '@playwright/test';

/** Wait out the 500 ms input lockout that follows every state change (PLAN section 6). */
const LOCKOUT_WAIT_MS = 900;

async function loadAs(page: Page, tier: 'tiny' | 'bigkid'): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => window.__tt?.state === 'playing', undefined, {
    timeout: 30_000,
  });
  await page.evaluate(async (t) => {
    window.__tt.setTier(t);
    await window.__tt.loadLevel('levelTest');
  }, tier);
  await page.waitForTimeout(LOCKOUT_WAIT_MS);
}

test('Big kid: the ball only rolls while a finger is down (mouse stands in for touch)', async ({
  page,
}) => {
  await loadAs(page, 'bigkid');
  const idle = await page.evaluate(() => window.__tt.ball().t);
  await page.waitForTimeout(1000);
  expect(await page.evaluate(() => window.__tt.ball().t)).toBeLessThan(idle + 0.2);

  await page.mouse.move(500, 400);
  await page.mouse.down();
  await page.waitForTimeout(2500);
  const driven = await page.evaluate(() => window.__tt.ball().t);
  expect(driven).toBeGreaterThan(idle + 2);
  await page.mouse.up();
});

test('Tiny: always rolls, and the finger steers to a lane (right of origin = viewer right)', async ({
  page,
}) => {
  await loadAs(page, 'tiny');
  // Rolls with no input.
  const t0 = await page.evaluate(() => window.__tt.ball().t);
  await page.waitForTimeout(1500);
  expect(await page.evaluate(() => window.__tt.ball().t)).toBeGreaterThan(t0 + 1);

  await page.mouse.move(400, 400);
  await page.mouse.down();
  await page.mouse.move(700, 400, { steps: 5 }); // well past the steer range: full steer
  // The finger decays back to centre after 1 s without moving (steerDecay), so poll for the lane
  // rather than sampling at a fixed time.
  await page.waitForFunction(() => window.__tt.ball().lateral > 0.5, undefined, {
    timeout: 5000,
    polling: 'raf',
  });
  await page.mouse.up();
});

test('a pointer starting within 40 px of the edge is ignored', async ({ page }) => {
  await loadAs(page, 'bigkid');
  await page.mouse.move(10, 400);
  await page.mouse.down();
  const t0 = await page.evaluate(() => window.__tt.ball().t);
  await page.waitForTimeout(1200);
  expect(await page.evaluate(() => window.__tt.ball().t)).toBeLessThan(t0 + 0.2);
  await page.mouse.up();
});
