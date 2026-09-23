# Review — W3-I (C05: DEPS-01 / DEPS-08 / INFRA-10, repo PII hygiene)

Branch `worktree-agent-aa915e0b1058969ac` (`cfed8f6`, `8e7a04b`, `1b8433f`) vs `audit/production-readiness`.
Reviewer: independent, read-only. Real phone digits and IPs are deliberately NOT reproduced here.

## Verdict: **CHANGES REQUESTED**

The direction is right, and most of the work is solid. README/docs/scripts placeholders are in, smoke/eval fail fast, `ADMIN_PHONES` replace semantics are correct, and the untrack is correctly covered by `.gitignore`. The four target tests pass: 24/24 through `heavy2.sh`, DB-backed ones included.

The package does not yet fully meet "no owner phone in tracked files, and a test that stops regressions":
- One owner number is still tracked.
- The guard test cannot see it.
- The documented owner step for `ADMIN_PHONES` does nothing in the Docker deployment.

A trial merge into the current `audit/production-readiness` merges cleanly. The base has since redacted `audit/`, so after the merge the only IP-prefix text left is the new test's own comment.

## Findings

### 1. Leftover PII (check 1)
- **IP:** the branch has no full prod IP outside `audit/`. The base branch already redacted `audit/findings/infra-devops.md`. However, `tests/no-pii-in-repo.test.mts:35` writes the first two octets of the prod IP in a comment, and its pattern (line 39) contains them too. That publishes the /16 of the server in a public file.
- **Owner's second number** (the old SMOKE/EVAL default, S2): removed from README/docs/AUDIT.md/smoke/eval/seed-demo. **It is still tracked in `docs/research/slaydtop-a-test-atestatsiya-infografika.md:4`**, written with spaces (`+998 NN NNN NN NN`) next to the owner's first name. The fixer missed it, and the guard test cannot see it (see 4).
- **Admin number** (S1):
  - `lib/server/admin-phones.ts:33`: the deliberate fallback. Accepted.
  - `lib/server/admin-phones.ts:38-40`: the `normalizePhone` doc comment repeats the real admin number in three formats (spaced, contiguous, dashed, and the 9-digit form). These are not the fallback. They will survive when the owner deletes the fallback line.
  - `tests/admin.test.mts:15-25` and `tests/admin-contact.test.mts:51-53,246-247`: already on the base.
  - **New `tests/admin-phones-env.test.mts:20,29,41,48`: the new test adds 4 more copies of the real admin number.** This work adds new instances of the PII it is meant to remove, and the blanket `tests/` allowlist hides them.
- Every other phone-shaped literal (components, `lib/phone.ts`, resume samples, `run-build.mts`/`eval-services.mjs`/`live-engine.mts`/`seed-demo.mts`, other tests) matches neither owner number, and their digit shapes look synthetic (repeated pairs, sequential runs).
- **Co-tenant names:** removed from README and AUDIT-15. `docker-compose.yml:48` still names two co-tenant projects in a comment. Not touched by this package, and not covered by the test.

### 2. `ADMIN_PHONES` semantics (check 2)
- Unset, `""`, `"   "` and `" , ,"` all fall back to the hardcoded list. Probed: nobody becomes admin unexpectedly.
- Set: the env list **replaces** the fallback, no merge. Tested.
- Comparison uses W1-A's `strictDigits` (exact digits, no 9-digit expansion). A 9-digit env entry therefore never matches a stored 12-digit phone. This fails closed, which is correct.
- `session.ts:110`, `admin.ts:21`, `telegram.ts:374` and `app/uz/admin/page.tsx:18` all go through `isAdminPhone`. Consistent.
- Edge case (should-fix, not reachable today): an env entry with no digits (for example a typo like `ADMIN_PHONES=abc`) puts `""` into the set. Any non-empty digitless phone then counts as admin (probed: `"-"` returns true). Today `users.phone` is always `+<≥7 digits>` (`telegram.ts:349`), so this cannot be exploited. Still, drop entries whose digit count is not 12 (or at least 0), and log a warning.
- **The owner step cannot work as written.** `docker-compose.yml` passes environment variables to `web` as an explicit list (no `env_file`). Adding `ADMIN_PHONES` to `/opt/slaydx/.env` does **not** reach the container. The fallback keeps admin working, so this is harmless today. But the next step the comment prescribes is "then delete the hardcode". After that, the admin loses access and nothing warns. `.env.example` also documents neither `ADMIN_PHONES` nor `SMOKE_USER`/`EVAL_USER`.

### 3. Untrack of `.claude/*` (check 3)
- `.gitignore:60` `/.claude/` covers `deploy.md`, `holat.md`, `structure.md`, `actions/*` and the rest (checked with `git check-ignore -v`). `git add -A` will not add them again. Only `git add -f` would, which is how they got in originally.
- **Prod:** after deploy, `git reset --hard origin/main` on the box **will delete** `/opt/slaydx/.claude/{deploy,holat,structure}.md` and the two tracked `actions/*` files, if that checkout has them. Nothing at runtime reads them:
  - `.dockerignore:19` excludes `.claude`.
  - The references in `docker-compose.yml:58,160` and `scripts/backup.sh:10` are comments only.
  - `deploy.sh` is not tracked.
  
  They are documentation only. Losing them on the box is harmless.
- **Local copies:** they survive in the fixer's worktree (`git rm --cached`). **They do NOT survive the merge in the main checkout.** In `/home/.../slaydx` the files are tracked and identical to HEAD, so `git merge` of `1b8433f` removes them from disk. Verified by a trial merge in a scratch worktree: `.claude/` was gone afterwards. The untracked third `actions/` file and `escalations.log` survive. Back these up before the merge (owner step A).

### 4. `no-pii-in-repo` test quality (check 4)
- False positives: none today (the test passes). `998[0-9]{9}` has no digit boundaries, so it could match inside a longer digit run in future (hashes, IDs). Add `(^|[^0-9])…([^0-9]|$)`.
- **Bypassable:** the pattern only matches 12 contiguous digits. `+998 NN NNN NN NN`, dashed forms and the 9-digit national form all pass. The missed leak in `docs/research/…:4` proves this.
- **Allowlist is too coarse:**
  - Whole files are allowlisted: `scripts/eval-services.mjs`, `run-build.mts`, `live-engine.mts`, `seed-demo.mts`, `lib/server/admin-phones.ts`, `docs/AUDIT-15.md`. So reintroducing the owner number as the EVAL default in `eval-services.mjs` would **not** be caught. Neither would new admin-number copies in `admin-phones.ts` (lines 38-40 already show this).
  - The whole of `tests/` is allowlisted.
- `:!audit/**` is excluded. Its justification (unmasked values in audit docs) is stale, because the base redacted them in `6a415f0`.
- The IP pattern hard-codes the real /16 (see 1).

### 5. `SMOKE_USER` / `EVAL_USER` (check 5)
- `smoke.mjs:19-23` exits 1 with a clear message when neither `SMOKE_USER` nor `SMOKE_COOKIE` is set.
- `eval-services.mjs:530-533`: `login()` returns false with a clear message, and the caller exits 2 (`:679`).
- No script still defaults to a real account. OK.

### 6. Tests (check 6)
`tests/admin-phones-env`, `no-pii-in-repo`, `admin`, `admin-contact`: **24 pass / 0 fail** (heavy2 gate, `DATABASE_URL` set).

## Required changes

1. **Remove the remaining owner number** from `docs/research/slaydtop-a-test-atestatsiya-infografika.md:4` (use `<OWNER_PHONE>`).
2. **Stop adding the real admin number to tests:**
   - `tests/admin-phones-env.test.mts` must use only synthetic numbers.
   - For the "unset falls back" and "empty falls back" cases, assert against a fallback exported for tests (for example `export const __FALLBACK_FOR_TESTS`), or set `ADMIN_PHONES` to a fake value and check that fallback-vs-replace behavior follows, without spelling out the number.
   - Replace the three formatted examples in `lib/server/admin-phones.ts:38-40` (doc comment) with synthetic numbers, so the fallback line is the only copy.
   - Optionally, move `tests/admin.test.mts` and `tests/admin-contact.test.mts` to a fake admin injected via `ADMIN_PHONES` (the new env makes this possible).
3. **Harden `tests/no-pii-in-repo.test.mts`:**
   - Match a separator-tolerant, boundary-anchored pattern, for example `(^|[^0-9])\+?998[ ().-]{0,3}[0-9]{2}[ ().-]{0,3}[0-9]{3}[ .-]?[0-9]{2}[ .-]?[0-9]{2}([^0-9]|$)`. Normalise each hit to digits.
   - Replace the file/prefix allowlist with a **value allowlist**: a small set of known synthetic fixture numbers, digits only, allowed anywhere. Any other 998-number fails, with at most one explicit `(file, line)` exception for the `admin-phones.ts` fallback until the owner deletes it.
   - Include `tests/` and `audit/` in the scan (audit is redacted on base; re-verify after the merge).
   - Replace the IP check with a generic public-IPv4 detector. Allowlist loopback, private, doc and `0.0.0.0` ranges, plus the Docker/test ports already in the repo, so the test file no longer contains the real /16. Remove it from the comment at `:35` as well.
   - Error output must stay `file:line` only, as it already is.
4. **Make `ADMIN_PHONES` reachable in prod:**
   - Add `ADMIN_PHONES: ${ADMIN_PHONES:-}` to `web.environment` in `docker-compose.yml`, and to `worker` if any worker path imports `admin-phones`. `:-` yields `""`, which falls back correctly.
   - Document `ADMIN_PHONES`, `SMOKE_USER` and `EVAL_USER` in `.env.example`, with placeholder values.

Should-fix (non-blocking):
- (a) Drop `ADMIN_PHONES` entries whose digit count ≠ 12 and log a warning (fail-open on a digitless typo, see 2).
- (b) Genericise the co-tenant names in the `docker-compose.yml:48` comment.
- (c) Consider genericising the owner's full name used as demo resume content in `scripts/seed-demo.mts:82` and the research doc.

## Owner steps (after merge)

A. **Before merging into the main checkout:** `cp -a .claude/{deploy,holat,structure}.md .claude/actions ~/slaydx-claude-backup/`. After the merge, copy them back. They are gitignored, so they stay local.
B. On prod: back up `/opt/slaydx/.claude/` in the same way before `deploy.sh`, if you want those notes kept on the box. Nothing at runtime needs them.
C. Add `ADMIN_PHONES=<your number(s), comma-separated, full 998… form>` to `/opt/slaydx/.env` (only effective after required change 4). Redeploy. Confirm `/uz/admin` still opens for you and returns 404 for a non-admin.
D. Only after C is verified: delete the hardcoded fallback line in `lib/server/admin-phones.ts` and its test exception (next PR).
E. Put `SMOKE_USER` / `EVAL_USER` in your local `.env.local`.
F. The numbers and IP remain in git history. History rewrite is out of scope, so treat them as public. If that matters, consider changing the SIM or number used for admin login, and rely on the OTP flow.

---

## Re-review (branch at `943af2b`, 2026-09-24)

### Verdict: **APPROVE**

All four required changes are resolved: R1–R3 on this branch, R4 on W3-F. Checked with my own greps against `git grep` on `943af2b`. No digits are reproduced here.

- **R1 fixed.** The owner's second number no longer appears anywhere in tracked files, in any format: contiguous, spaced/dashed/parenthesised, or the 9-digit national form. The research doc now uses a placeholder.
- **R2 fixed.**
  - The real admin number now appears in exactly **one** place: the fallback line `lib/server/admin-phones.ts:34` (`ADMIN_PHONES_FALLBACK`). No other copy exists in contiguous, separator or national form.
  - `tests/admin.test.mts`, `tests/admin-contact.test.mts` and `tests/admin-phones-env.test.mts` derive the value at runtime from `ADMIN_PHONES_FALLBACK_FOR_TESTS`.
  - The doc-comment examples are now synthetic.
- **R3 fixed.**
  - Phone regex: separator-tolerant, boundary-anchored lookarounds. Hits are normalised to digits and checked against a **value** allowlist: 9 synthetic numbers plus 2 publicly published third-party numbers.
  - The admin value is permitted only in `admin-phones.ts`.
  - Neither owner number (nor its national form) is in any allowlist.
  - The IP check is a generic IPv4 detector with reserved/private/doc ranges plus a small allowlist of fixture and Telegram ranges. The real /16 is gone from the file.
  - Scope covers the whole tree, including `tests/` and `audit/`.
  - **Mutation check:** in a scratch worktree I appended `+998 (NN) NNN-NN-NN` (a synthetic, non-allowlisted number) and a random public IPv4 to `README.md`. Both tests failed and reported only `README.md:<line>`. Removed afterwards.
- **R4 done in W3-F** (`worktree-agent-ae21573768702bf19` @ `9d5d584`): `ADMIN_PHONES: ${ADMIN_PHONES:-}` is on both `web` and `worker` in `docker-compose.yml`. `:-` yields `""`, which falls back correctly. It is not on this branch, so merge order is irrelevant: until both land, the fallback keeps admin working.
- **Untrack:** `.claude/*` is still removed from the index, and `.gitignore:60` still covers it. The earlier warning still applies: merging into the main checkout deletes those five files from disk (owner step A).
- **Tests** (heavy2, `DATABASE_URL` set): `admin-phones-env`, `no-pii-in-repo`, `admin`, `admin-contact`: **24 pass / 0 fail / 0 skip**.

### Remaining should-fix (non-blocking, follow-up PR)
1. `.env.example` still documents neither `ADMIN_PHONES` nor `SMOKE_USER`/`EVAL_USER`. Check whether W3-F added them; if not, add placeholders.
2. `tests/admin.test.mts` and `tests/admin-contact.test.mts` assume the fallback is active. If a developer or CI has `ADMIN_PHONES` exported, they fail. Add `delete process.env.ADMIN_PHONES` before the dynamic import. Both tests need rework anyway when owner step D removes the fallback.
3. `grepMatches` uses `git grep -P -o` without `-I`. A binary file that matches would produce a "Binary file … matches" row that gets parsed as a hit. Add `-I`.
4. The fallback exception is file-scoped, not line-scoped. A second copy inside `admin-phones.ts` would pass. Acceptable for one file; could pin it to the `ADMIN_PHONES_FALLBACK` line.
5. The earlier items still stand: filter digitless `ADMIN_PHONES` entries, and the co-tenant names in the `docker-compose.yml:48` comment.

Owner steps A–F above are unchanged.
