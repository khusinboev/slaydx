# 03 — Fix progress (finding → status → commit)

Status legend: ✅ fixed & merged · 🔄 in review · 🛠 in progress · ⏳ planned · ⏸ owner decision · ✖ won't fix

## Wave 1 — P0

| Cluster | Findings | Package | Status | Commit(s) | Review |
|---|---|---|---|---|---|
| C01 admin takeover | SECA-01, DEPS-08, ABUSE-06, TEST-12 (partial) | W1-A | ✅ merged | `44aab5b`, `94b9689` → merge `c0a3dec` | `audit/reviews/W1-A.md` (approved on re-review) |
| C02 returnTo XSS | FE-01, SECA-02 | W1-B | ✅ merged | `73433e1`, `62b086f` → merge `8da3314` | `audit/reviews/W1-B.md` (approved on re-review) |
| C03 JSONB surrogate/NUL | BEB-01, BEA-02 | W1-C | ✅ merged | `1e3e864`, `6bc1353` → merge `5b15ad3` | `audit/reviews/W1-C.md` (approved) |
| C04+C06 parsing freeze | SECB-01, SECB-02, SECB-04, SECB-05 (part; rest → W2-C), CONC-09, FILE-02, FILE-04, TEST-11 | W1-D | ✅ merged | `65fbd58..f11f551` → merge `5d09028` | `audit/reviews/W1-D.md` (approved on re-review) |
| C10 free-LLM spend | EXT-02, ABUSE-01, CONC-11 (partial), CONC-13, SCALE-14, BEA-11 (partial) | W1-E | ✅ merged | `890ce4b`, `0645c82` → merge `3368af3` | `audit/reviews/W1-E.md` (approved on re-review) |

## Wave 2 — P1

| Cluster | Findings | Package | Status | Commit(s) | Review |
|---|---|---|---|---|---|
| C07 LibreOffice fan-out | FILE-03, FILE-06, CONC-01, CONC-08, BEA-20, SCALE-04, SCALE-07 | W2-A | ✅ merged | `2245655`, `f61621a`, `0175311` → merge `59f569f` | `audit/reviews/W2-A.md` (approved on re-review; R1 template-route 503 → W2-C) |
| C08/C09/C16/C22-admission | SCALE-01, FE-05, BEA-07, DB-06/SCALE-08/SCALE-12 (partial), BEA-06, DB-03, SCALE-03, CONC-18, CONC-07, SCALE-05, SCALE-02 (part) | W2-B | ✅ merged | `a285127`..`5240fd9` → merge `01bf6ab` | `audit/reviews/W2-B.md` (approved on re-review) |
| C17/C18/C19/C24 + C22 compose | INFRA-01, TEST-05, INFRA-04, INFRA-15, OBS-10, INFRA-06, OBS-04, OBS-12, OBS-01, INFRA-05, INFRA-10 (CONC-17 partial) | W2-D1 | ✅ merged | `4cbb6d4`..`fbb1bef` → merge `9c7d682` | `audit/reviews/W2-D1.md` (2nd rejection resolved by orchestrator) |
| C23 retention + queue TTL + C27 | FILE-01, DB-01, BEB-06, BEB-03, CONC-04, BEA-18, DB-10, OBS-05/CONC-05/DB-04 (bounded reconciler) | W2-D2 | ✅ merged | `d3334f3`..`066bb11` → merge `33c3591` | `audit/reviews/W2-D2.md` (2nd rejection resolved by orchestrator, `.claude/escalations.log`) |
| C20/C21 + UX-08 + W1-E UI + C09 client | FE-02, UX-05, FE-14, FE-03, UX-08, FE-08, FE-12 | W2-E | ✅ merged | `9664c0f`..`4a36ca6` → merge `0568292` | `audit/reviews/W2-E.md` (2nd rejection resolved by orchestrator) |
| C11/C13/C29 + leftovers | EXT-01, DB-02, EXT-08, SCALE-10, BEA-15, ABUSE-05/SECA-03 (partial), SECB-05 (rest), BEA-03 | W2-C | ✅ merged | `ae0c81e`..`46934d6` → merge `cf3bd1d` | `audit/reviews/W2-C.md` (approved on re-review) |
| W2 wrap-up | CONC-17 (WORKER_INLINE default off in prod), .env.example limits | orchestrator | ✅ | `fa938a1` | test red→green→mutation |

**W1 gate (commit `5d09028`, includes W2-A + W2-D2): ✅ GREEN** — typecheck 0, lint 0, unit **2 783 / 2 785** (only the 2 known env-dependent `document.test` failures; +146 tests vs baseline 2 639), viewer 248/248, UI 373/373, `next build` ok, start smoke on a fresh Postgres: `/api/health` 200, `/uz` 200, `/api/generations` 401, migrations through `022_retention.sql`.

**W2 gate (commit `fa938a1` + fixes `6a415f0`): ✅ GREEN** — typecheck 0 (after fixing a type error in the new CONC-17 test), lint 0, unit **2 899 / 2 901** (only the 2 known env-dependent failures; +262 vs baseline), viewer **248/248** (one stale assertion updated for the intended `?v=<fileVersion>` thumb URL), UI **401/401**, `next build` ok, start smoke on a fresh Postgres: health 200, `/uz` 200, `/api/generations` 401, migrations through `022_retention.sql`.

## Wave 3 — P2 (phase 1 running)

| Package | Clusters | Status |
|---|---|---|
| W3-B | C28 provider resilience + C15 chain deadline | 🛠 |
| W3-E | C32 migrations, C33 pool, DB-11 part | 🛠 |
| W3-F | C35 Docker/CI/nginx template, C40 hermetic tests, DEPS-03 | 🛠 |
| W3-I | C05 PII/IP out of repo, ADMIN_PHONES env, untrack .claude/* | 🛠 |
| W3-J | C12 pricing normalisation | 🛠 |

## Event log
- 2026-09-23 22:12 laptop reboot (scratchpad lost, all deliverables committed); ~22:35 VS Code crash (no OOM in kernel log) — agents resumed with SendMessage, no committed work lost.
- 2026-09-24 ~02:45 session rate limit stopped 6 agents; all uncommitted work intact in worktrees; resumed 02:58 with SendMessage (each told to commit WIP first).

## Pause — 2026-09-24 05:15 (/holats)
- W3: 9/10 merged (A `4a57589`, B `1f26384`, C `20aeead`, D `b4a9ff1`, E `33d0ce4`, F `8f94120`, G `15cf902`, I `a455603`, J `c3f5e48`); W3-H awaiting review (branch has 9 commits). W3 gate not yet run.
- W4 started (A, B, C, E, F); WIP commits on branches for C and F; D not started.
- Phase 5 harness written (`loadtests/` WIP on the P5-prep branch), smoke partial.
- Test fixes on the audit branch: admission EXPLAIN assertion (`c38a1fd`), no-PII fixture IP (`0bdc2e7`).

## W3 — complete
All 10 W3 packages merged (A `4a57589`, B `1f26384`, C `20aeead`, D `b4a9ff1`, E `33d0ce4`, F `8f94120`, G `15cf902`, H `447c6a4`, I `a455603`, J `c3f5e48`). FE-10 (Mini App login) deferred: reviving it opened a login-CSRF, and the server HMAC can't be verified without a real captured initData.

**W3 gate (commit `447c6a4`): ✅ GREEN**
- typecheck 0, lint 0
- unit **3 084 / 3 085** on a dedicated fresh DB; the single failure was a stale source-scan regex (`tests/game-wiring.test.mts`), fixed after the gate → 15/15
- the 2 historic env-dependent failures are gone (W3-F hermetic tests)
- viewer 248/248, UI **432/432**
- `next build` ok
- start smoke on a fresh Postgres: health 200, `/uz` 200, `/api/generations` 401, migrations through `026_game_results_keep.sql`, and the worker heartbeat file present


## W4 — complete
All 6 W4 packages merged: F `05b5baf`, C `04126b0`, E `da3c2f5`, B `266e3af`, D `a10da35`, A `f631257`. Reviews are in `audit/reviews/W4-*.md`. The second rejection on W4-B (housekeeping lock wedge) was resolved by the orchestrator; see `.claude/escalations.log`.

**W4 gate (commit `f631257`): ✅ GREEN after test-only fixes**
- typecheck 0, lint 0, viewer 248/248, UI **453/453**, `next build` ok
- start smoke on a fresh Postgres: health 200, `/uz` 200, `/api/generations` 401, migrations through `027_queue_indexes.sql`, worker heartbeat file present
- unit **3 248 / 3 254**. All 6 failures were stale assertions that intended W4 contract changes had made obsolete; no production code changed:
  - `telegram-429` (2): a persistent 429 now throws `TelegramTransientError`, so the webhook returns 500 and Telegram redelivers (W4-C, BEA-17).
  - `env-assert-runtime-config` (1): the problem text now names `TELEGRAM_WEBHOOK_SECRET (yoki zaxira CRON_SECRET)`. Added a case where `CRON_SECRET` is missing but `TELEGRAM_WEBHOOK_SECRET` is set (W4-C, EXT-14).
  - `credits-atomic` (1): a repeated DELETE of a cancelled (deleted) generation returns 404, not 409 (W4-B, BEA-12).
  - `no-pii-in-repo` (1, plus a subtest): the W4-A safe-fetch fixtures (example.com, 8.8.8.8, Cloudflare, Google, 172.32.0.1 boundary) are allowlisted, and 100.64/10 (CGNAT) is classed as reserved. Mutation check: an injected unknown public IP (185.x) and the first address above the CGNAT range (100.128.x) are both still caught.
  - After the fixes, the 4 files pass 21/21 and no-pii passes 2/2.

## Live smoke with real Gemini (2026-09-24, commit `cb7aee3`, budget ≤ $5)
`npm run live -- pro-slide slide translation-text resume referat article-oak crossword infographic essay-dtm lesson` → **10/10 cases pass** (engine level, `buildArtifact`, real Gemini `gemini-3.7-flash` + `gemini-3.1-flash-lite-image`).

| Case | Time | Calls | Result |
|---|---|---|---|
| pro-slide (10 slides, grounding, AI images) | 31.8 s | 8 | 10/10 slides, 7 web sources / 3 queries, 4 images, quiz + answers |
| slide (10 slides) | 13.8 s | 2 | 4 images |
| translation-text → en | 4.3 s | 2 | numbers/URLs kept, 16-term glossary |
| resume | 4.2 s | 1 | en labels, 1 page |
| referat | 45.3 s | 18 | 2 702 words |
| article-oak | 32.4 s | 12 | 17 verified sources, 42 citations, report 92/100, 11 pages |
| essay-dtm | 38.0 s | 6 | 673 words |
| lesson plan | 12.4 s | 2 | ok |
| crossword | 10.2 s | 4 | ok |
| infographic | 7.4 s | 2 | PNG 350 KB |

- **`cost_json.parts`** (probe: 4-slide pro-slide with grounding) shows `llm` $0.0080 (3 calls), `grounding` $0.028 (2 units), `image` $0.068 (2 × $0.034). Total $0.104, reported per service.
- **Deadline:** a referat with a 20 s deadline threw `DeadlineError` after 13.7 s ("muddat tugadi — yangi urinish boshlanmadi") and returned no file. The worker maps it to FAILED + refund (unit tests plus the P5 provider-down chaos run).
- **Spend:** ≈ $0.7 in total, including the accidental ≈ $0.007 earlier.
- Note: Google Books returned 403 locally (key restriction). Research fell back to OpenAlex/Crossref, and every check passed.

## Pre-deploy image verification (PRE-DEPLOY R1, 2026-09-24 ~17:10)
- `docker build --target runner` and `--target worker` at `03e78c1`: both rc 0 (web 36 min and worker 8 min, both limited by the laptop network).
- **Offline web image:** `parse-worker.mjs` present, migrations through 027, `sharp` loads, LibreOffice 25.8.7.3, `pdftoppm`, `find`.
- **Boot test** on a Docker `--internal` network (no internet), with postgres 16.15-alpine3.24 using the compose flags, web, and 2 workers × 4 under `--init`:
  - all 3 containers HEALTHY within 9 s;
  - `/api/health` 200, `/uz` 200, `/api/generations` 401;
  - 27 migrations through `027_queue_indexes.sql`;
  - the worker logs `concurrency=4`;
  - DOCX → PDF → PNG works as the `nextjs` user.
- **Prod pre-deploy (read-only, plus backup):**
  - `pg_dump -Fc` 277 MB (`pg_restore --list` OK);
  - `ROLLBACK.txt` = `e380940`;
  - images tagged `slaydx-{web,worker}:pre-audit`;
  - `.env` backed up (600);
  - queue idle.
