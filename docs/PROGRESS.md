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

## 31 Oct 2026 — Phase 1a: spline, track ribbon, progress (pure logic)

**Done**

- `src/game/Spline.ts`: centripetal Catmull-Rom, 4000-sample arc-length LUT, frames every 0.5 m
  (`pos`, `tangent`, `right = normalize(cross(tangent, worldUp))`, `up = cross(right, tangent)`,
  `arcM`), flat 6 m+ end pad, `finishM`.
- `src/game/Track.ts`: pure `buildRibbonGeometry(frames, width, wallMode, noWallSpansM, options)`
  returning `{ floor, walls }` (CCW floor with dashed vertex-colour stripe; full 1.5 m / low
  0.35 m / none walls; `noWallSpansM`; no walls for the last 2 m; end pad with side + back walls).
- `src/game/Progress.ts`: +/- 20 frame windowed tracker, `reseed`, monotone high-water `t`,
  `lateralOffset` (+ = viewer's right), checkpoint and finish events.
- `src/levels/schema.ts` (types per PLAN section 5 + rule-1 `validateLevel` stub),
  `levelTest.ts`, `index.ts` registry.
- `src/config/tuning.ts` (full per-tier table and the section 6 constants, with derived
  accelerations in comments; Phase 0 pixel-ratio entries kept), `src/config/brand.ts`.
- Unit tests: 65 tests in 6 files (spline 13, track 15, progress 14, levels 12, brand 6, tuning 5).
  Includes the hairpin fixture (a global nearest search provably _would_ jump legs there), ramp
  roll-back, reseed recovery, screen-right convention, wall modes / spans / winding, and the
  brand contrast test.
- Checks: `lint`, `typecheck`, `test:unit` (65/65), `build` and `test:e2e` (1/1, the Phase 0 smoke
  test) all pass. The Phase 0 scene is untouched.

**Skipped and why**

- Nothing from Phase 1a. Rules 2-7 of `validateLevel`, colliders, ball, input, camera, loop: later
  phases, as specified.

**PENDING HUMAN**

- PENDING HUMAN (carried over): move the project to `aidigitallabs/tumble-trail`, confirm CI is
  green there and Pages deploys; Pages URL on an iPad.

**Look at next (Phase 1b)**

- `buildRibbonGeometry(spline.frames, width, mode, spans, { finishM: spline.finishM, colors })`
  for the track, with `[]` spans for Tiny. Feed `buildColliders` from the same two geometries
  (they are non-indexed: build an index array 0..n-1 for Rapier's `TriMesh`).
- `Progress.update()` returns events; call `reseed(frameIndexAtArc(...))` on respawn.

**Plan inconsistencies found (plan not changed)**

- Section 5 pillar rule: `|offset| >= 1.2` and `|offset| <= width/2 - 0.9` is empty at the Big kid
  width of 3.5 m (upper bound 0.85), yet Appendix B puts a pillar at offset +1.2 in a Big kid
  level. Gate posts at +/- 1.4 (r 0.4) also overlap the 1.75 m half-width. Phase 2 must either
  widen Big kid, loosen the margin, or change the level briefs.
- Section 6 `maxSpeed` is not a reachable speed: with 0.2 /s driving damping the terminal speed is
  3.64 m/s (tiny) and 4.95 m/s (bigkid), not 4.0 / 5.5. Still inside the 12-60 s Big kid window
  (100 m in about 20-25 s).
- Section 5 `buildRibbonGeometry` has four parameters but also needs `finishM` and colours (see
  DECISIONS). "Walls outward-facing" cannot mean single sheets (invisible from inside the track).
- Section 5 rules 4 and 7 are ambiguous on the ends (is start-to-first-checkpoint and
  last-to-finish part of "spacing <= 30 m" / "1 per 25 m"?). `levelTest` satisfies the stricter
  reading including both ends.
- Section 9 asks for pastel balls but also 3:1 contrast against pastel track/stripe/sky; only
  saturated mid-dark balls pass (see DECISIONS). The contrast test covers `track`, `trackStripe`
  and `sky` only, not `wall`, `accent` or decor.
- Section 5 "start pad: a flat 3 m disc under frame 0" is listed under track conventions but is a
  Phase 2 task in section 16, so it is not in this phase.
