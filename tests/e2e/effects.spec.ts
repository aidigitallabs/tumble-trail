import { expect, test, type Page } from '@playwright/test';
import { bootToTitle, press, waitForState } from './helpers';

/** Performance budget (PLAN section 14) and the effects pool (PLAN section 16). */
const MAX_TRIANGLES = 40_000;
const MAX_DRAW_CALLS = 40;
const MAX_QUADS = 360;

const frames = (page: Page, n: number): Promise<void> =>
  page.evaluate(
    (count) =>
      new Promise<void>((resolve) => {
        let left = count;
        const tick = (): void => {
          if (--left <= 0) resolve();
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
    n,
  );

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console: ${msg.text()}`);
  });
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  return errors;
}

for (const [level, tier] of [
  ['levelTest', 'tiny'],
  ['level06', 'tiny'],
  ['level06', 'bigkid'],
] as const) {
  test(`stats() stay within budget during a celebration with effects (${level}, ${tier})`, async ({
    page,
  }) => {
    const errors = collectErrors(page);
    await bootToTitle(page);
    await page.evaluate(
      async ([id, t]) => {
        window.__tt.setTier(t as 'tiny' | 'bigkid');
        await window.__tt.loadLevel(id as string);
        window.__tt.autopilot = true;
      },
      [level, tier],
    );
    // Fast-forward through the finish to the celebration; the render loop then runs the effects.
    const r = await page.evaluate(() => window.__tt.fastForward(180, 'celebrating'));
    expect(r.state).toBe('celebrating');

    await page.waitForFunction(() => window.__tt.effects().particles > 0, undefined, {
      timeout: 15_000,
      polling: 'raf',
    });
    let peak = 0;
    const samples: Array<{ triangles: number; drawCalls: number; particles: number }> = [];
    for (let i = 0; i < 5; i++) {
      await frames(page, 2);
      samples.push(
        await page.evaluate(() => ({
          ...window.__tt.stats(),
          particles: window.__tt.effects().particles,
        })),
      );
    }
    for (const s of samples) {
      peak = Math.max(peak, s.particles);
      expect(s.triangles).toBeGreaterThan(0);
      expect(s.triangles).toBeLessThanOrEqual(MAX_TRIANGLES);
      expect(s.drawCalls).toBeGreaterThan(0);
      expect(s.drawCalls).toBeLessThanOrEqual(MAX_DRAW_CALLS);
      expect(s.particles).toBeLessThanOrEqual(MAX_QUADS);
    }
    expect(peak).toBeGreaterThan(0);
    console.log(`celebration stats ${level} ${tier}: ${JSON.stringify(samples.at(-1))}`);
    expect(errors).toEqual([]);
  });
}

test('a live balloon pop or checkpoint spawns effect quads', async ({ page }) => {
  const errors = collectErrors(page);
  await bootToTitle(page);
  await page.evaluate(async () => {
    window.__tt.setTier('tiny');
    await window.__tt.loadLevel('levelTest');
    window.__tt.autopilot = true;
  });
  // The first balloon is 19 m down the track; the live loop pops it and the burst appears.
  await page.waitForFunction(() => window.__tt.effects().particles > 0, undefined, {
    timeout: 90_000,
    polling: 'raf',
  });
  expect(errors).toEqual([]);
});

test.describe('prefers-reduced-motion', () => {
  test.use({ contextOptions: { reducedMotion: 'reduce' } });

  test('the celebration releases no confetti', async ({ page }) => {
    const errors = collectErrors(page);
    await bootToTitle(page);
    expect(await page.evaluate(() => window.__tt.effects().reducedMotion)).toBe(true);
    await page.evaluate(async () => {
      window.__tt.setTier('tiny');
      await window.__tt.loadLevel('levelTest');
      window.__tt.autopilot = true;
    });
    const r = await page.evaluate(() => window.__tt.fastForward(180, 'celebrating'));
    expect(r.state).toBe('celebrating');
    await frames(page, 10);
    // Static stars only: the big star is on screen, nothing flies.
    await expect(page.getByTestId('screen-celebrating')).toBeVisible();
    expect(await page.evaluate(() => window.__tt.effects().particles)).toBe(0);
    expect(errors).toEqual([]);
  });
});

test('confetti is on by default (no reduced-motion preference)', async ({ page }) => {
  await bootToTitle(page);
  expect(await page.evaluate(() => window.__tt.effects().reducedMotion)).toBe(false);
});

test('pressing a button with audio unlocked does not throw and keeps the flow intact', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await bootToTitle(page);
  // A real click on a button: unlocks audio on pointerup, plays the click, starts the level.
  await press(page, 'screen-title', 'play');
  await waitForState(page, 'playing');
  await page.waitForFunction(() => window.__tt.audio().state === 'running', undefined, {
    timeout: 10_000,
  });
  await frames(page, 5);
  expect(errors).toEqual([]);
});
