import { expect, test } from '@playwright/test';

test('boots into levelTest, renders with WebGL, simulates physics, and installs as a PWA', async ({
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

  // Phase 1b boots straight into levelTest: boot -> playing once RAPIER.init(), the renderer and
  // the level are ready.
  await page.waitForFunction(() => window.__tt?.state === 'playing', undefined, {
    timeout: 30_000,
  });

  // WebGL is real (SwiftShader in CI), not a stub.
  const rendererString = await page.evaluate(() => window.__tt.app.rendererString);
  expect(rendererString).toBeTruthy();

  // The loading screen has been dismissed.
  await expect(page.locator('#loading')).toHaveClass(/hidden/);

  // Physics ran: Tiny always rolls, so the ball makes progress along the track by itself.
  await page.waitForFunction(() => window.__tt.ball().t > 1.5, undefined, { timeout: 30_000 });
  const ball = await page.evaluate(() => window.__tt.ball());
  expect(ball.pos[1]).toBeGreaterThan(0.3);
  expect(ball.pos[1]).toBeLessThan(1.5);
  expect(Math.abs(ball.lateral)).toBeLessThan(1);

  // Something was drawn.
  await page.waitForFunction(() => window.__tt.stats().triangles > 0, undefined, {
    timeout: 30_000,
  });
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
