import { expect, test } from '@playwright/test';

/** Performance budget (PLAN section 14). */
const MAX_TRIANGLES = 40_000;
const MAX_DRAW_CALLS = 40;

for (const tier of ['tiny', 'bigkid'] as const) {
  test(`stats() within the performance budget (levelTest, ${tier})`, async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => window.__tt?.state === 'title', undefined, {
      timeout: 30_000,
    });
    await page.evaluate(async (t) => {
      window.__tt.setTier(t);
      await window.__tt.loadLevel('levelTest');
    }, tier);

    // Let a couple of frames render the freshly loaded level, then mid-run, then at the end.
    const sample = async (): Promise<{ triangles: number; drawCalls: number }> => {
      await page.evaluate(
        () =>
          new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
      );
      return page.evaluate(() => window.__tt.stats());
    };

    const start = await sample();
    await page.evaluate(() => {
      window.__tt.autopilot = true;
      window.__tt.fastForward(15);
    });
    const middle = await sample();
    await page.evaluate(() => window.__tt.fastForward(120, 'finished'));
    const end = await sample();

    for (const s of [start, middle, end]) {
      expect(s.triangles).toBeGreaterThan(0);
      expect(s.triangles).toBeLessThanOrEqual(MAX_TRIANGLES);
      expect(s.drawCalls).toBeGreaterThan(0);
      expect(s.drawCalls).toBeLessThanOrEqual(MAX_DRAW_CALLS);
    }
    console.log(
      `stats ${tier}: start ${JSON.stringify(start)} middle ${JSON.stringify(middle)} end ${JSON.stringify(end)}`,
    );
  });
}
