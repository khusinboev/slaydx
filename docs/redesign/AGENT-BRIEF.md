# Common rules — redesign packages (F0, W1–W5)

Repo `/home/adhambek/projects/pythons/slaydbot/slaydx`. You work in YOUR OWN git worktree on branch `wip/rd-<pkg>` created from `main`
(first `git merge --no-edit main` if your base is older). Read `CLAUDE.md` (project rules: heavy.sh, jsdom rule, testing standard, Uzbek UI copy),
`docs/redesign/PLAN.md` (decisions + your package row) and `docs/redesign/R1-inventory.md` — this file lives in the repo so it survives (scratchpad/tmp is wiped between sessions) and, for UI, `docs/mobile/PLAN.md` + `docs/viewer/PLAN.md`.

## !! Production safety (auto-deploy is ON)
`main` auto-deploys to production within minutes of a push. You NEVER push, NEVER merge into main, NEVER touch GitHub settings or the
production server. The lead merges after independent review. Commit only on your branch (small commits, each ending with
`Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`).

## File ownership
Edit ONLY the files your package owns (PLAN row) + new files in your own dirs/tests. Need a change elsewhere (or a contract change)? Do not edit —
write the request in your report.

## DB / runtime safety
Test Postgres only: `psql postgres://slaydx:slaydx@127.0.0.1:55440/postgres -c "DROP DATABASE IF EXISTS slaydx_rd<n>" -c "CREATE DATABASE slaydx_rd<n>"`,
then `export DATABASE_URL=postgres://slaydx:slaydx@127.0.0.1:55440/slaydx_rd<n>`. NEVER `.env.local`, port 55432 or 5432. Dev server only with
`WORKER_INLINE=false TELEGRAM_BOT_TOKEN=` on your port (F0 3250, W1 3251, W2 3252, W3 3253, W4 3254, W5 3255), ONE dev server at a time, stop it right after the
smoke (kill by PID, never a pkill pattern matching your own shell). No real Telegram/LLM/payment calls (stub fetch, fake token).
Synthetic data only; phones only +998901234567, +998901112233; no server IPs/tokens in the repo (use `<SERVER_IP>`).

## Heavy commands
ONLY via `scripts/heavy.sh`, one at a time; single test files, never the full suite (CI runs it on the PR). jsdom: never `assert.equal(el, null)` /
`deepEqual` on DOM nodes — use `assert.ok(!el)`. The laptop RAM is tight (14 GB, swap in use): short runs, stop servers.

## Quality bar
- Code/comments/commits English; user-facing UI copy Uzbek (Latin, with the ʻ/’ the codebase uses). No TODO/FIXME/mock data in product code; no new dependency.
- Never weaken/skip/delete tests; if a locked old behaviour changes, rewrite that assertion to the new contract with equal strength and list before → after.
- Mutation-check every important new assertion (break the code, see the test fail, restore) and list them.
- UI work: Playwright + Chromium smoke in the Telegram Mini App stub (approach: scratchpad smoke-kit `tgapp.cjs` if present; otherwise write a minimal stub:
  `window.Telegram.WebApp`, `TelegramWebviewProxy`) at 360×740 and 390×844 (isMobile, hasTouch, DPR 3) + 1366×768, light and dark; launch Chromium with
  the repo helper `scripts/smoke/gpu-launch.cjs` (`launchGpu(chromium, {executablePath})`, playwright-core from the smoke kit or `npx`; Chromium at
  `~/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome`). No horizontal overflow, targets ≥ 44 px for what you add, phone back closes your overlays
  first. LOOK at your screenshots. If a command is denied by the permission classifier, do not retry it another way — note it in the report.
- Typecheck (`scripts/heavy.sh npx tsc --noEmit -p .`) and eslint on changed files must be clean.

## Report (≤ 250 words)
Commits, files, behaviour per requirement, tests run (file + counts), changed assertions, mutation checks, smoke results + screenshot paths, what was NOT
done/verified, contract change requests.

## Redesign specifics
- Base your branch on `feat/redesign` (NOT main): `git merge --no-edit feat/redesign` first if needed. The lead merges packages into `feat/redesign`.
- Visual reference: the approved mockup variant A (link in PLAN.md) — floating rounded bar, raised «+», warm cards, gradient balance hero.
  Design BOTH themes (light cream/amber, dark warm-black/amber); check both in screenshots.
- Use the F0 primitives (`PageHeader`, tokens `--accent-soft`, `--hero`, motion classes, `--tabbar-h`) instead of re-inventing.
- Text: +1–2 px vs today in your files (body 15.5–16 px, secondary ≥ 13 px, nothing below 12.5 px). Never touch viewer/document rendering.
- Every interactive target ≥ 44 px on touch; visible focus ring; reduced-motion respected.
