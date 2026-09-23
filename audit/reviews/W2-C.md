# W2-C review — Payme sandbox, NAT-tolerant limits, upload quota, streamed body cap, template busy

Branch `worktree-agent-a8c4f42335d80f4d8` (`ae0c81e`, `51a28af`, `3b40afe`, `af152cf`). The merge-base with `audit/production-readiness` is `5d09028`. The branch tip is `9c7d682`, so the branch is behind W2-D1. Rebase before merging.

## Verdict: **CHANGES REQUESTED**

The core work is sound. Nothing in it is a security hole that works in prod. Three items still need fixing before merge: two are small, and the third is a UX trap that needs a decision.

Tests: I ran `payme-sandbox`, `ip-limits`, `upload-quota`, `upload-chunked`, `template-busy`, `payments`, `game-routes`, `logo` and `slide-image-edit` through the memory gate against the throwaway DB. Result: **72/72 pass, 0 skipped**. `tsc --noEmit` is clean.

## What I verified (OK)

- **Payme (C11).** `POST` is the only export. The auth check runs before `switch (body.method)`, so every JSON-RPC method uses the same `acceptedPaymeKeys` list. `PAYME_SANDBOX` defaults to `false` (`bool(..., false)`, from the W2 foundation), and compose passes it through. With sandbox off, the test key gets `-32504`, and the test covers this.
- **OTP brute force.** OTP is disabled in prod: `devLoginEnabled` false → 503. Even when enabled, the limits hold. Each code is 5 digits and dies after 5 attempts (`FOR UPDATE`, atomic). Verify is capped at 10 per identifier per 10 min, and requests at 3 per identifier per 10 min, both through atomic `rateLimit`. Guesses per identifier are bounded no matter how IPs rotate. Rotating identifiers hits the 30-failures-per-IP bucket, with the 300-per-IP ceiling behind it.
- **`sx_lt` cookie.** It is attacker-controlled. If it is dropped or rotated, the 300-per-5-min IP ceiling is the only guard. That is acceptable: a ticket grants nothing by itself, since login happens only through the bot-delivered single-use link.
- **`enter` token.** It is single-use regardless of limits: `SELECT … FOR UPDATE WHERE consumed_at IS NULL` followed by `UPDATE consumed_at` in one transaction. Tokens are unguessable, so the failure bucket is just flood hygiene.
- **Telegram per-account bucket.** It is applied only after the HMAC check. Bad signatures are counted per IP.
- **Game submit.** The per-game-per-IP limit is 120/min with a 600/min IP ceiling. Rotating tokens only reaches the ceiling.
- **Advisory lock.** It uses the two-int4 key space `(hashtext('upload-quota'), hashtext(userId))`. Postgres keeps this separate from single-bigint keys: the migration lock `727000001` and slide-commit's `hashtext(id)`. The only other two-key user is `spend.ts` with `hashtext('free-llm-lease')` = −195556391, against `hashtext('upload-quota')` = 383384489. No collision. A `hashtext(userId)` collision between two users would only serialize their uploads.
- **Quota coverage.** Every byte-storing path goes through the quota: `putLogo`, `uploadPhoto`/`putPhoto`, `putTemplate`, `putSource`, and `putGenerationUpload`, which is used by slide-image and resume-photo. `/api/extract` does not persist anything. Worker `putAssetBytes`/`putAssets` stores only paid output. Only `deps.put` test seams skip the pre-check, and the route always passes `{}`.
- **Quota counting.** Only live rows are counted, so purged or deleted rows free quota. A dedupe re-upload is excluded from both the count and the byte total, so there is no double count. The pre-check (`assertUploadQuota`) runs before the parse and rasterize for templates and before `count` for sources.
- **Ownership before bytes (BEA-03).** The ownership `SELECT` runs inside the quota transaction, before the `INSERT`. Routes validate the UUID first, so there is no 22P02 → 500.
- **Streamed cap (SECB-05).** `readUploadForm` checks `Content-Length` first, then counts streamed chunks and cancels the reader at `maxBytes`. Memory is bounded by the cap plus one chunk. Multipart is re-parsed from the buffered body with the original content-type. Chunked tests cover logo, photo, slide-image and resume-photo.

## Required changes

1. **`paymentsConfigured()` still uses the old semantics.** `lib/server/env.ts:275` returns `payme: merchantId && (key || testKey)`. In prod with only `PAYME_TEST_KEY` set and sandbox off, the UI and `/api/payments/orders` still offer Payme. Every webhook then gets AUTH, so every checkout fails at Payme. Change it to `Boolean(env.payme.merchantId && acceptedPaymeKeys(env.payme).length)`. Health reads the same function. Add a one-line test.

2. **The template busy refund is unbounded.** This DoS-amplifies the shared soffice gate. `handleTemplateUpload` refunds every `SofficeBusyError`, and that includes waiters that time out after 20 s. When the gate's active slots are full (2 per process), one free account can keep 5 of the 20 waiter slots (`MAX_WAITERS`) occupied indefinitely: wait 20 s → 503 → refund → retry. Four accounts fill the queue, so PDF downloads for everyone get 503. Each attempt also costs a 20 MB body read, a quota query and a `parseInWorker` run. Before this change, the same account got 5 attempts per 10 min. Fix: bound the refunds, for example refund only while `rateLimit('template:busy:'+userId, 10, 600)` is ok. Optionally, fail fast by checking `sofficeGate().stats()` before the parse.

3. **The 413 escape hatch doesn't exist, and the message is wrong.** The quota message says «foydalanilmagan fayllar 90 kundan keyin o'zi tozalanadi» ("unused files are cleaned up automatically after 90 days"). None of this is true today:
   - `purgeUnusedUploads` is not wired.
   - Logos have **no delete endpoint**, so a user at 20 logos is stuck.
   - Generation images (`perGeneration` 60) are never deleted until the whole document is. A replaced slide image or re-cropped resume photo stays as a row forever. A resume re-crop costs 2 rows, so a resume allows only 30 re-crops for its lifetime.

   Fix: make the message kind-specific and truthful. For `generation`, either GC this generation's post-finish uploaded assets that `doc_json`/`doc_prev` no longer reference (inside the same quota transaction), or have the owner explicitly accept a hard lifetime cap. For logos, wire the purge (see below) or add a delete.

## Optional / nits

- **Failure-only buckets are not atomic.** In `peekRate` the check and the increment are separate steps, so N parallel failures all peek below the cap. For OTP spray that means up to the 300-per-IP ceiling instead of 30. It only matters when dev-login is on, and per-identifier/per-code limits still hold. A cheap strict fix: increment first, then `refundRate` on success (`refundRate` already exists).
- **Resume photo writes are split.** `uploadResumePhoto` stores the crop and the original in **two** quota transactions. If the second gets a 413, an orphan crop has already been written and counted. Use one `withUploadQuota` for both, as `uploadPhoto` already does.
- **Lazily written assets count against the quota.** `thumb.ts` writes `THUMB_ASSET_ID` after finish, so thumbnails count against `perGeneration` and the 200 MB total, invisibly (≈ tens of KB × every document viewed). Exclude `THUMB_ASSET_ID` in `USAGE_SQL`.
- **In-flight generations are counted.** `COALESCE(g.finished_at, g.created_at)` counts all worker assets of a running job against the user's total until it finishes. This is transient; `AND g.finished_at IS NOT NULL` would avoid it.
- **Sandbox in prod goes unflagged.** Add a `runtimeWarnings()` entry when `PAYME_SANDBOX=true` and `NODE_ENV=production`.
- **Bucket rows from random tokens.** `o:submit:${token}:${ip}` buckets are created for random format-valid tokens before the 404. That means one `rate_limits` row per attempt, bounded by 600/min/IP. Fine if `rate_limits` housekeeping runs.

## Purges — safe to wire?

- **`purgeSourceCache(60)`: SAFE to wire now.** The SQL is correct: batched `DELETE … WHERE key IN (SELECT … LIMIT 5000)` with a 20-batch cap. The cache TTL is 30 days, so rows older than 60 days are never read.
- **`purgeUnusedUploads(90)`: safe to wire after one small fix.** The reference checks are right:
  - The keys match the code. The worker reads `values_json.logoAssetId` and `values_json.templateAssetId`, and edit re-render reads `doc_json.customTemplate.assetId` via `getTemplate`.
  - `meta.ts` lower-cases the ids, and `asset_id` is lower-hex.
  - The user's author profile does not store `logoAssetId`. `users` has only position and organization.
  - `form_drafts` never hold these ids (`DRAFT_SKIP` in SlideComposer), so the draft clause is harmless but dead.
  - A document removed by retention unreferences its assets, which is the intended behaviour.

  **Fix before wiring:** `putLogo` uses `ON CONFLICT DO NOTHING`, and `putTemplate`'s `DO UPDATE` does not touch `created_at`. Re-uploading an old, unused logo therefore returns a row still dated from the first upload. If the daily purge runs between that upload and «Yaratish» (Create), the logo is deleted and the deck silently renders without it. Set `created_at = now()` on conflict in both. Also note for the owner: a template uploaded but never used disappears from the «O'z shablonim» (My templates) gallery after 90 days. That is a product decision to confirm. The DELETEs are unbatched, which is fine at current table sizes.

---

## Re-review (after `f474cad` merge, `7a2094c`, `9b048c3`, `46934d6`)

### Verdict: **APPROVE**

The branch now contains `audit/production-readiness` (merge `f474cad`), so the rebase note is resolved.

Tests: re-ran the suites through `heavy2.sh`, with `DATABASE_URL` pointing at the throwaway DB. Files: `payme-sandbox`, `ip-limits`, `upload-quota`, `upload-chunked`, `template-busy`, `payments`, `game-routes`, `logo`, `slide-image-edit` and `worker-housekeeping`. Result: **77/77 pass, 0 skipped**. `tsc --noEmit` is clean.

### R1 — Payme configured check: fixed
- `acceptedPaymeKeys` moved to its own pure file, `lib/server/payme-keys.ts`, which `env.ts` can import without a circular import. `payments.ts` re-exports it.
- `paymentsConfigured().payme` now requires `merchantId && acceptedPaymeKeys(env.payme).length`. This is the same rule the webhook uses, so a test key alone with sandbox off no longer offers Payme at checkout. A test covers it.
- `purgeSourceCache(60)` is wired as its own `step("source-cache")` in `housekeeping()`. If it fails, the other housekeeping steps still run. `worker-housekeeping.test` covers it.

### R2 — busy refund cap: fixed
- A busy (503) response now refunds only while `rateLimit('template:busy:'+userId, 3, 600, { failClosed: true })` is under its limit. That allows at most 3 refunds per user per 10 min. After that, a busy attempt uses up a rate slot like any other attempt.
- If the database errors, there is no refund.
- The retry loop that could keep the soffice queue occupied is gone: each account gets at most 8 attempts per 10 min, down from unlimited.

### R3 — quota messages: fixed
`quotaMessage(kind, reason)` now gives each kind its own message. Every remedy it names exists:
- **Logo:** says there is no delete and suggests re-selecting a file already uploaded. That works: identical bytes give the same `asset_id`, which the quota check excludes.
- **Photo:** re-select, plus deletion after 90 days, which matches `step("photos", purgeOldPhotos(90))`.
- **Template:** delete from the list. `DELETE /api/uploads/template/[assetId]` exists.
- **Source:** delete, plus deletion after 30 days. `DELETE /api/uploads/source/[assetId]` and `purgeOldSources(30)` both exist.
- **Generation:** states that the limit lasts the document's whole life and that replaced images count.
- **Total bytes:** points to deleting templates or sources, both of which can be deleted.

The unwired 90-day promise is gone.

### Still open (non-blocking, from the first review)
- `purgeUnusedUploads` is not wired, by owner decision. If it is wired later, the `created_at`-on-conflict touch from the first review is still needed first.
- These optional nits stand as before:
  - `peekRate` check and increment are not atomic.
  - Resume crop and original are written in two separate transactions.
  - Thumbnails count against the quota.
  - In-flight generations count toward the total.
  - No warning when `PAYME_SANDBOX` is on in production.
- The source message says «Tarjima manbalari» (translation sources). That is accurate today: the translator form is the only user of `uploadSource`.
