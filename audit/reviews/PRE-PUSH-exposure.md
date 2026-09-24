# Pre-push exposure review — `audit/production-readiness` (76ddf91..HEAD)

Independent, read-only secret/PII/exposure scan ahead of the two-stage publish
of this branch to the **public** GitHub repo. Scope, method and rules per the
task brief; no secret is reproduced in full below (first 4 chars + length +
`file:line` only, where a hit existed at all — in this review there were no
real secret hits to redact).

## BLOCKERS

### Before stage B (full history incl. `audit/` merge) — 1 blocker

1. **`tests/no-pii-in-repo.test.mts` currently FAILS against `audit/03-progress.md:73`.**
   That line documents a mutation-testing check for the IP-allowlist test
   itself and contains two literal dotted-quad IPv4 addresses (starting
   `185.9.` and `100.128.`) used only as arbitrary "not on the allowlist"
   examples. Verified these two addresses:
   - appear **nowhere else** in the tracked tree or in the full branch
     history (`git grep` / full `git log -p` added-lines scan) — they are
     not real infrastructure, not the prod IP, not tied to any credential.
   - are not on `KNOWN_PUBLIC_IP_ALLOWLIST` in the test, so the test's own
     "no public IPv4 in tracked tree" guard trips on its own audit note.

   Not a real exposure, but it **will break this repo's own PII/CI guard**
   the moment `audit/` is merged in stage B (ran it locally: `1 fail / 2`
   in `tests/no-pii-in-repo.test.mts`, the phone-number subtest passes).
   Fix before stage B: either add those two addresses to
   `KNOWN_PUBLIC_IP_ALLOWLIST` in `tests/no-pii-in-repo.test.mts`, or reword
   `audit/03-progress.md:73` to not spell out literal dotted-quad addresses
   (e.g. "an injected public IPv4 outside the allowlist").

**Stage A (non-`audit/` tree) has no blockers** — see NOTES for two
non-blocking gaps worth a look.

## NOTES

1. **`loadtests/results/` is not fully gitignored.** Root `.gitignore` has no
   entry for it at all; `loadtests/.gitignore` only excludes
   `results/smoke-*/` and `results/*/stack/logs/`. A load test currently
   running is writing real output to `loadtests/results/before/*`
   (untracked — `git status` shows `?? loadtests/results/`). Scanned its
   current contents: no secrets, no real IPs (`run.env` only has local
   labels; k6/metrics files reference localhost). Not an active leak since
   nothing is staged/tracked, but recommend broadening
   `loadtests/.gitignore` (e.g. a bare `results/` line) so a future
   `git add -A`-style operation can't accidentally commit load-test
   artifacts.

2. **`audit/REPORT.md` is untracked** (`git status`: `?? audit/REPORT.md`,
   369 lines). Scanned it directly (it predates any commit, so it wasn't
   covered by the `git log -p` history scan) — clean: no secrets, no phone
   numbers, no real IPs (only `127.0.0.1`), no emails. Will need an
   explicit `git add` to be part of stage B if it's meant to ship; flagging
   only because it currently sits outside both the tree scan and the
   history scan.

3. **Prior known-public values, confirmed unchanged / already fixed, not new
   exposure:**
   - Prod server IP `<SERVER_IP>` — appears in `.claude/deploy.md`
     content history and in 2 added lines inside `audit/` (ssh command
     references). Matches the already-public IP called out in the task
     brief; not newly introduced.
   - Owner/admin phone numbers ending `…896` — there are **two distinct**
     `+998…896` numbers, both already public at `76ddf91` before this
     branch: `…976063896` (the admin-phones fallback constant, still the
     sole occurrence in `lib/server/admin-phones.ts` at HEAD) and
     `…997333896` (the owner's real account, previously hardcoded in
     `.claude/deploy.md`, `docs/AUDIT.md`, `scripts/eval-services.mjs`,
     `scripts/seed-demo.mts`, `scripts/smoke.mjs` at `76ddf91`). **Good
     finding: this branch actually removed `…997333896` from every one of
     those files** — `git grep` at HEAD finds zero occurrences anywhere in
     the tracked tree. `scripts/eval-services.mjs` / `scripts/smoke.mjs`
     now require `EVAL_USER`/`SMOKE_USER` env vars with no real default;
     `scripts/seed-demo.mts` now uses the synthetic `+998901234567` with an
     explicit "namunaviy (haqiqiy emas)" comment. No number ending `…088`
     was found anywhere in the tree or history (checked explicitly, per
     the task's specific ask).
   - No number ending `…088` found anywhere (tree or full history).

4. **No blockers found for the exploit-reproduction check (task 4).**
   `SECA-01` (forged Telegram contact), `returnTo`/`javascript:` XSS, zip
   bomb, and free-LLM-abuse are referenced only as bug-class names in code
   comments and unit tests (e.g. `tests/admin-contact.test.mts`,
   `lib/server/telegram.ts`, `lib/safe-return.ts`,
   `tests/ui/login-returnto.test.mts`, `lib/extract-text.ts`,
   `lib/generation/translate/xml-scan.ts`). These explain root cause and
   assert the fix against a hermetic test DB / stubbed fetch — no live
   prod URLs, no working curl/PoC against the deployed instance, no bypass
   of `TELEGRAM_WEBHOOK_SECRET`. This is at or below the level of detail
   the fix diff itself already discloses (the code is going public
   regardless), so it does not meet the "materially more useful to an
   attacker than the fix diff" bar. No regex-freeze/ReDoS-specific material
   found (no hits for that vuln class in the diff at all).
   `README.md` § "Xavfsizlik" describes protections in prose (standard for
   a public repo's security section), no reproduction steps.

5. `.env.example`, `docker-compose.yml`, `.github/workflows/ci.yml`,
   `deploy/nginx/slaydx.conf.example` — all placeholder/local values only
   (`postgres://slaydx:slaydx@localhost…`, `POSTGRES_PASSWORD: slaydx` in
   CI, `127.0.0.1` upstream in nginx example, `server_name slaydxx.uz` —
   the product's own public domain, not sensitive).

6. Fixture/fake secret-shaped values seen in tests are all clearly synthetic
   (`sk-ant-api03-abcdefghijklmnop`, `xai-ABCDEFGHIJKLMNOP`,
   `payme-live-key`, `click-secret-key`, `loadtest-cron-secret-not-real`,
   `test-session-secret-at-least-32-characters…`) — listed here only
   because the task asked for real-looking fixture values to be surfaced;
   none of these are real.

## `.gitignore` / tracked-path check (task 3)

- `.env*` ignored except `.env.example` (confirmed via `git check-ignore`
  on `.env`, `.env.local`, `.env.production`, and confirmed `.env.example`
  is NOT ignored and IS tracked, as intended).
- `.claude/` — ignored (`/.claude/` rule) **and confirmed untracked at
  HEAD** (`git ls-tree HEAD -- .claude` empty). It **was** tracked at
  `76ddf91` (5 files, including `deploy.md` with the owner phone/IP
  discussed above) and was removed from tracking during this branch
  (`git diff --name-status 76ddf91..HEAD -- .claude/` shows all 5 as `D`).
  This is a fix landing in this branch, not a regression.
- `eval-out/` — ignored, confirmed via `git check-ignore`; not tracked.
- `loadtests/.state/` — ignored via `loadtests/.gitignore`; not tracked.
- `loadtests/results/` — **not ignored** at the root level (see NOTES §1);
  not currently tracked either way.
- `git ls-files` swept for any of the above paths: only `.env.example` is
  tracked, as expected.

## What was scanned (commands)

```
# File-list scope for stage A (tree at HEAD, excluding audit/)
git diff --name-only 76ddf91..HEAD -- . ':!audit'      # 408 files

# Task 1 — secret/PII regex sweep over that file list, e.g.:
grep -n -E 'AIza[0-9A-Za-z_\-]{35}' <files>
grep -n -E 'sk-ant-[A-Za-z0-9_\-]{10,}' <files>
grep -n -E 'xai-[A-Za-z0-9]{10,}' <files>
grep -n -E '\bsk-[A-Za-z0-9]{20,}' <files>
grep -n -E '[0-9]{8,10}:[A-Za-z0-9_-]{35}' <files>          # Telegram bot tokens
grep -n -E 'BEGIN (RSA|EC|OPENSSH|DSA)? ?PRIVATE KEY' <files>
grep -n -E 'AKIA[0-9A-Z]{16}' <files>                        # AWS keys
grep -n -E 'eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}' <files>  # JWT
grep -n -E '[a-zA-Z][a-zA-Z0-9+.-]*://[^/\s:]+:[^/\s@]+@' <files>   # creds in URLs
grep -n -E '(SECRET|PASSWORD|MERCHANT_KEY|API_KEY|PRIVATE_KEY|CLIENT_SECRET|
            ACCESS_TOKEN|BOT_TOKEN|PAYME_KEY|CLICK_SECRET)\s*[:=]\s*[...]' <files>
grep -n -E '\+?998[0-9]{9}' <files>                          # UZ phones
grep -n -E '\b([0-9]{1,3}\.){3}[0-9]{1,3}\b' <files>          # IPv4, filtered to public ranges
grep -n -oE '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}' <files>  # emails
cat .env.example   # manual read, confirmed placeholders only

# Task 2 — full history, added lines only
git log -p --no-color 76ddf91..HEAD > fulllog.patch     # 71,305 lines
grep -E '^\+[^+]' fulllog.patch | sed 's/^\+//' > added_lines.txt   # 42,765 lines
# same regex sweep as above, run against added_lines.txt
# cross-checked specific digit sequences against 76ddf91 with:
git grep -n "<digits>" 76ddf91 -- .
git grep -n "<digits>" HEAD -- .

# Automated check (repo's own guard, run for cross-verification):
node --import tsx --test tests/no-pii-in-repo.test.mts
  # -> phone subtest: pass; IPv4 subtest: FAIL on audit/03-progress.md:73 (see BLOCKERS)

# Task 3 — gitignore / tracked-path check
cat .gitignore
git ls-tree -r --name-only 76ddf91 -- .claude
git ls-tree -r --name-only HEAD -- .claude
git check-ignore -v .env .env.local .env.production .env.example
git check-ignore -v eval-out/x.json "loadtests/results/x.json" "loadtests/.state/x" ".claude/foo"
git ls-files | grep -E '(^|/)\.env($|\.)|eval-out/|loadtests/results/|loadtests/\.state/|^\.claude/'
git status --short   # untracked-file sweep: audit/REPORT.md, loadtests/results/

# Task 4 — exploit-reproduction sweep on non-audit tracked files
grep -n "SECA-01" <files>
grep -n "javascript:" <files>
grep -l "returnTo" <files>
grep -ni "zip.bomb\|zip_bomb" <files>
grep -ni "redos\|regex.*freeze\|catastrophic backtrack" <files>
grep -ni "free.llm.*abuse\|llm.*abuse" <files>
grep -rn -i "seca-01|zip bomb|redos|forged contact|admin takeover|javascript:" loadtests/
grep -n -i "curl.*telegram\|poc\|proof of concept\|exploit" docs/AUDIT.md docs/AUDIT-15.md README.md
# + manual read of tests/admin-contact.test.mts, lib/server/telegram.ts (SECA-01 comments),
#   lib/safe-return.ts, README.md "Xavfsizlik" section
```
