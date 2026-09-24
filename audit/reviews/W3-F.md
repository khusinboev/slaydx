# Review: W3-F (worker deps, image pins, Postgres tuning, CI, nginx, hermetic tests, sharp 0.35)

- **Reviewer:** independent, read-only
- **Branch:** `worktree-agent-ae21573768702bf19` (head `9d5d584`; includes the merge `7092101` and the follow-up commit `9d5d584`, which fixes the `infographic-svg` test)
- **Compared with:** `git diff audit/production-readiness...worktree-agent-ae21573768702bf19`. `git merge-tree` against the current `audit/production-readiness` (which already has W3-E's `db.ts`) merges with **no conflicts**.
- **Date:** 2026-09-24

## Verdict: **APPROVE** (no blockers; nits and one deploy-checklist item below)

The step with the biggest outage risk is `npm ci --omit=dev` in the worker. I checked it with a real install, not just by reading the code (see §1). I found nothing that breaks the build or startup on the prod box.

---

## What I verified

### 1. Worker `npm ci --omit=dev` is safe
- **Static trace.** I ran esbuild with `--bundle --packages=external --conditions=react-server --metafile` on these entry points: `scripts/worker.ts`, `topup.mts`, `seed-demo.mts`, `seed-images.mts`, `bot.mts`, `bot-commands.mts`, `migrate.ts`, `tts-lab.mts`, `image-lab.mts`, and the `lib/server/parse-worker.ts` thread. The union of external packages is `@anthropic-ai/sdk`, `@breezystack/lamejs`, `docx`, `jszip`, `next/server`, `next/headers`, `pg`, `pptxgenjs`, `server-only`, `sharp` and `unpdf`. **All are in `dependencies`.** Type-only imports are dropped by esbuild/tsx. jsdom, `@testing-library`, tailwind and typescript are never reached.
- **Lockfile walk.** Starting from every prod root plus `tsx`, I followed the transitive `dependencies` and non-optional peers: 71 packages. **None has `"dev": true` and none is missing.** `tsx@4.23.12` depends only on `esbuild`. Its `get-tsconfig` is bundled into `dist`: grep found no external import. So `get-tsconfig`/`resolve-pkg-maps` keeping `dev: true` is correct.
- **Lockfile consistency.** In a scratch copy, `npm install --package-lock-only` leaves the lockfile **unchanged**. (In the worktree, `npm ls` reports ELSPROBLEMS only because `node_modules` there is a symlink to the main checkout, which still has sharp 0.34.5. That is not a lockfile defect.)
- **Real prod-only install.** In scratch I ran `NODE_ENV=production npm ci --omit=dev`: 121 packages. No `typescript`, `jsdom` or `get-tsconfig` was installed; `.bin/tsx` was present. Against that tree I then ran `./node_modules/.bin/tsx --conditions=react-server`, with `lib/`, `scripts/`, `data/` and `tsconfig.json` symlinked in. Results:
  - `lib/server/worker.ts`, `credits.ts`, `db.ts`, `parse-worker.ts`, the lazily imported `teacher/test/engine.ts` and `curriculum.ts` all **load**.
  - Dynamic packages all **import**: sharp, pptxgenjs, unpdf, jszip, lamejs, docx, the Anthropic SDK, pg, `next/server` and `next/headers`.
  - `figurePng()` returns a **1890×945 PNG**.
  - `topup`, `seed-demo`, `seed-images` and `bot-commands` all start and print their usage messages.
  - **tsx does not need typescript at runtime** (confirmed).
- **Builder stage.** The `deps` stage runs `npm ci` without `NODE_ENV`, so it installs the full tree. `esbuild` is in the builder's `node_modules`, and is now also in prod through `tsx`. The `parse-worker.mjs` bundle step is unaffected.

### 2. Pinned tags
- `docker manifest inspect` finds `node:22.23.2-alpine3.24` (amd64 present) and `postgres:16.15-alpine3.24` (amd64 present).
- A Docker Hub listing shows these are the newest 22.x and 16.x alpine tags.
- Local Node is v22.23.2, which matches.
- Postgres stays on major 16, so the existing data directory is compatible; only the minor version and Alpine version change. The image uses libc/musl collation, so the Alpine change does not affect collation.

### 3. Postgres `command:`
- I booted a throwaway `postgres:16-alpine` (16.13) with exactly these flags and `-m 1g --cpus 1`. It started. `SHOW` confirmed every setting. `CREATE EXTENSION pg_stat_statements` and a query on it both succeeded.
- **Memory:** 256 MB `shared_buffers` in 1 GB is fine. Worst case `work_mem` × `max_connections` is only theoretical; the real pool footprint is about web 10 + worker 2×10 + migrate/admin ≈ 30–35 connections, well under `max_connections=100`.
- The server-side `idle_in_transaction_session_timeout=60s` matches the client-side value in `poolConfig()`.

### 4. sharp 0.34.5 → 0.35.4
- There is only one runtime call site: `lib/generation/figures/png.ts`, with the chain `sharp(buf,{density}).flatten().png({compressionLevel,palette}).toBuffer({resolveWithObject})`. `scripts/live-engine.mts` also uses sharp, but it is a dev-only tool.
- I ran that exact chain against a real sharp 0.35.4 install in scratch and got the correct dimensions. The Cyrillic SVG text rendered through librsvg 2.62 without errors.
- The lockfile has `@img/sharp-linuxmusl-x64@0.35.4` and `@img/sharp-libvips-linuxmusl-x64@1.3.3`. `engines` requires `node >=20.9`, which is met.
- sharp 0.35 has no install script.
- **Caveat:** the fixer's own test runs used the symlinked sharp **0.34.5**. My smoke test is the only exercise of 0.35.4, and it ran on glibc, not musl. `figurePng` swallows load errors and returns `null`. So if the musl binary failed on the box, the symptom would be missing figures, not a crash. See the post-deploy check in N1.

### 5. Hermetic tests
- The preload deletes provider, payment and TTS keys *before* test modules load. Tests that need a key set it themselves, after the preload, so they still work. Infrastructure variables (`DATABASE_URL` and the rest) are left untouched.
- **Mutation check:** I ran `tests/document.test.mts` with the real `.env.local`:
  - with the preload: **62 pass / 0 fail**;
  - without it: **60 pass / 2 fail** (the two known failures).
  - So the fix is real.
- No test gates itself on a real provider key, so no live test is silently skipped now.
- The preload does not clear `FAL_STEPS`, `LLM_STREAM` or `FREE_LLM_*` (N4).

### 6. CI yml
- The file parses as valid YAML: 9 steps, and the triggers are `push: [main]` and `pull_request`.
- The Postgres service uses the same pin, with a `pg_isready` health check.
- `npm test` already carries `--test-concurrency=2`.
- `next build` needs no `SESSION_SECRET`: the `NEXT_PHASE === "phase-production-build"` guard is in `env.ts:51`. `guard-build.mjs` exits early when `CI` is set (that check was already there).
- Tests that shell out to soffice/pdftoppm are mostly `skip`-guarded, but CI has not actually run yet, so its first run on GitHub is still unverified.

### 7. Tests run
Gate: `heavy2.sh -m 3G -t 900`, running `tsx --env-file-if-exists=.env.local --import ./tests/helpers/hermetic-env.mts --conditions=react-server --test --test-concurrency=2` on `compose-env`, `nginx-template`, `dockerfile-fonts`, `document` and `infographic-svg`. Result: **93 pass / 0 fail**.

`docker-compose -p auditcheck config` is valid. It renders the Postgres pin and command, brand env on the worker, and `ADMIN_PHONES` plus the DB timeout variables on both services. An empty `DATABASE_*_TIMEOUT_MS` falls back to the default in `envMs()`, not to 0. The coordinator also reports a full `npm test` against a throwaway DB: 2908/2908.

---

## Required changes
None.

## Nits / deploy checklist
- **N1 (deploy checklist, tell the owner).** The first deploy with this change **recreates the `postgres` container**, because the image tag and `command:` change. Every web and worker DB connection drops for a few seconds, and in-flight jobs hit a connection error.
  - Schedule this deploy for a quiet period, or note it in `deploy.md` §2b.
  - After deploy, check that shared_preload_libraries is applied: `docker exec slaydx-postgres-1 psql -U slaydx -tAc "SHOW shared_preload_libraries"`.
  - After deploy, trigger one Maqola/infographic figure and confirm the PNG renders. This is the only real-world check of sharp 0.35 on musl.
- **N2.** The compose comment says pg_stat_statements' `CREATE EXTENSION` "alohida migratsiya bilan yoqiladi" (is enabled by a separate migration). No such migration exists on any branch. Reword it to "must be created manually or by a future migration".
- **N3.** `deploy.md` §2b says the downtime is "~1–3 s". But Compose stops the old `web` container first. With `stop_grace_period: 60s`, new connections are refused for the whole drain time (up to 60 s when a long edit request is in flight), plus the startup time. State the window as "drain time (0–60 s) + startup".
- **N4.** The hermetic list omits `FAL_STEPS`, `LLM_STREAM` and `FREE_LLM_*`. They are not secrets, but they are behaviour switches that can still leak in from `.env.local`.
- **N5.** Image size:
  - `next@15.5` keeps its own nested `sharp@0.34.5` plus `libvips 1.2.4`, next to the root copies at 0.35.4 / 1.3.3. That is about 20 MB more in `deps`, the web standalone image and the worker.
  - `@img/sharp-wasm32@0.35.4` has no `cpu` restriction, so it always installs: about 9 MB more.
  - There is no functional impact, because `images.unoptimized: true` means Next never loads its own copy.
- **N6.** The CI build step inherits the job-level `DATABASE_URL`. The prod Docker build has none, so it would be closer to prod to unset it for `npm run build`.
- **N7.** `nginx`:
  - `listen 443 ssl http2;` prints a deprecation warning on nginx ≥1.25 (use `http2 on;`).
  - `includeSubDomains` in HSTS affects every subdomain of `slaydxx.uz`. Confirm that is intended before copying it to prod.
  - XFF handling is correct: `clientIp()` takes the rightmost entry, and `$proxy_add_x_forwarded_for` appends.
- **N8.** Typo in the `ci.yml` comment: `tugagunча` has Cyrillic `ча`.
- **N9 (not W3-F's doing).** `.claude/deploy.md` is tracked in a public repo and contains the server IP and the owner's username and phone. W3-I is taking these files out of git; make sure that lands.
