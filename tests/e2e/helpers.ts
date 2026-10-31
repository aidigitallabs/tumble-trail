import { expect, type Page } from '@playwright/test';

export interface SeedOptions {
  /** Skip the first-launch parent card (default true). */
  cardSeen?: boolean;
  /** Tier of ball 0 (default 'tiny'). */
  tier?: 'tiny' | 'bigkid';
}

/**
 * Seeds `tt.v1` before the app boots, but only when nothing is stored yet, so a reload keeps
 * whatever the test did in between.
 */
export async function seedSave(page: Page, opts: SeedOptions = {}): Promise<void> {
  const save = {
    version: 1,
    muted: false,
    lowGraphics: false,
    parentCardSeen: opts.cardSeen ?? true,
    selectedBall: 0,
    balls: [
      { tier: opts.tier ?? 'tiny', unlocked: 1, currentLevel: 0, stars: {} },
      { tier: 'tiny', unlocked: 1, currentLevel: 0, stars: {} },
      { tier: 'tiny', unlocked: 1, currentLevel: 0, stars: {} },
    ],
  };
  await page.addInitScript((text) => {
    try {
      if (!localStorage.getItem('tt.v1')) localStorage.setItem('tt.v1', text);
    } catch {
      // Storage unavailable: the app falls back to memory.
    }
  }, JSON.stringify(save));
}

export async function bootToTitle(page: Page, opts: SeedOptions = {}): Promise<void> {
  await seedSave(page, opts);
  await page.goto('/');
  await waitForState(page, 'title');
}

export async function waitForState(page: Page, state: string, timeout = 30_000): Promise<void> {
  await page.waitForFunction((s) => window.__tt?.state === s, state, { timeout });
}

/** The visible screen's lockout is over: a press now counts. */
export async function waitReady(page: Page, testId: string): Promise<void> {
  await expect(page.getByTestId(testId)).toHaveAttribute('data-ready', 'true', {
    timeout: 10_000,
  });
}

/** The canvas input lockout (game time) is over: a pointer on the canvas now counts. */
export async function waitInputReady(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__tt?.inputLocked() === false, undefined, {
    timeout: 10_000,
  });
}

/** Wait for a screen's lockout, then click one of its buttons. */
export async function press(page: Page, screen: string, button: string): Promise<void> {
  await waitReady(page, screen);
  // force: pulsing tiles are never "stable" for Playwright's actionability check.
  await page.getByTestId(button).click({ force: true });
}

export async function storedSave(page: Page): Promise<{
  selectedBall: number;
  muted: boolean;
  lowGraphics: boolean;
  parentCardSeen: boolean;
  balls: Array<{
    tier: string;
    unlocked: number;
    currentLevel: number;
    stars: Record<string, number>;
  }>;
}> {
  return page.evaluate(() => JSON.parse(localStorage.getItem('tt.v1') ?? 'null'));
}

/** Autopilot the loaded level to the Finished screen (skips the 3 s celebration). */
export async function autopilotToFinished(page: Page): Promise<number> {
  const r = await page.evaluate(() => {
    window.__tt.autopilot = true;
    return window.__tt.fastForward(180, 'finished');
  });
  expect(r.state).toBe('finished');
  return r.seconds;
}

/**
 * Two simultaneous touches via the DevTools protocol (Playwright's touchscreen API is single-touch).
 * Needs a context with `hasTouch: true`. Returns a function that lifts both fingers.
 */
export async function touchCorners(
  page: Page,
  points: Array<{ x: number; y: number }>,
): Promise<() => Promise<void>> {
  const cdp = await page.context().newCDPSession(page);
  const touchPoints = points.map((p, i) => ({ x: p.x, y: p.y, id: i + 1 }));
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints });
  return async () => {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach();
  };
}

export function bothCorners(page: Page): Array<{ x: number; y: number }> {
  const v = page.viewportSize() ?? { width: 1024, height: 768 };
  return [
    { x: 12, y: 12 },
    { x: v.width - 12, y: v.height - 12 },
  ];
}

/** Hold both corners until the parent menu is up, then lift. */
export async function openParentMenu(page: Page): Promise<void> {
  const lift = await touchCorners(page, bothCorners(page));
  try {
    await expect(page.getByTestId('parent-menu')).toBeVisible({ timeout: 12_000 });
  } finally {
    await lift();
  }
}
