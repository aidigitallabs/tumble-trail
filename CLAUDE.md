# Tumble Trail — instructions for Claude Code

- Spec of record: `docs/PLAN.md` (§16 phases, Appendix A prompt). Log deviations in `docs/DECISIONS.md`, progress in `docs/PROGRESS.md`.
- **Delegate to cheaper models.** The orchestrating session stays thin. Run build phases, reviews, test triage and bulk edits as subagents on **Sonnet**; polling (CI runs, deploy checks), lookups and summaries on **Haiku**. Use the top model only for judgement calls the cheaper models get wrong.
- Checks before any push: `npm run lint && npm run typecheck && npm run test:unit && npm run build && npm run test:e2e`. Never weaken or skip a test.
- E2E timing: the input lockout runs on game time; wait on `__tt.inputLocked()` / `data-ready`, never on fixed sleeps.
- Guardrails (PLAN §15): no ads, purchases, analytics, telemetry, outbound links, external assets; no references to other commercial games; no interactive elements during play; nothing that counts down or auto-advances.
