# Progress

One dated entry per phase.

## 31 Oct 2026 — Phase 0: scaffold, CI, deploy

**Done**

- Vite (vanilla-ts, written by hand into the existing directory), strict TypeScript, eslint +
  typescript-eslint, prettier, vitest, Playwright pinned to 1.63.0.
- Scripts: `dev`, `build`, `preview`, `lint`, `typecheck`, `test:unit`, `test:e2e`, `icons`.
- `index.html` and CSS per PLAN section 11 (viewport-fit, iOS web-app metas, touch-action, safe
  areas, non-passive touch guards); CSS bouncing-ball loading screen.
- `main.ts`: loading screen, `await RAPIER.init()`, three renderer with the pixel-ratio rule
  (`src/config/tuning.ts`), a two-tone sphere dropping onto a plane under Rapier. `window.__tt`
  has `state` (set to `'title'` once the scene runs), `stats()`, `ball()` and `app`.
- PWA: `vite-plugin-pwa` (prompt-style, not registered in dev), manifest, committed icons
  (192, 512, maskable 512, apple-touch 180). Verified a `VITE_BASE=/tumble-trail/` build rewrites
  the icon, manifest, asset, start_url and scope paths.
- Playwright config with the SwiftShader flags against `vite preview` of a production build. Smoke
  test: no console or page errors, no failed requests, real WebGL renderer string, state `title`,
  ball comes to rest on the plane (physics ran), triangles and draw calls non-zero, manifest fetch
  200 with valid fields and icons 200, `navigator.serviceWorker.ready` resolves.
- One trivial vitest (pixel-ratio rule).
- `.github/workflows/ci.yml` and `pages.yml` (with the permissions block), written as if the
  project is the repo root. They have not run (see DECISIONS: build location).
- Docs: `IPAD_CHECKLIST.md`, `README.md`.
- Bundle: JS 1,804.50 kB gzipped (4,872.62 kB raw), plus 2.2 kB workbox-window and 0.78 kB CSS;
  within the 2.4 MB budget.

**Skipped and why**

- "Green in CI": the workflows cannot run until the project lives in its own repo. All checks were
  run locally instead.

**PENDING HUMAN**

- PENDING HUMAN: Move the project to `aidigitallabs/tumble-trail` (`git subtree split
--prefix=games/tumble-trail`), confirm CI is green there and Pages deploys.
- PENDING HUMAN: Pages URL opens on an iPad and "Add to Home Screen" shows the icon.

**Installed versions**

three 0.187.0 (@types/three 0.187.0), @dimforge/rapier3d-compat 0.21.0, vite 8.3.5,
vite-plugin-pwa 2.0.0, vitest 5.0.5, @playwright/test 1.63.0, typescript 6.0.3, eslint 10.14.0,
typescript-eslint 8.72.1, prettier 3.9.10, sharp 0.35.5.

**Look at next**

- Phase 1a: pure logic (Spline, ribbon geometry, Progress, schema, levelTest, brand.ts).
- Replace the Phase 0 `App` smoke scene when Phase 1b starts; `tt.ts` already holds the `TT` type
  to extend.
- Headless SwiftShader renders the smoke scene at roughly 40 fps; `fastForward` must not depend on
  rendering.
