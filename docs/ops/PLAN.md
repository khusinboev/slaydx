# Ops sprint — faster deploys, lighter server, stronger prod

Branch `feat/ops` (from `main` = prod `926fcc7`). Research (read-only): `O1-deploy-pipeline.md`, `O2-ci-dev-loop.md`,
`O3-robustness-ops.md`, `O4-frontend-speed.md`.

## 1. Goal (owner, 2026-10-05)
Move image builds off the shared production server (GitHub builds, the server only pulls), make deploys fast, and use ways that
put no extra load on the server or the developer laptop; find and apply other speed and robustness improvements.

## 2. Key facts
- Today `deploy.sh` builds both images on the 4-vCPU shared box: `next build` 299 s, worker `chown -R /app` 97 s, exports 66 s →
  deploy ~10–12 min; server swap 3.9 GB used; docker build cache 25 GB; images web 2.1 GB, worker 1.88 GB.
- CI is one sequential job ~13 min; `cancel-in-progress` also cancels `main` runs (2 of the last 15).
- No alerting at all; `restart: unless-stopped` never restarts an unhealthy container; one DB dump per day (RPO 24 h).
- Mini App cold start preloads 356 KB of fonts (287 KB Tinos used only by the document viewer); every route carries ~40 kB gz of
  tool registries; slide images 0.6–1 MB each; production nginx has no HTTP/2 and no static-asset caching.

## 3. Owner decisions (2026-10-05)
| # | Decision |
|---|---|
| D1 | Registry: **GHCR private** packages; the server pulls with a read-only (`read:packages`) token stored root-only |
| D2 | Build cache: **one-time prune** of the server's docker build cache (`--filter until=168h`) once the pull deploy works |
| D3 | Monitoring: **server watchdog (cron, 3 min) + external GitHub Actions uptime probe (10 min)**, Telegram alerts to the owner; auto-restart of unhealthy slaydx containers alert-only for one week, then enabled |
| D4 | **HTTP/2 on** for the shared :443 (check every site after reload, revert on any problem) |
| D5 | Slide images: **lightweight viewer copy** (1024 px, q80) for the screen; the original stays for PPTX / downloads |
| D6 | Backups: **hourly ledger dump** (money/user tables) locally + daily full dump; Drive retention **7 daily + 4 weekly + 6 monthly** |
Lead decisions (research recommendations): deploy trigger = manual `ssh … slaydx-deploy <sha>` printed in the CI summary (no prod key
in GitHub); migrations pre-run with the new image before the container swap; CI sharded (4 unit + 3 ui + static + build, aggregate
`ci-ok`), never cancel `main`; full CI also for docs commits; fonts: Tinos / Geist Mono not preloaded, viewer re-measures after
`document.fonts.ready`; frontend phase 1 = fonts, registry decoupling phase 1, lazy home thumbnails / result-only modules, slide
image derivatives; KaTeX split and Telegram startup reordering are phase 2 after a throttled-phone measurement.

## 4. Work packages (wave 1 — disjoint file ownership)
| WP | Scope | Files (exclusive) | Model |
|---|---|---|---|
| P-IMG Image slimming | O1 §3.1–3.3: shared base stage, `COPY --chown` (no `chown -R`), drop `@next/swc` from the worker, tracing excludes, `.dockerignore` (tests, loadtests, .github, docs); O4 WP-G `next.config.ts` asset cache headers + `/` redirect | `Dockerfile`, `.dockerignore`, `next.config.ts` | opus |
| P-CI CI + images | O2 sharded jobs + concurrency fix + eslint cache; O1 WP2 build/push both images to GHCR in parallel with tests (`build-<sha>`), promote to `<sha>`/`main` only after `ci-ok`; SHA-pinned actions; least-privilege `permissions`; CI summary prints the deploy command with `<SERVER_IP>` placeholder (never the real IP); GHCR retention workflow | `.github/workflows/*`, `package.json` (lint script only) | opus |
| P-DEP Pull deploy | O1 WP3: `deploy/deploy-pull.sh` (pull pinned sha, pre-run migrations, swap, health, auto-rollback to the previous sha, backup + ROLLBACK.txt), `deploy/deploy-build.sh` (old path as fallback), compose `image:` refs with a tag variable; O3-E postgres `command:` flags in compose; tests with stubbed docker/git/curl | `deploy/*` (except nginx), `docker-compose.yml`, `tests/deploy-scripts.test.mts` | opus |
| P-OPS Monitoring + backups | O3-A watchdog (+ `WATCHDOG_AUTO_RESTART` default off), O3-B uptime workflow file, O3-C hourly ledger dump + GFS Drive retention + restore drill alert/timing, O3-D slaydx-scoped image cleanup, O3-E migration `036_pg_stat_statements.sql`, O3-F nginx example (HTTP/2, static cache, keepalive) | `scripts/watchdog.sh`, `scripts/backup*.sh`, `scripts/restore-check.sh`, `scripts/docker-cleanup.sh`, `.github/workflows/uptime.yml` (coordinate: P-CI owns other workflows), `lib/server/migrations/036_*.sql`, `deploy/nginx/*`, tests | opus |
| P-FE Frontend phase 1 | O4 WP-A fonts, WP-B phase 1 registry decoupling, WP-C lazy home thumbs + result-only modules | per O4 §(c) WP-A/B/C file lists | opus |
| P-SLIDEIMG Slide image derivatives | O4 WP-F with D5 | `lib/server/worker.ts` (derivative step only), `lib/server/assets.ts`, `lib/generation/slide-images.ts`, `components/viewers/SlideCanvas.tsx` (`loading`/`decoding`) | opus |
| Reviews | security (fable): P-CI + P-DEP + P-OPS (supply chain, token handling, workflow permissions, scripts run as root); correctness (opus): P-FE + P-SLIDEIMG + P-IMG | read-only | |

Wave 2 (after measuring): KaTeX split (O4 WP-D), Telegram startup (WP-E), zero-gap web restart (O1 WP5).

## 5. Server steps (lead, after review + CI green; owner provides the token)
1. Owner: GitHub classic PAT with only `read:packages` (1-year expiry); lead runs `docker login` into `/etc/slaydx/docker` (root 700) — the token is typed by the owner on the server or piped without being printed.
2. Install `slaydx-deploy`; first pull deploy of the new `main`; verify; keep `deploy-build.sh` as fallback.
3. One-time build-cache prune (D2); slaydx image cleanup.
4. HTTP/2 + static cache in nginx (D4): `nginx -t`, reload, curl every site on the box.
5. Watchdog cron + uptime workflow secrets; hourly ledger dump cron; Drive retention (D3, D6).

## 6. Status
| WP | Status |
|---|---|
| Research O1–O4 | ✅ |
| P-CI | ✅ merged — first real sharded run green (096aabb): longest job 186 s (was ~13 min total) |
| P-DEP | ✅ merged (20/20 + shellcheck fix 71a2af2; compose v2 behaviour to verify on the server) |
| P-FE | ✅ merged (shared layer 56→15 kB gz, /uz 109→75 kB, page counts unchanged) |
| P-SLIDEIMG | ✅ merged (10-slide deck 7.5 MB → 1.1 MB in the viewer; originals for PPTX/downloads) |
| P-IMG, P-OPS | running |
| Reviews | security (CI + deploy) and correctness (FE + slide images) running |
