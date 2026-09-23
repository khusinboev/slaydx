# Review W1-E: C10 free-LLM spend policy

- Branch: `worktree-agent-a5140076c1a3aa4f8` @ `890ce4b`
- Reviewer: independent read-only review, 2026-09-23
- Scope: `lib/server/spend.ts` (new), `lib/server/ratelimit.ts`, `lib/server/env.ts`, the 4 routes (`outline`, `article/udk`, `generations/[id]/rewrite`, `generations/[id]/polish`), `docker-compose.yml`, `.env.example`, `tests/free-llm.test.mts`
- Findings: EXT-02, ABUSE-01, CONC-11, CONC-13, SCALE-14, BEA-11

## Verdict: **CHANGES REQUESTED** (two small fixes; the P0 itself is closed)

The money hole is closed:
- All four endpoints now have a per-user daily cap on the Tashkent day.
- A weighted global daily cap returns 503.
- `FREE_LLM_DISABLED` returns 503 with no provider call.
- rewrite and polish require money actually spent on the document (balance or Pro quota, net of refunds).
- The buckets fail closed.

Both required changes are in the new single-flight lease. One is a correctness bug. The other leaves part of BEA-11 open.

## Test runs (through the gate, throwaway DB `127.0.0.1:55439`)

- `tests/free-llm.test.mts`: **13/13 pass** (7 top-level, 6 Postgres subtests), 0 skipped, so the DB part really ran.
- `tests/compose-env.test.mts`: **2/2 pass**.
- The tests check behaviour, not mocks:
  - They use real `rate_limits` UPSERTs and real `generations` and `transactions` rows.
  - They swap the pool to prove the kill switch touches no DB and that the limiter fails closed.
  - They cover the Tashkent boundary at 18:59 / 19:01 / 00:30 UTC.
  - They cover bonus-only → 402, legacy (no charge row) → 402, full refund → 402, and points + balance or quota → allowed.
  - They check that a foreign user gets 404 and burns no buckets, and that a stale version gets 409 before any bucket is used.
  - They cover 409 `busy`, lease release after a throw, and that no provider calls happen after an abort.

## Adversarial checks

| # | Check | Result |
|---|---|---|
| 1 | **Bypass: other request-path LLM calls** | None. `grep` of `app/api` and `lib/server`: `llm-roles` is imported at runtime only by `article-rewrite.ts`, `doc-polish.ts` and `spend.ts`. All polish engines import `llm-roles` as a type only and get `complete` injected. `extract`, `curriculum`, `rebuild`, `slides/*/image`, `o/*/submit`, `telegram/webhook` and the drafts make no provider calls, which matches verify-money.md. The route probe test locks `withFreeLlm(` before the provider call in all 4 routes. |
| 1 | **Paid check** | Sound. `paid = Σcharge(−(quota+balance)) − Σrefund(quota+balance)`, filtered on `t.user_id = g.user_id` and `g.user_id = $2`. Quota and balance are in the same coin unit (`splitFor`). A full refund gives 0 → 402. A partial refund stays > 0, which is correct because real money was kept. `refund` is idempotent per reference (one refund row). A missing charge row (legacy doc, or price 0) → 402, the safe default. Another user's doc → 404. `admin_credit` to balance or quota counts as paid; that is the admin's choice, see nit N4. |
| 1 | **Atomic counters, before the provider** | Yes. A single `INSERT … ON CONFLICT DO UPDATE SET hits = hits + EXCLUDED.hits RETURNING hits`, run before `run()`. N concurrent requests cannot go past the cap. |
| 2 | **Day boundary** | `windowStartOf(now, 86400, 18000) = floor((now+5h)/1d)·1d − 5h`, which gives 19:00 UTC. It is correct and there is no DST (Uzbekistan has none). The key is `(bucket, window_start)`. `RATE_LIMIT_PURGE_INTERVAL = 25 hours` is longer than a Tashkent window, which is at most 24 h old, so daily rows survive the purge. |
| 3 | **Kill switch / global cap** | `assertFreeLlmEnabled()` runs right after `requireUser` (the session read is the only DB work before it), and again inside `withFreeLlm`. The messages are in Uzbek. `app/api/generations/route.ts` and the paid path are untouched. |
| 4 | **Fail-closed scope** | Only `spend.ts` passes `failClosed: true`. `rateLimit(bucket, n, w)` stays compatible because the new param is optional, and `limit()` and `auth/telegram/enter` keep the fail-open behaviour. `EXCLUDED.hits` with the default weight 1 behaves exactly like the old `+1`. |
| 5 | **Single-flight** | Released in `finally`, which covers throws, timeouts and aborts: after an abort, `guardComplete` makes the engine end quickly. A crash cannot leave a doc busy forever, because the TTL is checked on the next acquire and the 25 h purge removes stale rows. **But the TTL is judged with the acquirer's TTL, not the holder's (R1).** A 409 `busy` also burns buckets (R2). |
| 6 | **Config** | `int()`/`bool()` fall back to the default on empty or NaN. The compose entries are `${VAR:-}` (empty → default). All six vars are in the `web` service and in `.env.example`, and the test locks this. |
| 7 | **Tests** | See above. |
| 8 | **Style** | Comments are in Uzbek. No silent catch: `releaseLease` logs, `acquireLease` and `assertPaidDocument` log and then return 503. No TODOs. |

## Required changes

### R1. The lease staleness check uses the *acquirer's* TTL, so a rewrite can take over a live polish lease. `lib/server/spend.ts:92,166,258`
`acquireLease(key, ttlSec)` deletes the doc's lease if `window_start <= at − ttlSec`, where `ttlSec` belongs to the **incoming** endpoint. Rewrite and polish share the key `inflight:doc:<id>`, but their TTLs are 90 s and 180 s.

A polish runs for up to `POLISH_TIMEOUT_MS` = 120 s, plus the in-flight call and the rebuild; BEA-11 cites polishes of about 100 s. A `rewrite` that arrives 90–180 s after the polish started sees the polish lease as stale, deletes it and acquires its own. Both then run LLM work on the same doc, and one of them 409s at commit after the money is already spent. That is exactly the CONC-11 case this lease exists to stop.

The fix is to store the expiry in the row, so the holder's TTL decides:
```ts
// acquireLease: window_start = qulf TUGASH vaqti (egasining TTL i bilan)
const expires = new Date(at.getTime() + ttlSec * 1000);
await c.query("DELETE FROM rate_limits WHERE bucket = $1 AND window_start <= $2", [key, at]);
const live = await c.query("SELECT 1 FROM rate_limits WHERE bucket = $1 LIMIT 1", [key]);
if (live.rows[0]) return null;
await c.query("INSERT INTO rate_limits (bucket, window_start, hits) VALUES ($1, $2, 1)", [key, expires]);
return expires; // releaseLease shu qiymat bilan o'chiradi
```
(`purgeRateLimits` still removes rows whose `window_start` is more than 25 h ago, so this is safe.)

The simpler alternative is to judge staleness with `Math.max(...Object.values(LEASE_TTL_SEC))`.

Add a test: take a polish lease at `now − 100 s`, then call rewrite and expect 409 `busy`. That needs a `now` seam in `acquireLease`, or an insert of the row by hand.

Also fix the comment at `:88-91`. It says the TTL is larger than the route's `maxDuration`, but self-hosted Next ignores `maxDuration` (CONC-11). Tie the TTL to `POLISH_TIMEOUT_MS` / `REWRITE_TIMEOUT_MS` plus a margin for the rebuild.

### R2. A 409 `busy` still burns the per-doc polish quota and the user's daily and global counts, so BEA-11 is only partly fixed. `lib/server/spend.ts:154-166`
The buckets are hit (`:154-160`) **before** `acquireLease` (`:166`). The case BEA-11 describes is:
1. nginx returns 504 on a polish of about 100 s while the server keeps working.
2. The user retries.
3. The retry gets 409 `busy`, but has already used 1 of the 3 polishes/doc/day, 1 of the 10/day, and 7 global units, with no LLM call.

Take the lease first and consume the buckets inside the `try`:
```ts
const complete = guardComplete(deps.complete ?? completeRole, r.signal);
if (!doc) { await consume(); return run(complete); }
const lease = await acquireLease(key, LEASE_TTL_SEC[endpoint]);
if (!lease) throw new ApiError(BUSY_TEXT, 409, { code: "busy" });
try {
  await consume();   // burst → daily → doc → global (hozirgi tartib)
  return await run(complete);
} finally {
  await releaseLease(key, lease);
}
```
Extend the existing busy subtest so it asserts that the per-doc bucket was **not** incremented by the rejected second call.

## Nits (optional)

- **N1.** Pre-LLM rejections inside the engines still consume buckets after `withFreeLlm` has let the request in. For polish these are 409 `legacy`, 422 `review` and 422 `nothing`. For rewrite they are 422 `essay`, 422 for infographics, and 409 "maqola emas". The UI mostly hides these buttons, so this is acceptable, but it is the remaining part of BEA-11. It could be fixed later with a cheap `precheck` callback before the buckets are hit.
- **N2.** `Retry-After` is set only for 429 (`lib/server/api.ts:182`). The 503 responses (DB, global) carry `retryAfter` only in the body. A one-line change would send the header for 503 too.
- **N3.** `bool("FREE_LLM_DISABLED")` only accepts `1/true/yes`. A typo such as `on` or `enabled` leaves spending **on**. You could log a warning when the value is present but not recognised.
- **N4.** A document paid with `admin_credit` balance or quota counts as "paid". That is fine if it is intended; state it in the `assertPaidDocument` doc comment.
- **N5.** The global cap can be exhausted by signup farming (ABUSE-02): with per-user caps at defaults, about 333 bonus-only accounts spending on outline + udk (60 units/day each) use up 20 000 units, which stops free helpers for everyone. That is the intended trade-off (spend stays bounded), but tell the owner.
- **N6.** No test covers `rateLimit` `weight` > 1 directly (it is covered indirectly by the global subtest), and none covers N concurrent requests at the cap. The UPSERT is atomic, so this is only a lock-in suggestion.
- **N7.** The per-endpoint `FREE_LLM_WEIGHT` is a call-count estimate, not USD. The EXT-02 "USD guard" (`llm_spend` row) is still a second step. Note this as residual work in the package report.
