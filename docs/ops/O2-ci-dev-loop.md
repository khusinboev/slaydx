# O2 — CI + development loop speed (research only, nothing applied)

Data: 74 CI runs since 2026-09-24 (`gh run list -L 100`), step timings via `gh api .../actions/jobs/<id>` for 5 green runs
(37333293185, 37328906774, 37317638241, 37220473325, 37155843600), full log of 37333293185 saved in `scratchpad/ops/o2/ok.log`.

## 1. Measured CI timings (one job `check`, ubuntu-24.04, 4 vCPU/16 GB public-repo runner)

| step | typical | note |
|---|---|---|
| Initialize containers (postgres:16.15-alpine pull) | 17–20 s | |
| checkout + setup-node (npm cache hit) | 3–10 s | |
| npm ci | 14–19 s | |
| typecheck | 26–31 s | |
| lint | 24–27 s | |
| **npm test** (377 files, 4363 tests) | **376–398 s** | 62 % of the run |
| test:viewer (28 files, 251 tests) | 14–17 s | no DB |
| **test:ui** (100 files, 1267 tests) | **164–222 s** | jsdom, no DB |
| **build** (`next build --turbopack`) | **58–70 s** | on the prod box it takes 299 s |
| **job total** | ~12–13 min (run 37333293185: 15:30:28 → 15:43:39 = 13 m 11 s) | |

Key finding: the work is dominated by PER-FILE process startup, not by test bodies. Sum of all top-level test durations in
`npm test` is only ~267 s of ~768 slot-seconds (384 s × concurrency 2); test:ui 201 s of 430. Measured locally: a trivial
file (`cite-gost`, 11 tests) takes ~1.2 s node-side (4.1 s via `npx tsx`); `admin-cost` (DB + migrations) 6 s. 377 files × ≈1.3 s
≈ 490 s overhead. `NODE_COMPILE_CACHE` gave no gain (tested: 8.3 s vs 8.3 s). So the lever is parallelism (shards), not
micro-optimising files.

Slowest known tests (top-level only; file names not in logs): `db-migrate` "two parallel runners: >30 s migration" 31 s
(deliberate `pg_sleep(31)`, tests/db-migrate.test.mts:87 — it pins one shard for 31 s but is fine), P8 prompt ranges 7.7 s,
llmComplete timeout 6.5 s, worker orphans 5.6 s, seed tests 5 s ×3, backup.sh/restore-check.sh docker tests 1.4–5 s each
(use docker; they need runner docker — present on ubuntu-latest). UI: M1 toast 5 s (real 5 s timer), the rest <3.5 s.

## 2. GitHub Actions limits (verified in docs.github.com)
- Repo `khusinboev/slaydx` is PUBLIC (`gh repo view`), "GitHub Actions usage is free … for public repositories that use standard
  GitHub-hosted runners" (billing docs) → minutes unlimited; extra parallel jobs cost nothing.
- Free plan: **20 concurrent jobs** total; matrix max 256 jobs/run; job max 6 h; cache **10 GB/repo**, LRU eviction
  (current usage 594 MB, 3 entries).
- Public repo caveat: PR runs from forks have read-only cache; not relevant here (single owner).

## 3. Proposed pipeline (parallel jobs)

Jobs: `static` (tsc ‖ eslint concurrently), `unit` ×4 shards (each its OWN Postgres service), `viewer-ui` ×3 shards (no DB),
`build` (parallel, not blocking). No job needs another (`needs:` none) → wall = slowest job.

Estimated wall time (setup ≈ 45 s per job: container 20 + checkout/node 5 + npm ci 15 + misc):
- static: 45 + ~35 (tsc 30 ‖ eslint 27 on 4 vCPU) ≈ **1.4 min**
- unit shard (1/4 of 384 s at conc 2 ≈ 96–130 s, uneven by the 31 s test) ≈ 45 + 130 ≈ **3 min**
- viewer-ui shard (216/3 + 16/3 ≈ 80 s) ≈ 45 + 80 ≈ **2.1 min**
- build ≈ 45 + 70 (or ~45 with `.next/cache`) ≈ **1.9 min**
- **Before 13 min → after ≈ 3–3.5 min** (−75 %). Billed minutes rise (~14 → ~21 job-min) but they are free.
- With 6 unit shards: ≈ 2.3 min; diminishing (fixed 45 s setup + 31 s test). Keep 4.

### Gotchas found (verified locally)
1. `npm run test -- --test-shard=1/4` does NOT shard: args after the glob are ignored (ran 3 files with `--test-shard=1/2` and
   `2/2` → both reported 19 tests). The flag must come BEFORE the file list. So ci.yml must call tsx directly (snippet below), or add
   package.json scripts that put `--test-shard` before the glob.
2. `--test-shard=i/n` works with `tsx --test` on Node 22.23 (verified: 2 files vs 1 file split of three).
3. `tests/ui` + `tests/viewer` don't use the DB (only `pg`-named variables in grep) → no postgres service on those jobs (saves 20 s).
4. DB safety: shards are separate jobs → separate service containers → NO shared Postgres. Inside one job concurrency stays 2 as
   today (passes in 70+ runs). 56/377 test files create isolated DBs (`tests/helpers/isolated-db.mts`, global-state queue tests);
   the others share `slaydx` DB at conc 2. Do NOT raise intra-job concurrency to 3–4 without a trial run: several shared-DB tests
   (accounts/auth/admin-*) were never exercised at >2. Trial option: run one shard at `--test-concurrency=3` for 5 runs.

### ci.yml (proposed; NOT applied) — replace `jobs:` section, keep header/`on:`/`concurrency:` (with fix below)

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
  workflow_dispatch:            # `gh workflow run ci.yml --ref feat/x` — CI for a branch without opening a PR

concurrency:
  group: ci-${{ github.event_name }}-${{ github.ref }}
  # cancel stale PR runs only; a main push must finish (today 2 of the last 15 main-merge runs were cancelled by the next
  # docs commit, so the merge commit itself was never verified)
  cancel-in-progress: ${{ github.event_name == 'pull_request' }}

env:
  NEXT_TELEMETRY_DISABLED: "1"

jobs:
  static:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: "22", cache: npm }
      - run: npm ci
      - uses: actions/cache@v4            # eslint cache (cold 125 s locally -> 9 s warm); content strategy = survives checkout mtimes
        with:
          path: .eslintcache
          key: eslint-${{ hashFiles('package-lock.json', 'eslint.config.mjs') }}-${{ github.sha }}
          restore-keys: eslint-${{ hashFiles('package-lock.json', 'eslint.config.mjs') }}-
      - name: typecheck + lint in parallel
        run: |
          npx tsc --noEmit & p1=$!
          npx eslint --cache --cache-strategy content --cache-location .eslintcache & p2=$!
          wait $p1; r1=$?; wait $p2; r2=$?
          exit $((r1 | r2))

  unit:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    strategy:
      fail-fast: false
      matrix:
        shard: [1, 2, 3, 4]
    services:
      postgres:
        image: postgres:16.15-alpine3.24
        env: { POSTGRES_USER: slaydx, POSTGRES_PASSWORD: slaydx, POSTGRES_DB: slaydx }
        ports: ["5432:5432"]
        options: >-
          --health-cmd "pg_isready -U slaydx" --health-interval 5s --health-timeout 5s --health-retries 10
          --tmpfs /var/lib/postgresql/data:rw
    env:
      DATABASE_URL: postgres://slaydx:slaydx@localhost:5432/slaydx
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: "22", cache: npm }
      - run: npm ci
      # Same flags as package.json "test", with --test-shard BEFORE the file list (after it, it is silently ignored).
      - run: >
          npx tsx --env-file-if-exists=.env.local --import ./tests/helpers/hermetic-env.mts --conditions=react-server
          --test --test-concurrency=2 --test-shard=${{ matrix.shard }}/4 tests/*.test.mts

  ui:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    strategy:
      fail-fast: false
      matrix:
        shard: [1, 2, 3]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: "22", cache: npm }
      - run: npm ci
      - run: npx tsx --tsconfig tsconfig.viewer.json --test --test-concurrency=2 --test-shard=${{ matrix.shard }}/3 tests/ui/*.test.mts
      # 251 viewer tests, 16 s: run once on shard 1 only
      - if: matrix.shard == 1
        run: npm run test:viewer

  build:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: "22", cache: npm }
      - run: npm ci
      - uses: actions/cache@v4
        with:
          path: .next/cache
          key: next-${{ hashFiles('package-lock.json') }}-${{ hashFiles('**/*.ts', '**/*.tsx') }}
          restore-keys: next-${{ hashFiles('package-lock.json') }}-
      - run: npm run build

  # single required status for branch protection / deploy gating (matrix names are awkward to require)
  ci-ok:
    if: always()
    needs: [static, unit, ui, build]
    runs-on: ubuntu-latest
    steps:
      - run: |
          [ "${{ contains(needs.*.result, 'failure') || contains(needs.*.result, 'cancelled') }}" = "false" ]
```

Notes on the snippet:
- `--tmpfs` for PG data (fsync-free data dir) is optional; backup/restore tests use their own docker containers, unaffected.
  Drop it if the first run shows any oddity.
- `build` can be dropped from `ci.yml` if O1's image workflow runs `npm run build` inside `docker build` on every PR (Dockerfile
  builder stage does) — avoid doing it twice; keep it while the image workflow only runs on main.
- `.next/cache` gain ≈ 20–30 s of 70 s (Next.js documents caching it); key falls back to lockfile-only prefix.
- Docs-only skip (paths filter): NOT recommended as `paths-ignore` — `tests/no-pii-in-repo.test.mts` scans tracked files (md
  included) and 3 tests read docs/README (`admin-permission-matrix` → docs/admin/02-plan.md, `telegram-webhook` → README.md,
  `infographic-svg` → data/ICONS-LICENSE.md). If wanted: a `changes` job (git diff) that, for docs-only diffs, runs only those
  tests (`tests/no-pii-in-repo.test.mts tests/admin-permission-matrix.test.mts tests/telegram-webhook.test.mts
  tests/infographic-svg.test.mts`, ~1 min). With a 3-min CI the saving is small; low priority.
- Also optional, small: `postgres` service pull is 17–20 s of every DB job; ubuntu-24.04 has preinstalled PG16 (`sudo systemctl
  start postgresql`, ~3 s) but loses the pinned 16.15-alpine parity and `pg_dump` version parity → not recommended.
- Don't cache `node_modules` (setup-node npm cache already makes npm ci 14–19 s).

## 4. Local developer loop (14 GB laptop)

Scripts (package.json): `npm test` (377 files, `--test-concurrency=2`), `test:viewer` (28 files), `test:ui` (100 files, jsdom),
`check` = all five serial. `scripts/heavy.sh` wraps with a 5 GB slice, 3 GB/900 s per command.
Estimated local full suite (extrapolated from CI at the same concurrency + 12-core laptop, not measured end-to-end to protect RAM):
`npm test` ≈ 5–7 min, `test:ui` ≈ 3–4 min, `tsc` 29 s measured (926 MB RSS, with `incremental` already on in tsconfig.json),
eslint 125 s cold → **8.7 s warm with `--cache`** (measured; 223 MB RSS).

Recommendations
1. **Rely on CI for full regressions.** With sharding CI ≈ 3–3.5 min on GitHub's 4-vCPU box at zero laptop RAM. Agents/lead run
   only targeted files locally (`scripts/heavy.sh npx tsx --import ./tests/helpers/hermetic-env.mts --conditions=react-server
   --test tests/<file>`), push the branch, and watch with `gh run watch $(gh run list --workflow ci.yml -b <branch> -L1 --json
   databaseId -q '.[0].databaseId') --exit-status`. A branch without a PR gets no CI today → open a draft PR early or use the new
   `workflow_dispatch` trigger.
2. **eslint cache**: change the lint script to `eslint --cache --cache-location .cache/eslint --cache-strategy content`
   (add `.cache/` and `.eslintcache` to .gitignore). Local: 125 s → 9 s.
3. **tsc**: `incremental: true` is already set, so `tsconfig.tsbuildinfo` exists (gitignored). Warm run still 29 s (Next plugin +
   whole-repo include incl. tests). Further tuning gives little; keep `tsc` as is, run on demand; CI does it in parallel.
   Don't add `tsBuildInfoFile` unless two tsconfigs share one default path (tsconfig.viewer.json already has its own file).
4. **`scripts/test-changed.mts`** (feasible, ~80 lines, no dependencies): 
   - changed = `git diff --name-only $(git merge-base HEAD origin/main)` + untracked (`git ls-files -o --exclude-standard`);
   - build a reverse import graph over `lib app components tests scripts` (913 files in lib/app/components) with a regex on
     `from "..."`/`import("...")`/`require`, resolving relative paths, `@/` alias, `.ts/.tsx/.mts/index` variants;
   - BFS from changed files to any `tests/**/*.test.mts`; classify by directory (root → unit flags with hermetic-env;
     `tests/viewer` and `tests/ui` → `--tsconfig tsconfig.viewer.json`);
   - always-add "meta" tests that read files by path rather than import (not traceable): `no-pii-in-repo`, `compose-env`,
     `backup-script`, `nginx-template`, `csp-headers`, `admin-permission-matrix`, `telegram-webhook`, `infographic-svg` when the
     changed path is outside lib/app/components (Dockerfile, compose, scripts/*.sh, docs, nginx, data) — grep for
     `readFileSync` finds 51 such test files; the helper should also scan tests for string literals of changed paths;
   - fallback: if the changed set touches a hub module (`lib/server/db.ts`, `lib/types`, `package.json`, `tsconfig*`) → print
     "run CI" and exit; print the affected list and run it through `scripts/heavy.sh` in batches of ≤40 files at concurrency 2.
   Limits: dynamic requires and fs-based reads aren't traced; the helper is a pre-push filter, CI remains the gate.
5. Heavy-process hygiene: sharding makes it tempting to run shards locally — don't (one `heavy.sh` at a time stays the rule).

## 5. Flaky / failing tests in recent CI (74 runs: 40 success, 21 cancelled, 13 failure)

All 13 failures are in the `npm test` step (never lint/typecheck/build/ui/viewer):
- **backup.sh / restore-check.sh docker tests** (runs 35997332534…36911410685, 2026-09-24…10-01, 9 runs): `pg_dump: FATAL: the
  database system is shutting down` — official postgres image starts a temporary socket-only server for init and then restarts;
  unix-socket `pg_isready` reported ready during that window. Real flake, fixed by `c85dbdc test(backup): probe Postgres
  readiness over TCP` (tests/backup-script.test.mts:68-75, 375). No recurrence since.
- run 36907841671 additionally `no-pii-in-repo` ("998-prefix phone in tracked files") — a real regression in that branch, fixed.
- 2026-10-03 run 37125873033 `telegram-miniapp` "script URL only in gated bridge" and 2026-10-05 runs 37308360334/37309563429
  `csp-headers` Content-Disposition regexp (`%28`/`%29` encoding vs expected `\(1\)`) — deterministic failures from branch code
  under review (feat/mobile), caught by CI as intended; fixed before merge.
- No retries visible; no test in the last 40 greens shows duration variance >±5 % per step. Timing risk only: `db-migrate` 31 s
  `pg_sleep` test (timeout 120 s) and the 5 s real-timer UI test.
- 21 cancelled runs are all from `cancel-in-progress` (rapid pushes). Two were on `main` (37331966482, 37316464133): the
  merge commit was never CI-verified because a docs commit followed within 10 min → fix in the `concurrency:` block above.
- Residual shard risk: tests with fixed names/ports (`docker --name` in backup-script.test.mts:55/206/309/438 — container names
  must be unique per shard job; separate runners → no clash; `listen(` in 6 files use ephemeral ports → fine).

## (a) Findings ranked (impact / effort)
1. Serial 13-min single job → parallel jobs: −75 % wall, effort S (one file), risk low.
2. `--test-shard` silently ignored when placed after the glob (npm `--` trap) — must call tsx directly in CI.
3. cancel-in-progress on main cancels merge-commit verification — set to PR-only.
4. eslint cache (local 125 s → 9 s; CI similar via actions/cache) — effort XS.
5. `.next/cache` + dropping duplicate build once image workflow builds — −25 s / avoids double build.
6. test-changed helper for agents — effort M, optional once CI is 3 min.
7. Per-file startup overhead (~1.3 s × 477 files) is the structural cost; future option: fewer, larger files or
   `--test-isolation=none` (NOT safe: tests mutate process.env/module state) — not recommended.

## (c) Work packages (exclusive file ownership)
- WP-CI (owns `.github/workflows/ci.yml`): snippet above; trial run on a draft PR; compare job times; tune shard counts.
- WP-LINT (owns `package.json` scripts `lint` + `.gitignore` lines): eslint cache flags. (Conflicts with any other agent editing
  package.json → single owner.)
- WP-TESTCHANGED (owns new `scripts/test-changed.mts` + one line in `package.json`/CLAUDE.md «Og'ir buyruqlar»): optional.

## (d) OWNER decisions
1. Sharded parallel CI (4 unit + 3 ui + static + build). Options: (A) as proposed — recommended; (B) only 2 unit shards (≈5 min,
   fewer jobs); (C) keep single job.
2. `main` pushes: (A) never cancel (recommended); (B) keep cancelling.
3. Docs-only commits: (A) run full CI (recommended — it is 3 min and docs are scanned by PII/doc tests); (B) docs fast-lane with
   the 4 doc-reading tests.
4. Branch protection / deploy gate: require `ci-ok` before merge/deploy (recommended once O1's image pipeline exists) or leave advisory.

## (e) Risks + rollback
- Shards sharing Postgres: none by design (service per job); if intra-job concurrency is later raised, tests with global queue/count
  assertions on the shared `slaydx` DB can flake → keep 2, trial first.
- Uneven shards: node distributes files by index; one shard carries the 31 s migration test; acceptable, or rebalance later by
  using 5 shards.
- Required-check name change: matrix jobs are named `unit (1)` etc.; use the aggregate `ci-ok` if protection is enabled.
- Tests that were implicitly ordered by the single TAP run: none known (node:test runs files isolated already).
- Rollback: `git revert` of the ci.yml commit restores the single `check` job; no runtime/prod impact.
