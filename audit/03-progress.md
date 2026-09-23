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
