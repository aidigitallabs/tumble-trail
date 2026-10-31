# Handoff prompt — organise Tumble Trail on GitHub

Paste everything below the line into a new Claude Code session opened on your local `cc-ops`
clone, with GitHub access (`gh auth status` should show you logged in with repo + workflow +
pages scopes).

---

You are taking over a project that was built in a cloud session without GitHub repo-creation
rights. Your job is to **organise it properly on GitHub**, not to change the game.

## What exists

- **Tumble Trail**: an original, ad-free rolling-ball obstacle-course web game (Vite + TypeScript +
  three + Rapier, PWA) for a 3-year-old and her siblings to play on iPads.
- It lives as a standalone project at `games/tumble-trail/` inside the `aidigitallabs/cc-ops`
  repo, on branch **`ccr-c90fa07a-a1hn6q`** (already pushed to origin). It has its own
  `package.json`, `.github/workflows/ci.yml` and `pages.yml` (written for repo-root, so they are
  inert inside cc-ops), tests, and docs.
- Read these first, in this order: `games/tumble-trail/docs/HANDOVER.md`,
  `games/tumble-trail/docs/PROGRESS.md`, `games/tumble-trail/docs/DECISIONS.md`, and §16 +
  Appendix A of `games/tumble-trail/docs/PLAN.md`.
- The full design spec also lives at `specs/2026-10-31-tumble-trail-v1-plan.md` in cc-ops (same
  content as `docs/PLAN.md`).
- Checks that were green at handover, run from `games/tumble-trail`: `npm ci`, `npm run lint`,
  `npm run typecheck`, `npm run test:unit` (324), `npm run build`, `npm run test:e2e` (36,
  Playwright/Chromium, ~3–9 min).

## Do this, in order

1. **Fetch and verify.**
   `git fetch origin && git checkout ccr-c90fa07a-a1hn6q`. In `games/tumble-trail` run
   `npm ci && npm run lint && npm run typecheck && npm run test:unit && npm run build`. If
   anything is red, stop and report; do not "fix" the game.

2. **Create the repo.**
   `gh repo create aidigitallabs/tumble-trail --public --description "Tumble Trail — an ad-free rolling-ball game for small kids on iPad"`
   (no README, no licence, no .gitignore template — the project brings its own). Do not add
   topics or settings beyond what is listed here.

3. **Move the project with its history.**

   ```
   git subtree split --prefix=games/tumble-trail -b tumble-trail-main
   git push https://github.com/aidigitallabs/tumble-trail.git tumble-trail-main:main
   ```

   Then clone the new repo somewhere separate and confirm `docs/`, `src/`, `.github/workflows/`,
   `public/icons/*.png` (four files) and `package-lock.json` are all present at the root.

4. **Enable Pages via Actions.**
   `gh api -X POST repos/aidigitallabs/tumble-trail/pages -f build_type=workflow`
   (if it already exists, `-X PUT` with the same field). Confirm `gh api repos/aidigitallabs/tumble-trail/pages`
   shows `build_type: workflow`.

5. **Make CI and the deploy green.**
   Watch the first `pages.yml` run (`gh run list --repo aidigitallabs/tumble-trail`,
   `gh run watch`). It builds with `VITE_BASE=/tumble-trail/`, runs CI (lint, typecheck, unit,
   build, Playwright e2e with `npx playwright install --with-deps chromium`), then deploys.
   If it fails for **infrastructure** reasons (permissions block, Playwright install, runner
   Node version, Pages not enabled), fix the workflow and push to `main`. If it fails because a
   **test** fails, do not weaken or skip the test — report it instead. Finish with the live URL
   `https://aidigitallabs.github.io/tumble-trail/` returning the game (check the title screen
   loads and `manifest.webmanifest` and `sw.js` return 200).

6. **Update the docs in the new repo** (one commit on `main`):
   - `docs/DECISIONS.md`: append a dated entry under the "Build location (temporary)" entry
     saying the project moved to `aidigitallabs/tumble-trail` on <today>, CI and Pages are live.
   - `docs/HANDOVER.md`: replace the artifact link section with the Pages URL and the
     "Add to Home Screen" steps; delete the "Move it to its own repo" section.
   - `README.md`: make sure the install steps point at the Pages URL.

7. **Tidy cc-ops** (branch `ccr-c90fa07a-a1hn6q`, then a PR — do not push to `main`
   directly and do not merge the PR yourself):
   - `git rm -r games/tumble-trail` (the project now lives in its own repo). Keep the
     `.gitignore` line `.claude/worktrees/`.
   - Add one line at the top of `specs/2026-10-31-tumble-trail-v1-plan.md` under the status:
     `**Code:** https://github.com/aidigitallabs/tumble-trail — live at https://aidigitallabs.github.io/tumble-trail/`
   - Open a PR from `ccr-c90fa07a-a1hn6q` to `main` titled
     `specs: Tumble Trail v1 plan (game moved to its own repo)`. Body: two lines on what it
     contains and the link to the new repo.

8. **Phase 5 check.** Open `docs/PROGRESS.md` in the new repo. If there is **no** "Phase 5"
   entry (synthesised audio, confetti, squash, reduced-motion), run Phase 5 using the prompt in
   Appendix A of `docs/PLAN.md` with `<PHASE>` = 5, in the new repo, as its own commit on `main`,
   and let CI confirm it. If a Phase 5 entry exists, skip this.

9. **Report back** with: new repo URL, Pages URL (confirmed loading), CI run link, cc-ops PR
   link, whether Phase 5 was already there or you ran it, and anything you could not finish.

## Rules

- Never rewrite history on `cc-ops/main` or force-push anywhere. `git subtree split` creates a
  new branch; it does not alter existing ones.
- No changes to game code except workflow/infrastructure fixes in step 5 and the Phase 5 work in
  step 8. Anything else you notice goes into `docs/IDEAS.md` or the report.
- The game's guardrails apply to you too: no ads, analytics, telemetry, outbound links,
  third-party scripts or external assets, and no references to any existing commercial game.
- Ask before doing anything destructive beyond `git rm -r games/tumble-trail` on the feature
  branch.
