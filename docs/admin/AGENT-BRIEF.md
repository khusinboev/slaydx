# Common brief for every admin-panel work package (read fully before coding)

You are one of several engineers building the SlaydX admin panel in parallel. A lead engineer reviews your diff before merging. Quality bar: production code for a real market launch.

## Source of truth
- Spec: `docs/admin/02-plan.md`. Your package section is named in your task. Read at least: §2 (architecture), §3 (auth), §4 (RBAC + adminHandler), §5 (data model), §6.0 (API conventions), §7.0 (UI rules), §8 (audit), §9 (performance), §13.2–13.4 (file ownership), §17 (pricing), §18 (execution).
- Context: `docs/admin/01-analysis.md` (house conventions in §1.2; cite-able facts).
- If reality contradicts the plan, STOP that part and report it precisely (file:line, what differs, your proposal). Do not silently deviate.

## Hard rules
1. Touch ONLY the files your package owns (listed in your task). If you need a change elsewhere, do not make it — report it.
2. Do not change existing product behavior except where your package spec says so. Defaults must keep current behavior byte-for-byte.
3. Migrations are additive only. Never edit migrations 001–027.
4. Permission checks live on the server (`adminHandler`). Hiding UI is not security.
5. Every mutating admin action writes exactly one audit row in the same DB transaction as the change (see §8). Money actions require reason + Idempotency-Key; destructive actions need confirmation.
6. No secrets in code, no mock data, no placeholders, no TODO/FIXME, no `any` unless unavoidable (then justify in a comment).
7. Never weaken, skip or delete an existing test. Never add `.skip`/`todo` to make things pass.
8. No new npm dependencies.
9. Code comments in **English** (concise, explain *why*). All user-visible UI text in **Uzbek (Latin)**, including aria-label/title/placeholder/alt (enforced by `tests/ui-strings.test.mts`).

## House conventions (from 01-analysis §1.2 — follow exactly)
- Route files: `export const runtime = "nodejs"; export const dynamic = "force-dynamic";`, each method wrapped (admin routes: `adminHandler(scope, opts, fn)` from `lib/server/admin-handler.ts` once F2 exists; scope like `"admin/users/list"`).
- Errors: throw `ApiError(uzMessage, status, extra)` (`lib/server/api.ts:70`). Never return raw `e.message`. Malformed params → 4xx, never 500 (use `parseIntParam` from `lib/server/validate.ts`, UUID regex).
- Bodies: `readJson(req, cap)` with a small cap; treat every field as `unknown` and validate explicitly (no spreading bodies into SQL).
- DB: `query/queryOne/transaction` from `lib/server/db.ts`, `$n` params only; identifiers/sort columns only via whitelists → constant SQL fragments. Never `SELECT *` on `generations`, `*_files`, `*_assets`, `*_uploads`. JSONB writes via `toJsonb()` (`lib/server/jsonb.ts`).
- Server modules: `lib/server/<name>.ts`, start with `import "server-only";`, relative imports (`./db`), log via `log(level, "[area] msg", fields)` from `./log`.
- Migrations: `lib/server/migrations/0NN_name.sql`, contiguous numbering, `SET LOCAL lock_timeout = '5s';` at top, `IF NOT EXISTS` everywhere, English header comment and a commented `-- ROLLBACK` block.
- Client: `"use client"` components in `components/admin/**`; API calls only via `lib/admin-api/*` (which reuse `request()` from `lib/api-client.ts`). Admin client code must never import `lib/server/**` or anything importing `server-only` (enforced by `tests/client-bundle-guard.test.mts`, `tests/admin-boundary.test.mts`). Types may be `import type`.
- Styling: Tailwind v4 semantic tokens (`bg-card`, `border-input`, `text-muted-foreground`, `bg-primary text-primary-foreground`, …), `cn()` from `lib/cn.ts` (no tailwind-merge → use variant props), lucide-react icons, `tabular-nums` for numbers, numbers via `toLocaleString("uz-UZ")`.
- Tests: flat files only — `tests/admin-<topic>.test.mts` (node:test, `import test from "node:test"`, `import assert from "node:assert/strict"`), UI tests `tests/ui/admin-<topic>.test.mts` (start with `import "./setup.ts";`, see `tests/ui/confirm-click.test.mts` for fetch stubbing and router context). DB-backed tests: `const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL.includes("unused");` and `{ skip: hasDb ? false : "DATABASE_URL yo'q" }`. Route tests: call the route module's exported handler inside `inRequest()` from `tests/helpers/next-request.mts`.

## Environment setup (do this first, in your worktree root)
```bash
# Your worktree may be based on `main`; the integration branch already holds merged packages
# (docs/admin, earlier packages). Bring it in FIRST (fast-forward or merge commit, no rebase):
git merge --no-edit claude/cool-feynman-jiixoi
# Then report `git log --oneline claude/cool-feynman-jiixoi..HEAD` at the end (your commits only).
[ -e node_modules ] || ln -s <path-to-main-checkout>/node_modules node_modules   # or: npm ci
PKG=<your package id, lowercase, e.g. f2>
psql postgres://slaydx:slaydx@127.0.0.1:5432/postgres -c "DROP DATABASE IF EXISTS slaydx_$PKG" -c "CREATE DATABASE slaydx_$PKG"
export DATABASE_URL=postgres://slaydx:slaydx@127.0.0.1:5432/slaydx_$PKG
```
Migrations apply automatically on first `ensureMigrated()` (any DB test).

## Checks you must run before reporting (all must pass)
```bash
npm run typecheck
npm run lint
# your own tests + guard tests:
npx tsx --env-file-if-exists=.env.local --import ./tests/helpers/hermetic-env.mts --conditions=react-server --test --test-concurrency=2 tests/<your files> tests/ui-strings.test.mts tests/client-bundle-guard.test.mts tests/migrations.test.mts tests/malformed-route-params.test.mts
# if you have UI tests:
npx tsx --tsconfig tsconfig.viewer.json --test tests/ui/<your ui files>
```
Also run (once F2 is merged) `tests/admin-route-guard.test.mts` and (once F3 is merged) `tests/admin-boundary.test.mts` if they exist in your worktree.
Note: in this container some unrelated existing tests fail for environment reasons (tsx module identity, LibreOffice) — see 01-analysis §8. Do not try to fix those; just make sure none of YOUR files or the guard tests fail. Do NOT run the full `npm test` (the lead does that at merge time; CPU is shared).

## Commit (do not push)
- Small conventional commits on your worktree branch, e.g. `feat(admin): …`, `test(admin): …`.
- Every commit message ends with:
```
Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
(plus any session trailer your harness requires)
```
- Do not push; do not create PRs. The lead merges.

## Final report (your last message, ≤ 400 words)
1. Branch name and commit list (`git log --oneline <base>..HEAD`).
2. Files created/changed (must equal your owned list).
3. Exact check commands run and their results (pass counts).
4. Any deviation from the plan, open question, or follow-up needed from another package — precise.

## PII guard (learned from CI)
`tests/no-pii-in-repo.test.mts` fails on ANY 998-prefixed phone-like number in tracked files unless it is in its synthetic allowlist. In code, comments and tests use ONLY these fixtures: +998901234567, +998901112233, +998907654321, +998900000001, +998900000002 (or masked forms like "+998 ** *** ** 67"). Always run tests/no-pii-in-repo.test.mts before reporting.

## Conventions settled during foundation (use them)
- Server list endpoints: `parseListParams(url, spec)` / `buildKeyset` / `keysetSelect` / `pageResult` / `countCapped` / `parseDateRange` / `classifyUserQuery` / `likePrefix` from `lib/server/admin-list.ts`. Multi-select filters are comma-joined (`status=FAILED,QUEUED`) → use filter kind `enumList`. Spec `id` carries the SQL type: `{ column: "g.id", type: "uuid" }` or `{ column: "u.id", type: "bigint" }`.
- CSV: `csvResponse` + `keysetBatches`/`flattenBatches` from `lib/server/admin-csv.ts` (pass `CSV_MAX_ROWS + 1` as maxItems).
- Masking: `maskPhone`, `maskValues` from `lib/server/admin-mask.ts`.
- Missing admin resource → `ApiError("Topilmadi", 404, { code: "not_found" })` (so the client can tell it from the "not an admin" cloak).
- Client: import `ApiError`, `adminGet`, `adminSend`, `newIdempotencyKey`, `ListResult` from `lib/admin-api/core.ts`; UI from `components/admin/ui` (barrel). Mount nothing global yourself — the admin layout (F3b) mounts Toaster and StepUpProvider.
