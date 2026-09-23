# Review W2-B — C08 byte caching, C09 lean reads + cursor, C16 fair claim, C22 admission

Branch `worktree-agent-a12672e091a58c87b` (`a285127`, `2ff2a9a`, `e1b7c6e`) vs `audit/production-readiness`.
Reviewer: independent, read-only. Date: 2026-09-23.

## Verdict: **CHANGES REQUESTED** (2 small required changes, plus 2 merge gates; the design is sound)

Tests run from the worktree through the memory gate with the throwaway DB (`:55439`):
`cache-headers, generations-reads, admission, queue, jobs-live-edit` → **64 pass, 0 fail, 0 skip** (the DB tests ran, with isolated DBs).

I also ran EXPLAIN ANALYZE inside a transaction that was rolled back, on synthetic data: 200 000 COMPLETED rows, 40 QUEUED, 8 IN_PROGRESS, 2 000 users.

## What checks out

- **Caching privacy (C08).** Each byte route sets `private` on success, except the public audio route (see nit N2). Errors from the asset, photo and audio routes get `private, no-store` from `noStoreOnError`, since `handler`'s `ApiError`/500 JSON has no `Cache-Control`. The `/api` no-store rule now excludes an exact, `$`-anchored list of byte paths. `cache-headers.test` checks this with Next's own matcher, including that neighbouring and longer paths (`/thumbnail`, `/assets/x/y`) still get no-store. All JSON routes, including the new 429, keep `private, no-store`. `immutable` is used only on content-addressed ids: `assetIdFor` is sha256/24 and the photo id is sha256. The one exception is N3. A thumb with no `?v=` still gets no-store from config. The client does not send `v` yet, so there is no staleness today.
- **Zero-copy.** `bytesBody` keeps the `byteOffset`/`byteLength` of the pooled `Buffer`. The `storage.ts` view is correct for both the Buffer and plain `Uint8Array` inputs.
- **Admission race (C22).** `admitInTx` locks the user row before it counts. Under READ COMMITTED, a second POST blocks, and after the first commits its count statement takes a new snapshot and sees the new row. The parallel-3 test confirms this. **No deadlock:** `chargeInTx` locks only that same users row (its idempotency read of `transactions` takes no lock), admission locks no `generations` rows, and the new row is a fresh uuid. **No charge on 429:** the rejection returns before `chargeInTx`. The transaction commits with nothing written except a released row lock, and there is no `INSERT`. The test asserts that the balance is unchanged and no row was created. Nothing is spent or consumed before `enqueueGeneration`, apart from the `limit()` burst tokens, and that is fine.
- **Fair claim (C16).** The claim plan is an index scan on `generations_queue_idx` with a sort by `created_at`, plus a per-candidate `SubPlan` on `generations_stale_idx` (IN_PROGRESS only). It took 0.12 ms with 40 queued. `FOR UPDATE SKIP LOCKED` still applies only to `q`, because the scalar subquery on `r` is not locked. A capped user keeps their `created_at` priority and is claimed as soon as a running job ends, so there is no starvation. The soft over-cap race between two workers is documented.
- **Cursor (C09).** The key is `(created_at DESC, id DESC)` with a microsecond `to_char` in UTC, round-tripped as `timestamp AT TIME ZONE 'UTC'`. The predicate is correct for ties, and the tests cover equal `created_at` values and an insert between pages. The cursor is base64url JSON checked strictly by regex and passed as a parameter, so there is no injection. Garbage gives `null` → 400, and a cursor copied from another user's list is still filtered by `user_id`. `limit` is clamped to 1..100 with a default of 50. The plan is a bitmap scan on `generations_user_idx` and took 0.26 ms.
- **Removed fields.** `rowToSummary` never emitted `values`, so the response shape is unchanged. Only the SQL stopped reading `values_json`. `html` is null when there is a `doc` only on the lean poll. The only client reader of `gen.html` is `ArtifactViewer.tsx:36` (`gen.doc ?? academicDocFromHtml(gen.html)`), and `ResultView.toLegacyShape` maps a null `html` to `""`. Server callers (`doc-polish`, `slide-commit`, `share`) still get the full `html`. None of `scripts/` or the bot reads the list API. The seed scripts call `enqueueGeneration` without admission, and the typed overloads keep their result narrow.
- **ETA.** `queue_position` is an index scan on `generations_queue_idx` (0.08 ms), and it uses the same formula as admission.

## Required changes

### R1. The admission count sequentially scans all of `generations`, while holding the user-row lock, on every POST
`lib/server/jobs.ts:263-268`. `WHERE status IN ('QUEUED','IN_PROGRESS')` cannot use either partial index. `IN` becomes `= ANY(array)`, which implies neither `status='QUEUED'` nor `status='IN_PROGRESS'` on its own, and Postgres builds BitmapOr paths only from `OR` clauses. The measured plan is a **Parallel Seq Scan on generations**: 3 639 buffers and 14.6 ms at 200k rows. It grows linearly with history, which is kept forever, and it launches parallel workers on every POST while the users row is locked. The comment at `:253-255` says the count uses the partial indexes, which is wrong. Rewrite it so that each count matches exactly one partial predicate. That version measured **0.17 ms**, using index scans on `generations_queue_idx` and `generations_stale_idx` (plus `generations_user_idx`):
```ts
const counts = await client.query<{ user_inflight: string; queued: string }>(
  `SELECT (SELECT count(*) FROM generations WHERE status = 'QUEUED'      AND user_id = $1)
        + (SELECT count(*) FROM generations WHERE status = 'IN_PROGRESS' AND user_id = $1) AS user_inflight,
          (SELECT count(*) FROM generations WHERE status = 'QUEUED') AS queued`,
  [userId],
);
```
Also fix the comment. Optionally add a test that asserts the SQL has no `IN (` (the style of `generations-reads.test`).

### R2. The thumb route is excluded from the no-store rule, but its errors are not wrapped
`app/api/generations/[id]/thumb/route.ts:17`. `BYTE_ROUTES` in `next.config.ts` includes `generations/[^/]+/thumb`, and its own comment says every route in the list **must** be wrapped in `noStoreOnError`, but this route was not changed. With `?v=`, which W2-E will add, a 401, a 400, or a 404 `"Eskiz yo'q"` (a transient LibreOffice failure or a busy gate) goes out with **no `Cache-Control`**, and so does a 500. `cache-headers.test` does not cover the thumb route. Fix:
```ts
import { bytesBody, noStoreOnError } from "@/lib/server/http-bytes";
export const GET = noStoreOnError(handler("generations/thumb", async (req, ctx: Ctx) => {
  …
  return new Response(bytesBody(jpeg), { headers: { … } });
}));
```
Add a DB test: `GET …/thumb?v=1` for a missing or foreign id → 404 with `private, no-store`.

## Merge gates (not code changes, but they must be enforced)

- **G1.** `SUMMARY_COLUMNS` now selects `files_purged_at` (`jobs.ts:95-100`), which only migration **022 (W2-D2)** adds. The tests add the column themselves. If W2-B is deployed without 022, every list and poll query fails with "column does not exist", which takes down the whole app. Merge W2-D2 first, or in the same deploy.
- **G2.** The list default dropped from 100 to 50. Until W2-E's load-more ships, users with 51–100 documents cannot see the older ones. `SearchDialog.tsx:33` also searches only the loaded page. `store.refreshGenerations` replaces the list with page 1 every time, so W2-E must merge pages rather than overwrite them. Ship W2-B together with W2-E.

## Nits (optional)

- **N1.** `jobs.ts:262` uses `FOR UPDATE`, which also blocks the FK `FOR KEY SHARE` taken by the same user's concurrent inserts into child tables (`transactions`, sessions, and so on). `FOR NO KEY UPDATE` still serialises concurrent admissions, because it conflicts with itself and with `chargeInTx`'s `UPDATE`, and it does not block those inserts.
- **N2.** `o/[token]/audio` now really sends `public, max-age=86400, immutable`. Before this change, config overwrote it with no-store. Any shared cache or CDN in front would keep serving the audio for up to 24 h after a share session is revoked or closed. If revocation should take effect immediately, use `public, max-age=3600` (or `private`).
- **N3.** `THUMB_ASSET_ID` (`ab00000000000000000000e1`, `lib/server/thumb.ts:33`) passes the `ASSET_ID` regex. So `…/assets/ab00…e1` serves a *mutable* thumbnail as `immutable` for a day. No client builds that URL, but the assets route could 404 that id or send it no-store.
- **N4.** `Vary: Cookie` is not needed, since every per-user route is `private` and the URLs are resource-scoped. It is acceptable as is.

---

## Re-review — commit `5240fd9` (on top of merge `d5a946c`, which brings in W2-D2's migration 022)

### Verdict: **APPROVE**

Tests run from the worktree through the gate with the throwaway DB:
`cache-headers, generations-reads, admission, queue, jobs-live-edit, thumb` → **70 pass, 0 fail, 0 skip**.

- **R1 fixed.** `ADMISSION_COUNTS_SQL` (`jobs.ts`) is now three scalar subcounts. Each one matches exactly one partial predicate, which is the same shape I measured at 0.17 ms. The new test fills 30k COMPLETED rows, runs ANALYZE, and asserts that the EXPLAIN JSON has no `Seq Scan` and uses both `generations_queue_idx` and `generations_stale_idx`. Putting back the old `IN (…)` query makes it fail. The misleading comment is corrected.
- **R2 fixed.** The thumb route is wrapped in `noStoreOnError`, so 400/401/404/500 and a `busyResponse` without the header all get `private, no-store`. The long cache is used only when `?v=` equals the current `file_version` from `getVersions`, which is scoped by `user_id`. A missing, stale or garbage `v` gets no-store. The tests cover 200 with the current `v`, stale/none/`abc` → no-store, and 404 → no-store.
- **G1 satisfied.** 022 is merged into the base, so `files_purged_at` exists.
- **N1.** Now uses `FOR NO KEY UPDATE`. It still serialises admissions, because it conflicts with itself and with `chargeInTx`'s `UPDATE`, and it no longer blocks FK `KEY SHARE` inserts.
- **N2.** The public audio is now `public, max-age=3600`. It is safe for shared caches. The route reads no cookie, and it serves bytes only for a valid token of a completed session whose `publicGameView` lists that `assetId`. The cache key is a URL that contains the secret token. Audio from private generations is served only by `…/file` (no-store) and `…/assets` (`private`), so it cannot reach a shared cache through this route. After revocation, a cached copy can be served for at most 1 h.
- **N3.** The assets route now sends no-store for `THUMB_ASSET_ID`, and this is tested.
- The file route now uses `bytesBody`, and its headers (`private, no-store`) are unchanged.

### Nits (optional, not blocking)
- **N5.** In the thumb route, the bytes are read before the version (`getOrBuildThumb`, then `getVersions`). If a rebuild commits between the two reads, the old bytes get cached for 1 day under the new `v`. The window is milliseconds and the cache is private. Reading `getVersions` first closes it: new bytes under an old `v` do no harm.
- **Pre-existing, out of scope.** Only `slide-commit.ts:257` deletes `THUMB_ASSET_ID`. DOCX edits and rebuilds (`rebuild`/`fresh-file`) leave the stored thumb stale in the DB whatever the headers say, and `putAssets … DO NOTHING` from an in-flight build can re-insert it after that delete. This is worth a follow-up ticket for W2-E, because once W2-E sends `?v=`, the browser cache will store those stale thumbs.
