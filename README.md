# Tumble Trail

A free, ad-free rolling-ball obstacle course for a 3-year-old (and 5-8-year-old siblings),
played on iPads as a home-screen web app. No ads, purchases, accounts, analytics or network
calls beyond loading the app itself.

The full specification is in [`docs/PLAN.md`](docs/PLAN.md). Build progress is in
[`docs/PROGRESS.md`](docs/PROGRESS.md); decisions that refine the plan are in
[`docs/DECISIONS.md`](docs/DECISIONS.md).

## Install on an iPad

1. Open the game's web address in **Safari**.
2. Tap **Share**, then **Add to Home Screen**, then **Add**.
3. Launch it from the new home-screen icon. It runs full screen and works offline after the
   first launch.

Progress is stored in the home-screen app's own storage. Deleting the app and adding it again
**wipes progress**.

Use the iPad's hardware volume buttons to change the sound level or mute.

### Keeping little fingers inside the game (Guided Access)

1. Settings > Accessibility > Guided Access: turn it on and set a passcode.
2. Open Tumble Trail, then triple-click the top (or home) button.
3. Tap **Start**. Triple-click again and enter the passcode to leave.

## Develop

Requires Node 22 and npm.

```sh
npm ci
npm run dev            # dev server (service worker is not registered in dev)
npm run lint           # eslint + prettier --check
npm run typecheck
npm run test:unit      # vitest
npm run build          # tsc + vite build -> dist/
npm run preview        # serve dist/
npm run test:e2e       # builds, serves via vite preview, runs Playwright (Chromium)
npm run icons          # re-render public/icons/*.png with sharp (PNGs are committed)
```

### Base path

Vite's `base` comes from the `VITE_BASE` environment variable and defaults to `/`. GitHub Pages
serves a project site under a sub-path, so the deploy workflow builds with
`VITE_BASE=/tumble-trail/` (the service worker scope and manifest follow it).

### End-to-end tests

Playwright runs Chromium with software WebGL (`--use-angle=swiftshader
--enable-unsafe-swiftshader --ignore-gpu-blocklist`) against a production build served by
`vite preview`. CI installs the browser with `npx playwright install --with-deps chromium`. On a
machine where the bundled browser is not found, point `PLAYWRIGHT_CHROMIUM_PATH` at a Chromium
executable.

### Tuning

Every tunable number lives in `src/config/tuning.ts`.

## Deploy

Pushing to `main` runs `.github/workflows/pages.yml`: CI first, then a build with
`VITE_BASE=/tumble-trail/`, then a GitHub Pages deploy. The repository's Pages source must be
set to "GitHub Actions".
