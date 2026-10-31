import { expect, test } from '@playwright/test';
import {
  autopilotToFinished,
  bootToTitle,
  press,
  seedSave,
  storedSave,
  waitForState,
  waitReady,
  waitInputReady,
} from './helpers';

test('persistence: pick ball 2, reload, ball 2 is still selected', async ({ page }) => {
  await bootToTitle(page);
  await expect(page.getByTestId('ball-0')).toHaveAttribute('aria-pressed', 'true');
  await press(page, 'screen-title', 'ball-2');
  await expect(page.getByTestId('ball-2')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('ball-0')).toHaveAttribute('aria-pressed', 'false');
  expect((await storedSave(page)).selectedBall).toBe(2);

  await page.reload();
  await waitForState(page, 'title');
  await expect(page.getByTestId('ball-2')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('ball-0')).toHaveAttribute('aria-pressed', 'false');
});

test('first launch shows the parent card once; OK dismisses it for good', async ({ page }) => {
  await seedSave(page, { cardSeen: false });
  await page.goto('/');
  await waitForState(page, 'title');
  await expect(page.getByTestId('parent-card')).toBeVisible();
  expect((await storedSave(page)).parentCardSeen).toBe(false);
  await press(page, 'parent-card', 'card-ok');
  await expect(page.getByTestId('parent-card')).toBeHidden();
  expect((await storedSave(page)).parentCardSeen).toBe(true);
  await page.reload();
  await waitForState(page, 'title');
  await expect(page.getByTestId('parent-card')).toBeHidden();
});

test('title buttons meet the target sizes and there are no links', async ({ page }) => {
  await bootToTitle(page);
  for (const id of ['ball-0', 'ball-1', 'ball-2', 'play', 'levels']) {
    const box = await page.getByTestId(id).boundingBox();
    expect(box, id).not.toBeNull();
    expect(box?.width, id).toBeGreaterThanOrEqual(160);
    expect(box?.height, id).toBeGreaterThanOrEqual(160);
  }
  const play = await page.getByTestId('play').boundingBox();
  const grid = await page.getByTestId('levels').boundingBox();
  expect(play?.width ?? 0).toBeGreaterThan(grid?.width ?? 0);
  expect(await page.locator('#ui a, #ui [href]').count()).toBe(0);
  // No settings icon anywhere on the title: only the three balls, play and the level grid.
  expect(await page.locator('#ui button:visible').count()).toBe(5);
});

test('full run: title, play, every level, final celebration, play restarts at level 1', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console: ${msg.text()}`);
  });
  await bootToTitle(page);

  // Level select in Tiny: every level is open and nothing is locked. Count them.
  await press(page, 'screen-title', 'levels');
  await waitForState(page, 'levelSelect');
  const tileCount = await page.locator('[data-testid^="tile-"]').count();
  expect(tileCount).toBeGreaterThanOrEqual(1);
  expect(await page.locator('.tile.locked').count()).toBe(0);
  expect(await page.locator('.tile:disabled').count()).toBe(0);
  await press(page, 'screen-levels', 'levels-home');
  await waitForState(page, 'title');

  // Title play -> the first level.
  await press(page, 'screen-title', 'play');
  await waitForState(page, 'playing');
  const visited: string[] = [await page.evaluate(() => window.__tt.levelId())];
  expect(visited[0]).not.toBe('');

  for (let guard = 0; guard < tileCount + 2; guard++) {
    await autopilotToFinished(page);
    await expect(page.getByTestId('screen-finished')).toBeVisible();
    const final = await page.getByTestId('screen-finished').getAttribute('data-final');
    const stars = Number(await page.getByTestId('finished-stars').getAttribute('data-stars'));
    expect(stars).toBeGreaterThanOrEqual(2);

    await press(page, 'screen-finished', 'next');
    await waitForState(page, 'playing');
    const id = await page.evaluate(() => window.__tt.levelId());
    if (final === 'true') {
      // The last level's finish was the final celebration; play restarts at level 1.
      expect(id).toBe(visited[0]);
      break;
    }
    expect(visited).not.toContain(id);
    visited.push(id);
  }
  expect(visited).toHaveLength(tileCount);

  // Everything finished was recorded for ball 0.
  const save = await storedSave(page);
  expect(Object.keys(save.balls[0]?.stars ?? {}).sort()).toEqual([...visited].sort());
  expect(errors).toEqual([]);
});

test('celebrating ignores all input for 3 s, then Finished waits for a fresh press (no auto-advance)', async ({
  page,
}) => {
  await bootToTitle(page);
  await press(page, 'screen-title', 'play');
  await waitForState(page, 'playing');
  await page.evaluate(() => {
    window.__tt.autopilot = true;
    window.__tt.fastForward(180, 'celebrating');
  });
  expect(await page.evaluate(() => window.__tt.state)).toBe('celebrating');
  await expect(page.getByTestId('screen-celebrating')).toBeVisible();
  expect(await page.locator('#ui button:visible').count()).toBe(0);

  // Mash the screen: nothing happens while celebrating.
  for (const [x, y] of [
    [512, 384],
    [300, 500],
    [800, 200],
  ] as const) {
    await page.mouse.click(x, y);
  }
  await page.waitForTimeout(1200);
  expect(await page.evaluate(() => window.__tt.state)).toBe('celebrating');

  // After the 3 s it becomes Finished and then stays there: no auto-advance.
  await waitForState(page, 'finished', 8000);
  // A press that lands inside the 500 ms lockout does nothing (checked inside one page task so
  // the timing cannot flake).
  const stateAfterEarlyClick = await page.evaluate(() => {
    (document.querySelector('[data-testid="next"]') as HTMLButtonElement).click();
    return window.__tt.state;
  });
  expect(stateAfterEarlyClick).toBe('finished');
  await page.waitForTimeout(3500);
  expect(await page.evaluate(() => window.__tt.state)).toBe('finished');
  await waitReady(page, 'screen-finished');
  await page.getByTestId('next').click();
  await waitForState(page, 'playing');
});

test('finished: back arrow goes to level select, and the next level pulses there', async ({
  page,
}) => {
  await bootToTitle(page);
  await press(page, 'screen-title', 'play');
  await waitForState(page, 'playing');
  await autopilotToFinished(page);
  await press(page, 'screen-finished', 'to-levels');
  await waitForState(page, 'levelSelect');
  const tiles = await page.locator('[data-testid^="tile-"]').count();
  expect(Number(await page.getByTestId('tile-0').getAttribute('data-earned'))).toBeGreaterThan(0);
  if (tiles > 1) await expect(page.getByTestId('tile-1')).toHaveClass(/next/);
  // A tile starts its level immediately.
  await press(page, 'screen-levels', 'tile-0');
  await waitForState(page, 'playing');
});

test('Big kid: levels unlock one at a time and locked tiles are greyed out', async ({ page }) => {
  await bootToTitle(page, { tier: 'bigkid' });
  await press(page, 'screen-title', 'levels');
  await waitForState(page, 'levelSelect');
  const tiles = await page.locator('[data-testid^="tile-"]').count();
  await expect(page.getByTestId('tile-0')).toBeEnabled();
  if (tiles > 1) {
    await expect(page.getByTestId('tile-1')).toBeDisabled();
    await expect(page.getByTestId('tile-1')).toHaveClass(/locked/);
  }
  await press(page, 'screen-levels', 'tile-0');
  await waitForState(page, 'playing');
  // Big kid sees stars-so-far at the top centre; it is not interactive.
  await expect(page.getByTestId('hud-stars')).toBeVisible();
  expect(await page.locator('#ui button:visible').count()).toBe(0);
  await autopilotToFinished(page);
  expect((await storedSave(page)).balls[0]?.unlocked).toBe(Math.min(2, tiles));
  await press(page, 'screen-finished', 'to-levels');
  await waitForState(page, 'levelSelect');
  if (tiles > 1) await expect(page.getByTestId('tile-1')).toBeEnabled();
});

test('a killed app resumes at the title with play pointing at the next level', async ({ page }) => {
  await bootToTitle(page);
  await press(page, 'screen-title', 'levels');
  await waitForState(page, 'levelSelect');
  const tiles = await page.locator('[data-testid^="tile-"]').count();
  await press(page, 'screen-levels', 'levels-home');
  await waitForState(page, 'title');

  await press(page, 'screen-title', 'play');
  await waitForState(page, 'playing');
  const first = await page.evaluate(() => window.__tt.levelId());
  await autopilotToFinished(page);

  await page.reload(); // "killed" mid-Finished screen
  await waitForState(page, 'title');
  await press(page, 'screen-title', 'play');
  await waitForState(page, 'playing');
  const second = await page.evaluate(() => window.__tt.levelId());
  if (tiles > 1) expect(second).not.toBe(first);
  else expect(second).toBe(first);
});

test('playing shows a sweeping hand hint until the first touch, and nothing is interactive', async ({
  page,
}) => {
  await bootToTitle(page);
  await press(page, 'screen-title', 'play');
  await waitForState(page, 'playing');
  await expect(page.getByTestId('hint')).toHaveClass(/visible/);
  expect(await page.locator('#ui button:visible').count()).toBe(0);
  expect(await page.locator('#ui [tabindex], #ui a, #ui input').count()).toBe(0);
  await waitInputReady(page);
  await page.mouse.move(500, 400);
  await page.mouse.down();
  await expect(page.getByTestId('hint')).not.toHaveClass(/visible/);
  await page.mouse.up();
});

test('a single click or 1 s press anywhere during play leaves the state at playing', async ({
  page,
}) => {
  await bootToTitle(page);
  await press(page, 'screen-title', 'play');
  await waitForState(page, 'playing');
  await waitInputReady(page);
  const spots = [
    [512, 384],
    [100, 100],
    [10, 10],
    [1014, 758],
  ] as const;
  for (const [x, y] of spots) {
    await page.mouse.click(x, y);
    expect(await page.evaluate(() => window.__tt.state)).toBe('playing');
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.waitForTimeout(1000);
    await page.mouse.up();
    expect(await page.evaluate(() => window.__tt.state)).toBe('playing');
  }
});
