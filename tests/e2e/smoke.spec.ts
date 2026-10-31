import { expect, test } from '@playwright/test';

test('boots, renders with WebGL, simulates physics, and installs as a PWA', async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console: ${msg.text()}`);
  });
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('requestfailed', (req) => errors.push(`requestfailed: ${req.url()}`));

  await page.goto('/');

  // State reaches 'title' once the scene is running (RAPIER.init() + renderer done).
  await page.waitForFunction(() => window.__tt?.state === 'title', undefined, { timeout: 30_000 });

  // WebGL is real (SwiftShader in CI), not a stub.
  const rendererString = await page.evaluate(() => window.__tt.app.rendererString);
  expect(rendererString).toBeTruthy();

  // The loading screen has been dismissed.
  await expect(page.locator('#loading')).toHaveClass(/hidden/);

  // Physics ran: the ball dropped from 4 m and came to rest on the plane (centre ~0.5 m).
  await page.waitForFunction(
    () => {
      const b = window.__tt.ball();
      return b.pos[1] < 0.6 && Math.abs(b.vel[1]) < 0.05;
    },
    undefined,
    { timeout: 30_000 },
  );
  const rest = await page.evaluate(() => window.__tt.ball().pos[1]);
  expect(rest).toBeGreaterThan(0.4);

  // Something was drawn.
  const stats = await page.evaluate(() => window.__tt.stats());
  expect(stats.triangles).toBeGreaterThan(0);
  expect(stats.drawCalls).toBeGreaterThan(0);

  // Manifest is served and valid enough for installation.
  const href = await page.locator('link[rel="manifest"]').getAttribute('href');
  expect(href).toBeTruthy();
  const manifestRes = await request.get(new URL(href as string, page.url()).toString());
  expect(manifestRes.status()).toBe(200);
  const manifest = await manifestRes.json();
  expect(manifest.name).toBe('Tumble Trail');
  expect(manifest.display).toBe('standalone');
  expect(manifest.icons.length).toBeGreaterThanOrEqual(2);
  for (const icon of manifest.icons as Array<{ src: string }>) {
    const res = await request.get(
      new URL(icon.src, new URL(href as string, page.url())).toString(),
    );
    expect(res.status(), icon.src).toBe(200);
  }

  // Service worker registers and becomes ready on the preview build.
  const scope = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready;
    return reg.scope;
  });
  expect(scope).toContain('/');

  expect(errors).toEqual([]);
});
