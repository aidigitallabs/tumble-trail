import { expect, test } from '@playwright/test';
import {
  autopilotToFinished,
  bootToTitle,
  bothCorners,
  openParentMenu,
  press,
  storedSave,
  touchCorners,
  waitForState,
  waitReady,
  waitInputReady,
} from './helpers';

// The gate needs two simultaneous touches: real touch events via CDP (a touch-enabled context).
test.use({ hasTouch: true });

test('parent gate: two corners held opens the menu and pauses the game; one corner or 1.5 s does not', async ({
  page,
}) => {
  await bootToTitle(page);
  await press(page, 'screen-title', 'play');
  await waitForState(page, 'playing');
  await waitInputReady(page);

  // 1.5 s with both corners: not enough.
  let lift = await touchCorners(page, bothCorners(page));
  await page.waitForTimeout(1500);
  expect(await page.evaluate(() => window.__tt.state)).toBe('playing');
  await lift();

  // One corner for a long time: never enough.
  lift = await touchCorners(page, [bothCorners(page)[0] as { x: number; y: number }]);
  await page.waitForTimeout(4000);
  expect(await page.evaluate(() => window.__tt.state)).toBe('playing');
  await lift();

  // Both corners for the full hold: the menu opens and physics pauses.
  await openParentMenu(page);
  expect(await page.evaluate(() => window.__tt.state)).toBe('parentMenu');
  const t0 = await page.evaluate(() => window.__tt.ball().t);
  await waitInputReady(page);
  expect(await page.evaluate(() => window.__tt.ball().t)).toBe(t0);

  // Resume continues the same level.
  await press(page, 'parent-menu', 'parent-resume');
  await waitForState(page, 'playing');
  await waitInputReady(page);
  expect(await page.evaluate(() => window.__tt.ball().t)).toBeGreaterThan(t0);
});

test('parent gate: a finger in a corner zone never steers or drives (Big kid holds to go)', async ({
  page,
}) => {
  await bootToTitle(page, { tier: 'bigkid' });
  await press(page, 'screen-title', 'play');
  await waitForState(page, 'playing');
  await waitInputReady(page);
  const t0 = await page.evaluate(() => window.__tt.ball().t);
  // (80, 80) is 113 px from the corner: inside the gate zone but past the 40 px edge rejection,
  // so without the gate this touch would drive the ball.
  const lift = await touchCorners(page, [{ x: 80, y: 80 }]);
  await page.waitForTimeout(1500);
  await lift();
  expect(await page.evaluate(() => window.__tt.ball().t)).toBeLessThan(t0 + 0.2);
});

test('parent gate works from the title, and Home returns to the title from anywhere', async ({
  page,
}) => {
  await bootToTitle(page);
  await openParentMenu(page);
  expect(await page.evaluate(() => window.__tt.state)).toBe('parentMenu');
  await press(page, 'parent-menu', 'parent-resume');
  await waitForState(page, 'title');

  await press(page, 'screen-title', 'play');
  await waitForState(page, 'playing');
  await autopilotToFinished(page);
  await openParentMenu(page);
  await press(page, 'parent-menu', 'parent-home');
  await waitForState(page, 'title');
});

test('parent menu: tier switch then loadLevel changes the track width; controls, FPS, version', async ({
  page,
}) => {
  await bootToTitle(page);
  await press(page, 'screen-title', 'play');
  await waitForState(page, 'playing');
  const tinyWidth = await page.evaluate(() => window.__tt.trackWidth());
  expect(tinyWidth).toBe(6);

  await openParentMenu(page);
  await waitReady(page, 'parent-menu');

  // Target sizes, no links, plain-text version, an FPS number.
  for (const id of [
    'parent-resume',
    'parent-home',
    'tier-tiny',
    'tier-bigkid',
    'sound-toggle',
    'lowgfx-toggle',
    'reset-slider',
  ]) {
    const box = await page.getByTestId(id).boundingBox();
    expect(box?.width, id).toBeGreaterThanOrEqual(88);
    expect(box?.height, id).toBeGreaterThanOrEqual(88 - 8); // slider outer box is 88 incl. border
  }
  expect(await page.locator('#ui a, #ui [href]').count()).toBe(0);
  await expect(page.getByTestId('version')).toHaveText(/^v\d+\.\d+\.\d+/);
  await expect(page.getByTestId('fps')).toHaveText(/^\d+$/);

  await expect(page.getByTestId('tier-tiny')).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('tier-bigkid').click();
  await expect(page.getByTestId('tier-bigkid')).toHaveAttribute('aria-pressed', 'true');
  expect((await storedSave(page)).balls[0]?.tier).toBe('bigkid');

  const bigWidth = await page.evaluate(async () => {
    await window.__tt.loadLevel(window.__tt.levelId());
    return window.__tt.trackWidth();
  });
  expect(bigWidth).toBe(3.5);
  expect(await page.evaluate(() => window.__tt.state)).toBe('playing');
  await expect(page.getByTestId('parent-menu')).toBeHidden();
});

test('parent menu: sound flag, low graphics (persist + reload), setup help, reset slider', async ({
  page,
}) => {
  await bootToTitle(page);
  await press(page, 'screen-title', 'play');
  await waitForState(page, 'playing');
  await autopilotToFinished(page);
  const before = await storedSave(page);
  expect(Object.keys(before.balls[0]?.stars ?? {}).length).toBe(1);

  await openParentMenu(page);
  await waitReady(page, 'parent-menu');

  // Sound on/off stores the flag only.
  await page.getByTestId('sound-toggle').click();
  expect((await storedSave(page)).muted).toBe(true);
  await page.getByTestId('sound-toggle').click();
  expect((await storedSave(page)).muted).toBe(false);

  // Setup help is reachable again from the menu.
  await page.getByTestId('parent-card-open').click();
  await expect(page.getByTestId('parent-card')).toBeVisible();
  await page.getByTestId('card-ok').click();
  await expect(page.getByTestId('parent-card')).toBeHidden();

  // A short drag does not reset; a full drag does.
  const track = (await page.getByTestId('reset-slider').boundingBox()) as {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  const thumb = (await page.getByTestId('reset-thumb').boundingBox()) as typeof track;
  const cy = thumb.y + thumb.height / 2;
  await page.mouse.move(thumb.x + thumb.width / 2, cy);
  await page.mouse.down();
  await page.mouse.move(thumb.x + thumb.width / 2 + track.width * 0.3, cy, { steps: 6 });
  await page.mouse.up();
  expect(Object.keys((await storedSave(page)).balls[0]?.stars ?? {}).length).toBe(1);

  await page.mouse.move(thumb.x + thumb.width / 2, cy);
  await page.mouse.down();
  await page.mouse.move(track.x + track.width, cy, { steps: 12 });
  await page.mouse.up();
  const after = await storedSave(page);
  expect(after.balls[0]).toMatchObject({ unlocked: 1, currentLevel: 0 });
  expect(Object.keys(after.balls[0]?.stars ?? { x: 1 })).toHaveLength(0);
  expect(after.balls[0]?.tier).toBe('tiny'); // the tier survives a progress reset

  // Low graphics persists and reloads the page.
  await Promise.all([page.waitForEvent('load'), page.getByTestId('lowgfx-toggle').click()]);
  await waitForState(page, 'title');
  expect((await storedSave(page)).lowGraphics).toBe(true);
});
