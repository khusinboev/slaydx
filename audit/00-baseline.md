# 00 — Baseline (before any audit change)

- **Date:** 2026-09-23
- **Branch:** `audit/production-readiness`, created from `main` @ `76ddf91` (working tree clean)
- **Toolchain:** Node v22.23.2, npm 10.9.8, Docker 29.1.3, PostgreSQL client 16.15; laptop 14 GB RAM / 12 cores
- **Method:** every heavy step ran sequentially through `scripts/heavy.sh` (cgroup-capped), per the project rule.
  Raw logs are in the session scratchpad, not in the repo.

## Results

| Check | Command | Result | Time |
|---|---|---|---|
| Lockfile ↔ node_modules | `npm ls --all` | ✅ consistent (rc 0) | 1 s |
| Clean install from lockfile | `npm ci --ignore-scripts` into a scratch copy of `package.json` + `package-lock.json` | ✅ rc 0 (npm cache warm) | 6 s |
| Typecheck | `npx tsc --noEmit` | ✅ 0 errors (incremental build info present) | 4 s |
| Lint | `npm run lint` | ✅ 0 errors, 0 warnings | 12 s |
| Unit tests | `npm test` (`--test-concurrency=2`, loads `.env.local`) | ⚠️ **2 637 / 2 639 pass, 2 fail**: both are the **known env-dependent failures** in `tests/document.test.mts` («fal.ai hisobni bloklasa rasm bosqichi buni hisobotga yozadi», «rasm va'dasi reja bilan bir xil songa asoslanadi»). Pexels/Pixabay keys in `.env.local` change which image chain the test takes; documented as Y-4 in `docs/AUDIT-11.md`. Not caused by this audit. | 121 s |
| Viewer tests | `npm run test:viewer` | ✅ 248 / 248 | 9 s |
| UI tests (jsdom) | `npm run test:ui` | ✅ 370 / 370 | 39 s |
| Production build | `npm run build` (`next build --turbopack`) | ✅ | 35 s |

**Build output worth noting:** first-load JS for `/uz/[slug]` (the tool workspace, 23 tools) is **513 kB**, and `/uz/files/[id]` (result viewer) is **428 kB**. The shared baseline is 148 kB.

## Does it start?

Start-up ran against a **fresh throwaway Postgres 16 container** (`slaydx-audit-pg`, `127.0.0.1:55439`), not the dev DB and never production.
`NODE_ENV=production`, `WORKER_INLINE=false`, and every paid or external key was blanked (Gemini, Anthropic, OpenRouter, xAI, OpenAI, fal, Pexels, Pixabay, OpenAlex, Google Books, Azure, Aisha, Click, Payme), so nothing could call a real provider.

| Step | Result |
|---|---|
| `next start` with **no** `TELEGRAM_BOT_TOKEN` | ❌ by design: `instrumentation.ts` throws «Konfiguratsiya to'liq emas: TELEGRAM_BOT_TOKEN yo'q». **But the process stays alive** and answers **500 to every request, `/api/health` included**, instead of exiting. Under Docker `restart: unless-stopped` that leaves a zombie web container: it doesn't crash, so it never restarts, and it serves nothing. (→ infra finding) |
| `next start` with a fake non-empty token | ✅ `/api/health` → **200** `{"status":"ok"}` 2 s after spawn, "Ready in 397 ms" |
| `GET /` | 307 → `/uz` |
| `GET /uz` | 200 (5 ms) |
| `GET /api/generations` without a session | 401 (correct) |
| Worker `npm run worker` on the fresh DB | ✅ applied all **21 migrations** (`001_init` … `021_games`) → 21 tables; logged `ishga tushdi (concurrency=2)`; on SIGTERM logged `to'xtatilmoqda...` (graceful stop) |

## Environment observations (inputs for auditors)

- The local dev DB is a Docker Postgres on `localhost:55432`. `.env.local` has `WORKER_INLINE=true`, so a plain `npm run dev` runs the queue inside the web process. That is the dev default. Production compose sets `WORKER_INLINE=false` and runs a separate `worker` container.
- The GitHub repository **`khusinboev/slaydx` is PUBLIC**. Everything ever committed is public, including this `audit/` directory once it is pushed. **Do not push `audit/findings/` before the fixes are deployed.**
- No CI configuration exists in the repo (no `.github/workflows`). Tests run only when a developer runs them locally.
