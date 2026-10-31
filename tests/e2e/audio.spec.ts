import { expect, test, type Page } from '@playwright/test';
import { bootToTitle, openParentMenu, press, storedSave, waitForState } from './helpers';

function collectProblems(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (msg) => {
    // Warnings count too: an AudioContext created without a gesture only warns.
    if (msg.type() === 'error' || msg.type() === 'warning') {
      problems.push(`console ${msg.type()}: ${msg.text()}`);
    }
  });
  page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
  return problems;
}

test('no audio context and no console noise before the first gesture; running after one pointerup', async ({
  page,
}) => {
  const problems = collectProblems(page);
  await bootToTitle(page);
  // Let the title run for a while: the backdrop pops balloons silently.
  await page.waitForFunction(() => window.__tt.ball().t > 3, undefined, { timeout: 60_000 });
  expect(await page.evaluate(() => window.__tt.audio())).toEqual({ state: 'none', muted: false });
  expect(problems).toEqual([]);

  await page.mouse.click(512, 40);
  await page.waitForFunction(() => window.__tt.audio().state === 'running', undefined, {
    timeout: 10_000,
  });
  expect(problems).toEqual([]);
});

test('a touch pointerdown alone does not unlock; the pointerup does', async ({ page }) => {
  await bootToTitle(page);
  await page.mouse.move(512, 40);
  await page.mouse.down();
  expect(await page.evaluate(() => window.__tt.audio().state)).toBe('none');
  await page.mouse.up();
  await page.waitForFunction(() => window.__tt.audio().state !== 'none', undefined, {
    timeout: 10_000,
  });
});

test('the persisted mute flag reaches the audio engine', async ({ page }) => {
  await page.addInitScript(() => {
    try {
      localStorage.setItem(
        'tt.v1',
        JSON.stringify({
          version: 1,
          muted: true,
          lowGraphics: false,
          parentCardSeen: true,
          selectedBall: 0,
          balls: [0, 1, 2].map(() => ({ tier: 'tiny', unlocked: 1, currentLevel: 0, stars: {} })),
        }),
      );
    } catch {
      // Storage unavailable: nothing to seed.
    }
  });
  await page.goto('/');
  await waitForState(page, 'title');
  expect(await page.evaluate(() => window.__tt.audio().muted)).toBe(true);
});

test('the parent menu sound toggle changes audio().muted', async ({ page }) => {
  await bootToTitle(page);
  await openParentMenu(page);
  expect(await page.evaluate(() => window.__tt.audio().muted)).toBe(false);
  await press(page, 'parent-menu', 'sound-toggle');
  expect(await page.evaluate(() => window.__tt.audio().muted)).toBe(true);
  expect((await storedSave(page)).muted).toBe(true);
  await press(page, 'parent-menu', 'sound-toggle');
  expect(await page.evaluate(() => window.__tt.audio().muted)).toBe(false);
});
