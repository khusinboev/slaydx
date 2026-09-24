# Review: W4 gate test fixes (commit `cb7aee3`)

Reviewer: independent, read-only. Scope: the 5 assertion changes in `tests/telegram-429.test.mts`, `tests/env-assert-runtime-config.test.mts`, `tests/credits-atomic.test.mts`, `tests/no-pii-in-repo.test.mts`, and the progress-log entry in the same commit.

I ran the 4 files once through `heavy2.sh`, at HEAD `2888842` (= `cb7aee3` + a later audit commit). Credits-atomic, env-assert (11/11) and the phone-number subtest passed. **The no-pii IPv4 subtest FAILED.** See item 4. I cut my capture of the run short (`head -60`), so I never saw the telegram-429 results. I checked that file by reading the code; details are in item 1.

## Overall verdict: **CHANGES**

The four test changes are correct. None of them hides a production regression. However, the commit's own `audit/03-progress.md` text adds two unknown public IPv4 literals, and those literals make `no-pii-in-repo` fail. The claim "no-pii passes 2/2" is therefore false for the tree this commit produces.

---

## 1. telegram-429: `false` → `TelegramTransientError`. **APPROVE**

- `lib/server/telegram.ts:125-141`: `sendMessage` always passes `{ throwTransient: true }`.
- `call()` at `:95-99` throws on a network or JSON error.
- `:110-112` throws on 429 or ≥500 once the single allowed retry is used up. A `retry_after` longer than the 5 s cap skips the retry and throws right away, which matches the second test (`at.length === 1`, < 500 ms).
- A 400 or 403 still returns `null`, so `sendMessage` returns `false`. The test at `tests/telegram-429.test.mts:58-62` still covers that case.

**Who calls `sendMessage`.** A repo-wide grep finds calls only inside `lib/server/telegram.ts`: `sendLoginLink` (`:405`), `handleContact` (`:463-499`) and `processUpdate` (`:555-598`). All of them run under `handleUpdate` (`:515`). Nothing else calls it: no worker or notification code, no `app/api/auth/telegram/{ticket,enter}` route, no admin code, no script. Those modules import only `createTicket`, `redeemLoginToken`, `peekLoginToken`, `setBotCommands` and `getMe`, and those still use the non-throwing `call()`.

**Who catches the throw.** There are two entry points into `handleUpdate`:
- `app/api/telegram/webhook/route.ts:52-68` catches the error. A retryable error returns 500; a deterministic one returns 200.
- The long-polling `scripts/bot.mts:77-83` wraps each update in try/catch. There the update is logged and dropped, because the offset has already advanced. That is the same graceful behaviour as before.

**Dedupe and redelivery.** `handleUpdate` (`:515-531`) runs `claimUpdate` (INSERT … ON CONFLICT). If the update fails, `releaseUpdate` deletes the mark and the error is rethrown. Each `processUpdate` branch sends **at most one** message, and that message is the last side effect. So there is no "sent one message, then threw on the next" path. A redelivery can repeat a message only when the Telegram timeout was ambiguous (the message was delivered but the response was lost). In that case:
- `/start <nonce>`: `attachTicket` (`:203-215`) rotates `token_hash`. The first link, if it arrived, becomes invalid and only one link works. Nothing is granted twice.
- `/start` and `/login`: `createBotLoginLink` makes a second one-time link. Both links go to the same user's own chat and log in the same identity, so this is not an escalation.
- Contact / admin: the `UPDATE users SET phone` is idempotent. Admin rights are re-derived from `isAdminPhone` every time, so the worst case is a duplicate "✅ Admin sifatida tasdiqlandingiz" message.
- The bot path has no bonus, credit or other money grant. Users are created on redeem, not in the bot.

The known "N2" lease gap (a concurrent redelivery can lose an update) is documented at `:356-361`. It is not something this commit introduced. `tests/telegram-webhook.test.mts:136-190` already covers the redelivery behaviour, including "exactly ONE message" and "no third".

## 2. env-assert: new problem text plus a negative case. **APPROVE**

- `lib/server/env.ts:347-348`: the problem is raised only when `!telegramWebhookSecret()`, which is `TELEGRAM_WEBHOOK_SECRET || CRON_SECRET` (`:301-302`). Its text is exactly `TELEGRAM_WEBHOOK_SECRET (yoki zaxira CRON_SECRET) yo'q — Telegram webhook'ni himoyalab bo'lmaydi`.
- The positive test removes both keys. It no longer depends on the developer's shell, because it deletes `TELEGRAM_WEBHOOK_SECRET` explicitly.
- The negative test is meaningful. It fails if someone makes `CRON_SECRET` mandatory again, which was the pre-EXT-14 behaviour. Its regex (`himoyalab bo'lmaydi`) and the positive regex both match parts of the same message, so a wording change would break the positive test first rather than leave the negative one passing vacuously.
- Nit (optional): `TELEGRAM_WEBHOOK_SECRET` is not in `CLEAR_KEYS` (`tests/env-assert-runtime-config.test.mts:28`). Also, the fallback case (`TELEGRAM_WEBHOOK_SECRET` missing, `CRON_SECRET` set, so no problem) is only covered implicitly by the "good config" test.

## 3. credits-atomic: repeated DELETE 409 → 404. **APPROVE**

- `app/api/generations/[id]/route.ts:79-91`: `cancelGeneration` returns false because the row is gone, and `deleteGeneration` also returns false. `generationStatus(id, user.id)` then returns `null` (`lib/server/jobs.ts:582-588`), so the route answers 404. 409 is now used only when the row still exists (it is IN_PROGRESS or racing). This is the intended BEA-12 contract (`8910a18`).
- The test itself proves the row is gone: `status(r.id) === null` at `tests/credits-atomic.test.mts:103`. So 404 is the only consistent answer.
- The money invariant is still checked. `balance === 10_000` after the second DELETE (`:108`) would catch a second refund, which would make it 13 000. The refund runs in the same transaction as `status='QUEUED' → REVOKED` (`jobs.ts:603-616`), so a missing row cannot refund.
- Nit (optional): also assert `refunds(r.id) === 1` after the repeat. That would make the ledger invariant explicit instead of relying on the balance.

## 4. no-pii: allowlist plus CGNAT. **CHANGES**

The test change itself is correct:
- Every allowlisted IP appears only as a stubbed DNS-lookup fixture: `tests/safe-fetch.test.mts:17-23,58,173`, `tests/engine-deadline-cost.test.mts:55`, `tests/image-providers-free.test.mts:17`, `tests/slide-research.test.mts:57`, `tests/tts-aisha.test.mts:110`. No test makes a network call with them.
- They are well-known third-party addresses (example.com, Google DNS, Cloudflare 104.16/13, Google 142.250/15) or a RIPE-block placeholder. `172.32.0.1` is the first address above 172.16/12.
- None of them is in the production server's /16. `git grep` finds no occurrence of that prefix.
- `100.64/10` (100.64–100.127) is correct per RFC 6598 and is not publicly routable.
- The allowlist is exact-match only, so any other public IP still fails.

**Blocking problem.** The same commit's `audit/03-progress.md:73` contains the mutation-check literals `185.9.9.9` and `100.128.0.1`. Both are public addresses that are not on the allowlist. The subtest "tracked fayllarda ommaviy (real) IPv4 manzili yo'q" **fails** at `cb7aee3` and at HEAD. I reproduced it both through the test run and with the scanner regex over `git grep`, where these two are the only hits. The upside is live proof that the scanner catches new unknown public IPs, including the 100.128 value just outside CGNAT. The gate claim "no-pii passes 2/2" was presumably true before the progress log was written.

**Fix.** Reword `audit/03-progress.md:73` so it contains no raw public IPv4. For example: "an injected unknown public IP (185.x) and the first address above CGNAT are both still caught", or use backtick-split placeholders such as `185.9.9.x`. Then re-run `tests/no-pii-in-repo.test.mts`. Do not allowlist these two values, because that would weaken the mutation evidence for no benefit.

Minor, not blocking: 100.64/10 is also Tailscale's range. A developer's tailnet IP committed to the repo would now pass. It is not internet-routable, so it is acceptable as a PII risk.

---

## Summary

| # | File | Verdict |
|---|------|---------|
| 1 | tests/telegram-429.test.mts | APPROVE |
| 2 | tests/env-assert-runtime-config.test.mts | APPROVE (2 optional nits) |
| 3 | tests/credits-atomic.test.mts | APPROVE (optional `refunds === 1` nit) |
| 4 | tests/no-pii-in-repo.test.mts + audit/03-progress.md:73 | **CHANGES**: the progress log adds `185.9.9.9` and `100.128.0.1`, and no-pii fails |

**Overall: CHANGES** (item 4 only). No production regression is hidden. Once line 73 no longer contains the raw IPs, this becomes APPROVE.
