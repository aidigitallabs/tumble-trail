# Decisions

Dated entries for anything that deviates from or refines docs/PLAN.md.

## 31 Oct 2026 — Build location (temporary)
`aidigitallabs/tumble-trail` did not exist when the build started, so the game is being
built under `cc-ops/games/tumble-trail` on branch `ccr-c90fa07a-a1hn6q`. It is written as a
standalone project (own package.json, own `.github/workflows/`) so it can be moved with
`git subtree split --prefix=games/tumble-trail` once the repo exists. Until then the
workflows in `.github/workflows/` do not run (they are not at the cc-ops root) and the Pages
URL does not exist. Agents run the same checks locally instead.

## 31 Oct 2026 — Playwright
The build environment has Playwright 1.63.0 and Chromium 1243 preinstalled under
`/opt/pw-browsers`. `@playwright/test` is pinned to 1.63.0 and `npx playwright install` is
NOT run locally (CI runs it). `executablePath` is taken from `PLAYWRIGHT_CHROMIUM_PATH` when
set, otherwise the bundled browser is used.
