# Tumble Trail — handover, 31 Oct 2026

**Status:** Phases 0–4 built, merged and tested (plus Phase 5 if `PROGRESS.md` has a Phase 5 entry). Not yet on a real iPad.

## Play it

The game is live at https://aidigitallabs.github.io/tumble-trail/

On each iPad:

1. Open that address in **Safari**.
2. Tap **Share**, then **Add to Home Screen**, then **Add**.
3. Launch it from the new home-screen icon. It runs full screen and works offline after the
   first launch.

Progress lives in the home-screen app's own storage (deleting the app wipes it).

First launch shows the parent card (Guided Access + Add to Home Screen). Parent menu: hold the
**top-left and bottom-right corners together for 3 s**.

## Where the code is

https://github.com/aidigitallabs/tumble-trail — pushes to `main` run CI and redeploy Pages.

## What was verified by the agents (headless, no real iPad)

| Check                                | Result                                                                   |
| ------------------------------------ | ------------------------------------------------------------------------ |
| Lint / typecheck / build             | ✅                                                                       |
| Unit tests                           | ✅ 324                                                                   |
| End-to-end (Playwright, SwiftShader) | ✅ 36 incl. autopilot completing all 6 levels in both tiers with 0 falls |
| Triangles / draw calls per level     | ✅ ≤ 17 300 / 12 (budget 40 000 / 40)                                    |
| Bundle (gzipped)                     | ✅ 1.83 MB (budget 2.4 MB; Rapier physics is 1.65 MB of it)              |
| Code review pass on the engine       | ✅ 6 findings, all fixed with tests                                      |

## PENDING HUMAN — needs you and an iPad (`docs/IPAD_CHECKLIST.md`)

1. **Phase 3b tuning pass**: play all six levels in Tiny with the 3-year-old watching/playing,
   then Big kid yourself. Adjust `src/config/tuning.ts`. Specific things the agents flagged:
   the early bump on level 2, Big kid speed over bumps (3.7–4.3 m/s), parking feel on ramps,
   camera under the level 4 gate banner, the two downhills (levels 4 and 6) at Big kid speed,
   no kerb on level 3's final straight.
2. **Two drive models on `levelTest`**: Tiny is "always rolling, finger steers". If the
   3-year-old would rather "hold to go", flip `driveMode` for tiny in `tuning.ts`.
3. Parent gate can't be triggered one-handed; rings and card text read well; layouts in both
   orientations; wake lock keeps the screen on; audio after the first tap (Phase 5).
4. Child protocol (three separate sessions, adult silent, finishes level 1 within 3 min and asks
   to play again).

## Known plan deviations (all in `docs/DECISIONS.md`)

- No gaps in v1 (physically infeasible at toddler-safe speeds without a jump mechanic).
- `GameWorld.ts`, `MeshBuilder.ts`, `LevelView.ts`, `Contacts.ts`, `path.ts`, `flow.ts`,
  `ParentGate.ts` etc. are extra files beyond the plan's list — structure, not scope.
- Level 5's turns use radius 15 m (the brief said ≥ 10) to satisfy the validator.
- TypeScript 6.0.x (typescript-eslint does not yet accept 7.x).

## How to keep building

Open a new session on the repo and paste **Appendix A of `docs/PLAN.md`** with the phase to run
(Phase 6 = iPad hardening, driven by your checklist findings). Ideas for v1.1 are in
`docs/IDEAS.md`.
