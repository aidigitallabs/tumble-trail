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

## 31 Oct 2026 — Phase 1b: ball, input, camera, loop, autopilot

**Done**

- `Track.buildColliders(world, geoms)`: floor and wall `TriMesh` colliders with
  `TriMeshFlags.FIX_INTERNAL_EDGES` (floor friction 0.8; walls friction 0, restitution 0.3) and the
  catch plane 10 m below the lowest frame.
- `Ball.ts`: dynamic body, `ball(0.5)`, explicit `setMass(1)`, friction 0.8, restitution 0.2, CCD on,
  angular damping 0.1, linear damping 0.2 driving / `brakeDamping` otherwise; quartered two-tone
  mesh with a back-face outline hull; blob shadow (floor-only raycast, polygonOffset, +2 cm);
  `applyControls` per PLAN section 6 (proportional drive, x1.5 uphill above 12 deg, lane-position
  controller, horizontal speed clamp at `maxSpeed x 1.3`, stuck counter).
- `GameWorld.ts` (see DECISIONS): the renderer-free simulation. Checkpoints and finish by the
  `Progress` high-water mark; fall (`y < frame.y - fallDepth`, `|lateral| > width`, catch plane) and
  stuck (driving and < 0.3 m/s for 3 s) trigger the 300 ms step-counted respawn (physics paused,
  input ignored, scale out/in, teleport to the last checkpoint frame `+ up x 1 m`, zero velocities,
  `reseed`, camera hard-snap). On finish `state = 'finished'` and physics stops.
- `Input.ts` (pointer: first pointer only with `setPointerCapture`, 40 px edge rejection, release on
  cancel / blur / hidden / resize, virtual origin, dead zone, `always` vs `hold` drive mode, still
  finger steer decay, 500 ms lockout + fresh pointerdown; keyboard ramp at 4/s), `Camera.ts`
  (smoothed horizontal tangent, `trackRise`, look-at ahead + 0.8 m, constant 75 deg horizontal FOV,
  hard-snap, no roll), `GameLoop.ts` (60 Hz accumulator, max 4 sub-steps, interpolated ball
  transform), `Autopilot.ts` (inside the step), full `__tt` contract in `App.ts` / `tt.ts`.
- Unit tests: 65 -> 104 tests in 11 files (new: determinism 2, gameworld 15, gameloop 4, input 13,
  camera 5, ...). Determinism: two 600-step autopilot runs of `levelTest` give identical `Progress`
  `t` / `arcM` / lateral after every step and an identical final position, in both tiers (Rapier
  initialised in Node).
- E2E (Playwright): smoke adapted (boot -> `playing`, ball makes progress), autopilot completes
  `levelTest` in Tiny and in Big kid via `setTier` / `loadLevel` / `autopilot` /
  `fastForward(budget, 'finished')`, `fastForward` early-return semantics, stats budget (both tiers,
  start / mid-run / finished), and real mouse input (Big kid only rolls while down, Tiny always rolls
  and steers right, edge-start ignored). 9 tests.
- Checks: `lint`, `typecheck`, `test:unit`, `build`, `test:e2e` all pass locally.
- Screenshots (headless SwiftShader, landscape and portrait) checked by eye: ball sits lower-middle,
  quarters and outline read, shadow sits under the ball, the camera follows the S-bend and ramps.

**Autopilot finish times on `levelTest` (simulated seconds, 0 respawns)**

- Tiny: 27.5 s (budget 120 s). Big kid: 20.6 s (window 12-60 s, budget 150 s).
- Terminal speeds measured on the flat: Tiny 3.55 m/s, Big kid 4.85 m/s (formula: 3.64 / 4.95).
  Peak on the ramp-down: Tiny 5.4, Big kid 6.3 m/s.

**Stats (`renderer.info`)**: 5,722 triangles, 5 draw calls (floor, walls, ball, outline, shadow);
budget 40,000 / 40. Bundle unchanged apart from a few kB of game code.

**Skipped and why**

- Nothing from Phase 1b. Not started, as specified: obstacles, decor, full validator, screens,
  audio, effects, the respawn vignette (Phase 5), wake lock (Phase 4), the start pad (Phase 2).
- "e2e green in CI": CI cannot run until the project has its own repo (see Phase 0). Run locally.

**PENDING HUMAN**

- PENDING HUMAN: Hand-feel on desktop and on an iPad, both drive modes, on `levelTest` with the
  3-year-old (Tiny) and a 5-8-year-old (Big kid), noted here: too fast / slow? camera comfort
  (distance, height, how it eases round the S-bend, the descent)? does the Big kid brake feel right
  (see "Look at next")? does a held finger in Tiny park the ball in a lane sensibly? To try it:
  `npm run dev` (boots into `levelTest` in Tiny; Big kid needs `__tt.setTier('bigkid');
await __tt.loadLevel('levelTest')` in the console until the Phase 4 parent menu exists).
  Arrow keys / WASD steer and Up / W / Space drive for desktop.
- PENDING HUMAN (carried over): move the project to `aidigitallabs/tumble-trail`, confirm CI green
  there and Pages deploys; Pages URL on an iPad.

**Look at next**

- Parking brake: with `brakeDamping 2.5` and angular damping 0.1 the ball does not truly hold on a
  15 deg ramp: it creeps back down at about 1 m/s (it rolls, so the angular velocity keeps feeding
  the linear velocity through friction). If the iPad feel says "slides back", raise
  `brakeDamping` or add a braking angular damping in `tuning.ts` (Phase 3b).
- The ramp-down gets the ball to 5.4 (Tiny) / 6.3 (Big kid) m/s; the plan's "bump is safe at
  <= 4 m/s" applies on the flat. Check `level04` / `level06` downhills in Phase 3.
- Phase 2: `GameWorld` is where obstacles and balloon proximity checks belong (inside `step`), and
  `autopilotControls(progress, width)` needs the repulsion term (it will need the obstacle list).
  Replace the arc-1 m spawn with the start pad.
- Phase 4: `App.setState` is the single place state changes (it already locks `Input`); screens
  hook in there. The rAF loop keeps stepping physics in `finished`, but `GameWorld.step` is a no-op.

**Plan inconsistencies found (plan not changed)**

- Section 6 says the parking brake makes the ball "hold on ramps"; with the specified numbers it
  creeps (see above).
- Section 4 `__tt` lists `app.renderer.getContext()` in section 13 smoke wording but Phase 0 settled
  on `app.rendererString`; the contract text in section 4 does not mention `app` at all.
- Section 13 e2e #2 says `fastForward(120, 'celebrating')` while Phases 1-3 say to assert `finished`;
  the Phase 1b task and this phase use `'finished'`.
- Section 16 / Appendix A say "one commit on `main`, push `main`"; this build lives on branch
  `ccr-c90fa07a-a1hn6q` inside `cc-ops` (see DECISIONS, build location).
- Section 6 dead zone: `clamp((x - origin) / range)` outside a 40 px dead zone makes steer jump from
  0 to about 0.24 at the dead-zone edge (range is about 170 px). Implemented literally; a rescale
  would be gentler for a toddler.
- Section 5 places the start pad under "Track conventions" but section 16 makes it a Phase 2 task;
  Phase 1b spawns the ball 1 m along the track instead.

## 31 Oct 2026 — Phase 2: track system complete

**Review fixes applied (Phase 1b code review, each with a unit test in `tests/unit/reviewfixes.test.ts`,
`input.test.ts` or `gameworld.test.ts`)**

1. `fastForward` advances `Input` time per step (`src/app/fastForward.ts`), so the lockout expires and
   keyboard steer ramps; a Big kid `hold` run with keyboard drive moves during a fast-forward.
2. `buildColliders` skips a collider with zero triangles (`walls: Collider | null`).
3. `makeFrame` falls back to the previous frame's `right` (world +X at frame 0) when the tangent is
   (anti)parallel to up; no NaN frames.
4. `Progress` clamps the projection to half a frame spacing and `arcM` to `[0, totalM]`.
5. `App.resize` no longer duplicates the viewport / release wiring (`Input.attach` owns it; tested).
6. `spline.tension` removed (dead key and argument).
7. Key state survives `release()` / `lock()` (gated by the lockout only); `clearKeys()` on blur / hidden.
8. Continuous dead zone; `brakeDamping` also as angular damping when not driving.
   Finding: the ball STILL creeps down a 15 degree ramp at about 0.74 m/s (was about 1 m/s). Damping is
   proportional to speed, so terminal creep = (5/7 g sin 15) / brakeDamping = 0.72 m/s; it can never
   hold a ball. See "look at next".

**Done**

- `validateLevel` with all 7 rules (`src/levels/schema.ts`), returns `{ ok, errors: [{ rule, message }] }`;
  35 unit tests (`validate.test.ts`), every rule has crafted failing levels; `levelTest` passes.
- Walls `full` / `low` / `none` + `noWallSpansM` wired from `LevelDef` and `TierTuning.wallMode`.
- Start pad (3 m disc, rear half in the floor mesh), ball spawns on it; end pad and back wall verified
  (a ball rolled into the back wall stays on the pad); finish arch (chequered) and checkpoint arches with
  flags that drop and spin when passed (`Arches.ts`, `LevelView.ts`).
- `Obstacles.ts`: bump, pillar, gate, balloon with the exact PLAN dimensions (verified by ray casts and
  vertex extents), tier-filtered, placed by `atM` / `offset` on the frame's `right`; balloons popped by
  the distance check inside `GameWorld.step`.
- Contact events (`Contacts.ts`): force events on the ball, new contacts only, floor ignored, <= 2/s, 1 s
  refractory per collider; `GameWorld.drainEvents()` returns `contact` (kind wall / pillar / gate /
  bump), `pop` and `checkpoint`.
- `Decor.ts` (seeded by level id, 8-16 m from the centreline, tested also on a track that curls back),
  sky + fog from the palette (already in `App`).
- Autopilot repulsion from pillar / gate posts (nearest group, 6 m ahead).
- `levelTest` converted: bumps, balloons, 2 pillars + 1 gate (Big kid), validates.
- Unit tests: 104 -> 206 in 16 files. E2E: 9 tests (the autopilot tests now also assert the obstacle
  counts and the balloons popped).
- Checks: `lint`, `typecheck`, `test:unit` (206/206), `build`, `test:e2e` (9/9) all pass locally.

**Autopilot finish times on `levelTest` (simulated seconds, 0 respawns, 0 pillar / gate contacts)**

- Tiny: 28.08 s (budget 120 s; Phase 1b was 27.5 s). Big kid: 21.13 s (window 12-60 s; was 20.6 s).
- Balloons popped by the autopilot, which only follows the centreline and does not seek them:
  Tiny 4 / 4, Big kid 4 / 4 (they are within 0.4 m of the centreline). The e2e asserts all 4 in Tiny and
  > = 1 in Big kid; the unit tests assert all 4 in both.

**Stats (`renderer.info`, decor on, both tiers)**: Tiny 12,728 triangles / 12 draw calls at the start,
12,344 / 11 later; Big kid 13,100 / 12 and 12,716 / 11. Budget 40,000 / 40. (Draw calls: floor, walls,
bumps, props, balloons, flags, 3 decor shapes, ball, outline, shadow.)

**Skipped and why**

- Nothing from Phase 2. Not started, as specified: levels 01-06 (Phase 3), screens, audio and
  confetti / pop sound (the pop is a visual scale burst only), `Effects.ts`.
- "e2e green in CI": CI cannot run until the project has its own repo (see Phase 0). Run locally.

**PENDING HUMAN**

- PENDING HUMAN: Look at `levelTest` on a real iPad in both tiers: do the pillars, gate, bumps and
  balloons read clearly and feel right (bump height at 5 m/s in Big kid, balloon pop distance, arch /
  flag size, decor density and colour on iPad GPU)? To try Big kid: `npm run dev`, then in the console
  `__tt.setTier('bigkid'); await __tt.loadLevel('levelTest')`.
- PENDING HUMAN (carried over): hand-feel on desktop / iPad of both drive modes (Phase 1b), move the
  project to `aidigitallabs/tumble-trail`, confirm CI green and Pages; Pages URL on an iPad.

**Look at next**

- Parking brake: damping cannot hold a ball on a ramp (creep 0.74 m/s at 15 degrees). If the iPad feel
  says "slides back" (Big kid), the fix is a rule, not a bigger number: e.g. below a small speed with no
  drive, zero the velocity or add friction-like resistance. Decide in Phase 3b.
- Camera vs gate banner: the banner hangs at 6.0-6.9 m and the camera is about 4.5 m above the floor
  (more when the track falls behind it). If a level climbs steeply within 7 m after a gate the camera
  can pass through the banner; keep gates followed by flat track in Phase 3 (level 4 has "gate on the
  plateau").
- Arches: the camera passes under the arch beams (7.5 m up). With the track climbing 15 degrees right
  after an arch the camera is at about 6.3 m: still under, but check on the ramp-up checkpoint.
- `levelTest` placement was constrained by the validator: pillars and gates need flat straights at least
  4 m from any bend tighter than 12 m. Level 3 (the 150 degree sweep, radius >= 12 m, which is exactly
  the limit) and level 5 (radius >= 10 m turns, pillars "on the outside of each turn") will need
  checking against rule 5; the plan's pillar placement there may not validate (see inconsistencies).
- Phase 3 can use `placeObstacles`, `validateLevel` and `LevelView` as they are; `App.loadLevel` needs no
  change for new levels. Phase 4 hooks `App.setState`; Phase 5 consumes `GameWorld.drainEvents()`.

**Plan inconsistencies found (plan not changed)**

- Section 7 says "no lintels" yet section 5 / 9 require checkpoint and finish arches (lintels over the
  track) and a gate banner; resolved by putting beams at 7.5 m and the banner at 6 m (above the camera),
  see DECISIONS.
- Section 5 pillar rule `|offset| <= width/2 - 0.2` allows a pillar centre 0.2 m inside the Big kid
  wall's inner face at offset 1.55 (the post then covers the whole narrow side, 1.15-1.95 m vs the track
  edge at 1.75 m). That is the intended "go the other way" but the text calls the wide side "always
  1.6 m" (it is 2.9 m there, 1.95 m at offset 0.6). Consistent, just worth knowing.
- Section 5 rule 5 (pillars / gates 4 m from a frame with radius < 12 m) combined with Appendix B level 5
  ("pillars on the outside of each turn", turn radius >= 10 m) and level 3 (sweep radius >= 12 m, i.e.
  right at the limit): any pillar within 4 m of a 10 m-radius turn fails the validator, so the level-5
  brief cannot be authored literally; Phase 3 will have to place those pillars on the straights next to
  the turns or relax rule 5. Reported, not decided.
- Section 5 says a balloon "floats 1.2 m above the floor" and pops at < 1.1 m: if 1.2 m were the sphere's
  bottom (centre at 1.7 m) a ball on the floor could never pop it; implemented as the centre at 1.2 m.
- Section 5 rule 3 "no wall ribbon self-intersection" is only defined informally; implemented as a
  plan-view separation test (see DECISIONS).
- Section 4 `Effects.ts` / `Audio.ts` do not exist yet (Phase 5); `GameWorld.drainEvents()` is the
  plumbing they will use.

## 31 Oct 2026 — Phase 3: six levels, parking rule

**Done**

- **Parking rule** (`tuning.ball.parkSpeed = 0.6`, `Ball.applyControls`): not driving and slower than
  0.6 m/s along the surface -> stop dead (tangent / sideways velocity and spin zeroed; the vertical
  component is kept so a dropping ball still falls). On `levelTest`'s 15 degree ramp, released
  mid-ramp, both tiers are below `parkSpeed` within 2 s and then hold with an arc-mark range of 0 over
  the next 6 s (`tests/unit/levelsParking.test.ts`, 5 tests, deterministic). Replaces the 0.74 m/s
  creep measured in Phase 2.
- **`level01`-`level06`** (`src/levels/level0N.ts`, registered in order in `src/levels/index.ts`,
  `levelTest` after them; `shippedLevels` / `testLevels` also exported). All pass `validateLevel`.
  A small route builder, `src/levels/path.ts` (straights, eased arcs, height ramps -> control points),
  authors them; the `LevelDef`s are still plain point lists.
- **Unit tests** `tests/unit/levelsShipped.test.ts` (56): registry order, names / palettes, per level
  `validateLevel` (errors printed on failure), 80-120 m, Tiny kinds and balloon spacing, no bump on or
  within 12 m after a descent, 8 m flat after every gate, autopilot finish with 0 respawns and the
  bump speed (Tiny <= 4.5 m/s) in both tiers, Big kid window, the Appendix B shape of each level, the
  path builder. 206 -> 267 unit tests in 18 files.
- **E2E** `tests/e2e/levels.spec.ts` (12): every level x tier, `setTier`, `loadLevel`, autopilot,
  `fastForward(150, 'finished')`, state `finished`, no respawn (see DECISIONS for how it is counted),
  Big kid time in [12, 60] s, stats (start / middle / end) <= 40 000 tris and <= 40 draw calls, no
  console errors. 9 -> 21 e2e tests.
- Checks: `lint`, `typecheck`, `test:unit` (267/267), `build`, `test:e2e` (21/21) all pass locally.

**Per-level table** (autopilot seconds from the e2e run; the unit run differs by < 0.2 s because the
live loop steps a few frames before the fast-forward starts; respawns are 0 everywhere in both)

| #   | Level            | Length  | Max slope | Min radius | Checkpoints | Tiny s | Big kid s | Tiny tris / draws | Big kid tris / draws |
| --- | ---------------- | ------- | --------- | ---------- | ----------- | ------ | --------- | ----------------- | -------------------- |
| 1   | Meadow Roll      | 83.0 m  | 0.0       | 14.6 m     | 3           | 23.7   | 17.7      | 12 372 / 11       | 11 940 / 11          |
| 2   | Little Hills     | 90.3 m  | 10.3      | 13.7 m     | 4           | 26.1   | 19.7      | 12 448 / 12       | 12 100 / 12          |
| 3   | Seaside Sweep    | 100.0 m | 0.0       | 13.7 m     | 4           | 28.3   | 21.2      | 13 822 / 11       | 12 298 / 11          |
| 4   | Up in the Clouds | 100.9 m | 16.7      | 13.6 m     | 4           | 28.1   | 21.0      | 13 186 / 11       | 12 714 / 11          |
| 5   | Zigzag Beach     | 110.0 m | 0.0       | 13.7 m     | 4           | 31.8   | 23.7      | 15 566 / 12       | 14 998 / 12          |
| 6   | Big Sky Finale   | 117.3 m | 10.3      | 13.6 m     | 5           | 32.6   | 24.4      | 17 290 / 12       | 16 186 / 12          |

Slope is the steepest frame-to-frame slope in degrees (rule 2 allows 20); radius is the tightest plan
view turning radius the validator sees (rule 3 needs >= 6 Tiny / 3.5 Big kid; rule 5 needs >= 12 near
posts). Balloons (Tiny / Big kid): 8/5, 7/4, 12/6, 10/5, 9/4, 14/5, all popped by the autopilot (it
only follows the centreline). Tiny autopilot speed at bumps: 2.9-3.0 m/s; Big kid 3.7-4.3 m/s (its flat
terminal speed). Fastest points: the level 4 descent (Tiny 5.4, Big kid 6.8 m/s) and level 6 downhill
(Tiny 4.7, Big kid 5.7); no bump or post is on or within 10 m after either.

**Skipped and why**

- Nothing from Phase 3. Not touched, as instructed: `App.ts`, screens, persistence, CSS, `main.ts`,
  `tt.ts`. "e2e green in CI" is still local-only (no repo yet, see Phase 0).

**PENDING HUMAN**

- PENDING HUMAN: Phase 3b tuning pass. Play all six levels on the oldest iPad in both tiers, the
  3-year-old on Tiny, adjust `tuning.ts` and record before / after and observations per level here.
  Specifically look at: (a) Tiny feel of the early bump (level 2 at 6 m) and balloon density, (b) Big
  kid bump speed (4+ m/s, above the plan's 4 m/s comfort figure), (c) the parking rule: does a lifted
  finger on a ramp feel like "brake", (d) camera vs the gate banner on level 4, (e) camera under the
  checkpoint arch at 11 m of level 4 (the track starts climbing at 12 m), (f) the level 4 and 6
  downhills at Big kid speed, (g) level 3 with no kerb on the final straight (Big kid), (h) pillars
  inside the bends of levels 5 and 6.
- PENDING HUMAN (carried over): Phase 1b / 2 hand-feel, moving the project to
  `aidigitallabs/tumble-trail`, CI green there, Pages URL on an iPad.

**Look at next**

- Phase 4 should list `shippedLevels` (not `levels`) in the level select; `levels` still ends with
  `levelTest`.
- Autopilot times are a completability proxy: a 3-year-old will take 1-3 min on a 25-32 s Tiny run.
- The Tiny levels are not harder than each other by construction (one new thing each); if the iPad
  pass wants a difficulty curve, widen the Big kid obstacle set rather than Tiny's.
- Rule 3's radius check is noisy to about 1 m on a ~15 m arc (frame spacing 0.5 m); a design radius
  of 15 measures >= 13.6. If a later level needs tighter turns with posts, raise the frame sampling
  for the radius estimate rather than the level.

**Plan inconsistencies found (plan not changed)**

- Appendix B level 5: "pillars on the outside of each turn" and "radius >= 10" cannot both pass
  rule 5 (posts >= 4 m from any radius < 12 m); resolved with 15 m turns, pillars in the turns.
  Level 3's "radius >= 12" is at exactly rule 5's limit, so the measured 12.x dips of a 13 m design
  would fail near a gate; the sweep is 15 m.
- Appendix B level 4 ("1 gate on the plateau") plus section 7's no-clipping guarantee: the gate
  banner needs flat track after it; the plan does not say so (the lead's brief did: 8 m; shipped 10).
- Section 5 says a bump is "safe at <= 4 m/s"; the Big kid tier runs at 4.1-4.3 m/s on the flat
  (terminal 4.95) so every Big kid bump is above it. Nothing broke in the autopilot runs.
- Section 6 says the brake makes the ball "hold on ramps"; it takes the parking rule to actually do so.
- Section 13 e2e #2 (`celebrating`) vs Phase 3's `finished`: kept `finished`, as in earlier phases.
- Section 13 e2e #2/#3 do not provide a way to count respawns; `__tt` has no counter.

## 31 Oct 2026 — Phase 4: screens, flow, persistence, parent gate

**Done**

- `Screens.ts` (all screens in PLAN section 8, inline SVG icons, 160 px play targets / 88 px parent
  targets from `tuning.ui`, `touch-action: manipulation` on overlay buttons, safe-area insets):
  Title (three ball-character buttons, highlighted choice recolours the backdrop ball at once, huge
  play, grid icon; backdrop = first playable level on the autopilot, no HUD), Level select (glyph +
  palette colour tiles, stars earned, next tile pulses; Tiny all open, Big kid sequential with greyed
  locked tiles), Playing (no interactive element; Big kid stars-so-far top centre; idle hand hint at
  level start and after 4 s / 8 s), Celebrating (3 s, input ignored, CSS confetti placeholder),
  Finished (stars light up one by one, huge next, back arrow, no auto-advance, bigger celebration and
  restart at level 1 after the last level), Parent menu (resume / home, per-ball tier, sound flag, low
  graphics + reload, drag-to-confirm reset, Guided Access text, FPS, version, no links), Parent card
  (first launch, dismissible, reachable from the menu).
- Parent gate (`ParentGate.ts` + window capture listeners in `Screens.ts`): two corners, 3 s, 120 px,
  fill rings; works from every state after boot; gate pointers never reach `Input`.
- State machine in `App.ts` driven by the pure table in `flow.ts`; next level unlocked on the finish
  event; `parentMenu` pauses physics; SW update applied only on the title (`updateGate.ts`).
- `Persistence.ts` (`tt.v1`, versioned, try/catch, in-memory fallback, never overwrites a newer
  version), per-ball profiles, resume at the title with play at `currentLevel`.
- Wake lock during play, FPS readout, low-graphics toggle (dpr 1, no MSAA, reload), version string.
- `__tt`: `state` is the real machine; `loadLevel` still bypasses title / celebration; `fastForward`
  with `until: 'finished'` and `'celebrating'` both work; new `levelId()`.
- Unit tests: 206 -> 263 (persistence, flow, parent gate, level list, update gate, wake lock, UI
  tuning). E2E: 9 -> 24 (persistence, first-launch card, target sizes, full run over the whole
  registry, celebration lockout and no auto-advance, level select / Big kid unlock, resume, hint and
  no interactive elements in play, single click / 1 s press anywhere during play, real two-finger gate
  holds, menu controls incl. tier switch then `loadLevel` changing `trackWidth()`, reset slider, low
  graphics). Existing specs only changed their boot wait (`title`) and call `loadLevel` where needed.
- Checks (in the worktree): `lint`, `typecheck`, `test:unit` (263/263), `build`, `test:e2e` (24/24,
  about 2.4 min) all green.

**Skipped and why**

- Real confetti, fanfare, star-tick sounds, sound on/off effect: Phase 5 (the CSS burst and the `muted`
  flag are placeholders).
- Service-worker update path is unit tested (`UpdateGate`) but not e2e tested: a preview build has no
  second version to find.

**PENDING HUMAN**

- PENDING HUMAN: on an iPad, check the parent gate (two thumbs in opposite corners for 3 s) cannot be
  triggered one-handed, rings are visible, and that Guided Access + the parent card text read well.
- PENDING HUMAN: check the title / level-select / finished layouts on the real iPad sizes in both
  orientations (checked here only at 1024x768; the title switches to a row layout under 640 px height).
- PENDING HUMAN: wake lock really keeps the screen on in the home-screen app (iOS may need a user
  gesture; failures are silently ignored).

**Look at next**

- Phase 5 hooks: `Screens` buttons have no sound yet; `App.setMuted` stores `muted`; the celebration is
  driven from `App.onSimFinished` / the `celebrating` state.
- Phase 3 merge: `levelList.ts` drops `levelTest` from the game when other levels exist; if the other
  agent changes the registry's shape the only coupling is `playableLevels(levels)` in `App.ts`.
- The tier defaults are all Tiny; Nick may prefer ball 2 / 3 to start as Big kid.

**Plan inconsistencies found (plan not changed)**

- Section 8 says the Level select "Tiny: all open ... locked tiles are not rendered in Tiny", which is
  vacuous (nothing is locked in Tiny); implemented as "never drawn".
- Section 13 test 5 says "a single 1 s press does nothing (state unchanged)"; the Phase 4 done-when says
  state stays `playing`. Same thing, tested both for a mouse press and a single-touch corner press.
- Section 8's wake lock "during play" and iOS's user-gesture rule can conflict; ignored on failure.
- Section 16 Phase 4 lists "title -> ball -> level 1": the ball choice is a highlight on the title, not
  a separate step, so a run is title -> play.
