# W4-E review: essay price from engine volume, SECB-03, C41, SCALE-12 (rest), BEA-13, BEA-14, ABUSE-07

Reviewer: independent, read-only. Branch `worktree-agent-adfff6cb8ec046f05` (`1c4213f..246f46e`, merge-base `b4a9ff1`) vs `audit/production-readiness` (`05b5baf`). `git merge-tree` against the current base head is clean. `lib/tools.ts` and `lib/generation/essay/**` are unchanged on base since the merge-base.

## Verdict: **CHANGES REQUESTED** (2 required changes, both small)

The money part is correct: canonical essay prices are unchanged. The transaction and lean-response work is sound. There are two problems:
- BEA-13 is only partly fixed. Its own reproduction `?since=3000000000` still returns 500.
- The new photo purge pins photos referenced by COMPLETED resumes forever, even though nothing reads them. There is no photo delete API, so a user can be locked out of the photo quota for good.

## Tests

- The requested suite ran under `heavy2.sh -m 3G -t 900`: essay-price-words, viewer-upload-commit, upload-retention, edit-response-lean, malformed-input, results-csv-tashkent, delete-completed-no-refund, essay-params, payments-orders. Result: **46/46 pass**, exit 0.
- The neighbouring regression set also ran, with `--test-concurrency=1`: pricing, price-normalisation, essay-wiring, resume-commit, slide-image-edit, slide-doc-route, upload-quota, doc-polish-route, game-routes, game-results-lifecycle, article-commit, jobs-live-edit, logo, upload-chunked, teacher-commit, work-commit. Result: **246/246 pass**.

## 1. Essay prices (MONEY)

I wrote my own differential script (`scratchpad/w4e/essay-diff.mts`). It imports `priceFor` from the base tree (main worktree, `05b5baf`) and from the branch tree side by side. It covers:
- The exact output of `EssayComposer.toValues`, replicated with the real `encodeEssayValues`. It runs over every context × every kind of that context × language {uz, ru, en} × person {first, third} × `pages` 1–5 × `wordTarget` {500, 700 (default aim), 750, 1000}.
- The price-label calls the form makes: `{pages: "n"}` for n = 1–5, `{pages: n}` (numeric), and `{pages: pagesForWords(w)}` for w ∈ `WORD_OPTIONS`.
- `{}`, and legacy `{pages, wordTarget: ""}` with no context.

`WORD_OPTIONS` has never changed in git history (`[500, 750, 1000]`). No other producer of `essayContext`/`wordTarget` values exists outside the form (grep of `lib`, `app`, `components`, `scripts`).

| Canonical input (distinct price keys) | base | branch |
|---|---|---|
| school_dtm, pages 1 / 2 / 3 / 4 / 5 | 2000 / 2500 / 3000 / 3500 / 4000 | same |
| academic, 500 words (pages 2) | 2500 | 2500 |
| academic, 700 words, the default (pages 3) | 3000 | 3000 |
| academic, 750 words (pages 3) | 3000 | 3000 |
| academic, 1000 words (pages 4) | 3500 | 3500 |
| ielts_task2 (form sends pages 1) | 2000 | 2000 |
| label calls `{pages}` 1–5 (string and number), `{}`, legacy | unchanged | unchanged |
| **Total compared: 1 819 value sets (26 distinct price keys)** | | **changed: 0** |

- **IELTS = 1 page:** today's canonical IELTS price is 2000, because the form hard-codes `pages = ESSAY_LIMITS.pagesMin` = 1. The new rule returns `ESSAY_LIMITS.pagesMin`, which gives the same 2000. They are identical.
- **Non-canonical inputs** (672 malformed combinations): 60 go up and 205 go down. Every increase is `academic` with a `wordTarget` but a missing, empty or contradictory `pages`. The engine really writes that longer essay, so this is the intended C12-class fix, not a canonical change.
- Weakness (not blocking): the 1 280-case "sweep vs the engine" in `essay-price-words.test.mts` compares `priceFor` with `enginePages()`, which is a line-by-line copy of `essayPricePages`. That is tautological. Only the hand-written cases and the canonical table actually pin behaviour.

## 2. Purge safety (C41)

**Can a referenced photo still be deleted? No, for every path that reads `photo_uploads`.**
- **Worker:** reads `photo_uploads` via `photoDataUrl(values.photoAssetId)` at run time, and the original is pinned through the kept crop. QUEUED and IN_PROGRESS rows are covered, including a requeued job.
- **Form «Markazlash»:** reads `photo_uploads` via `photoUrl(original || asset)`. The draft is covered: `form_drafts.data.photoAssetId` / `photoOriginalAssetId`. The draft is flat and only cleared on explicit «Tozalash», not on submit.
- **FAILED retry:** there is no server-side "retry with same values" feature. A user retries from the draft, which is still present and pinned. Profiles (015) hold no photo, and the legacy `resume_drafts` table is no longer read.
- **Multiple photo fields:** `ResumeModel` has a single `photo`. The `lower()` match handles case.

**Over-retention (required change 2).** COMPLETED resumes do not need `photo_uploads`:
- `extractAssets` → `swapPhoto` copies the crop into `generation_assets` and rewrites the URL.
- The viewer's photo button only uploads a new photo through `/api/generations/{id}/photo`. Nothing in `components/viewers/**` reads `/api/uploads/photo` or `originalAssetId`.
- So pinning on `status = 'COMPLETED'` / `doc_json` adds no safety, and has two effects:
  - **Lockout:** `retention.ts` never purges paid COMPLETED jobs, so those rows stay forever. Each distinct resume photo is 2 rows (crop + original), the photo quota is 50, and there is no photo delete route. About 25 completed resumes with distinct photos (an HR or agency user) locks the user out of new photos permanently. Before this change the quota healed itself after 90 days.
  - **Cost:** it makes the purge heavier; see the estimate below.

**Scan cost estimate.**
- Pinned rows never leave, so `stale` (users with any photo older than 90 days) grows monotonically.
- Each daily run walks `generations_user_idx` for every such user: one heap fetch per generation of any tool. It then detoasts `values_json` and `doc_json` of their resume rows.
- Example: 20k such users × 40 generations = 800k heap fetches. Plus about 40k resume `doc_json` detoasts (tens of KB each, ≈1 GB read). That is one statement per day and growing.
- Dropping COMPLETED removes the `doc_json` detoast, and the generation side becomes tiny (only live jobs).
- If you want an index: `CREATE INDEX … ON generations (user_id) WHERE tool_id = 'resume' AND status IN ('QUEUED','IN_PROGRESS')`. Optionally batch the DELETE with `LIMIT`, like `purgeBatch`.

**Also checked and OK:**
- `created_at = now()` on conflict for photo, logo, template and source.
- Draft references match across any `tool_id`, which is harmless.
- The purge vs concurrent re-upload race is safe: under READ COMMITTED the DELETE re-checks `created_at` on the updated row.
- Thumbnail quota exclusion (`asset_id <> THUMB_ASSET_ID`): the id is a fixed 24-hex constant, and user ids are sha256-derived, so a collision is negligible.

## 3. Transactions (SECB-03)

- **No heavy work inside the transaction.** `commitDocOps` does all of this before `transaction()`: load, version check, `adapter.apply`, `renderHtml`, `buildPreview`. There is no sharp or resize on these paths. Uploads are raw bytes that were sniffed only.
- **Order inside the transaction:** `updateGenerationDoc`, then (only if a row was updated) `storeGenerationUploads`. That function takes the same `pg_advisory_xact_lock(hashtext('upload-quota'), hashtext(userId))` as `withUploadQuota`, then runs `check()` (ownership + quota), then the INSERTs. The quota check and the insert share the transaction and the lock.
  - A 409 writes no asset.
  - A 413 rolls back the doc.
  - A 404 or 422 is thrown before the transaction.
- **Deadlocks:**
  - `updateGenerationDoc` takes FOR NO KEY UPDATE on the generations row, which does not conflict with the FK KEY SHARE taken by `generation_assets` inserts.
  - No path takes the advisory lock first and then updates `generations`, so there is no lock-order cycle.
- **The file rebuild does not break.** `rebuildFile` is a separate, later request, so the image is committed before any DOCX/PPTX render resolves it.
- **Resume pair:** crop + original are counted together, de-duplicated by id, in one `check()`.

## 4. Lean responses (SCALE-12 rest)

- `detail()` in `slide-commit.ts` (edit, photo, image, restore) and in `doc-polish.ts` now uses `getGeneration(…, {lean: true})`. That is `CASE WHEN doc_json IS NULL THEN html END`, the same shape the poll endpoint already returns.
- The only client reads of `html` are:
  - `components/viewers/ArtifactViewer.tsx:36`: `gen.doc ?? academicDocFromHtml(gen.html, gen)`, a fallback only.
  - `components/files/ResultView.tsx:745`: `html: g.html ?? ""`, a legacy shape. No viewer reads `.html` when `doc` exists.
- `lib/api-edit.ts` never touches `html`.
- The polish internal fallback (`doc-polish.ts:458`) still uses the non-lean read for the DB write, which is correct.

## 5. readJson strictness (BEA-13, partial)

- **All 15 `readJson` callers** (generations, outline, users/me, payments/orders, auth/telegram, auth/otp, o/[token]/submit, admin/users, drafts ×2, polish, rewrite, udk, slide-commit PATCH) expect an object. No legitimate client sends an array or null.
- **Payme** uses its own `readRpc`, which already rejects non-objects with a JSON-RPC error. **Click** uses form data. Neither goes through `readJson`, so the payment webhooks are unaffected.
- **The rest of BEA-13 is not fixed (required change 1):**
  - `parseSince` in `app/api/generations/[id]/route.ts` still uses `Number.parseInt` with no upper bound. I confirmed that `SELECT $1::int` with 3000000000 gives pg `22003`, so `GET /api/generations/<id>?since=3000000000` still returns 500. `parseIntParam` was added for exactly this, but it is never called.
  - `safeEqual(expected, hash)` with a numeric `widget.hash` still hits `Buffer.from(1)` → TypeError → 500. This is the finding's third reproduction.
  - The admin `[id]` is not validated.
- `parseIsoInstant` is correctly wired into the results cursor. It rejects 2026-02-30, keeps microseconds, and caps the fraction at 6 digits.

## 6. BEA-14 / ABUSE-07

- The CSV «Sana» is written as `YYYY-MM-DD HH:mm` at a fixed +5 h. Tashkent has no DST, so this is correct. An invalid value passes through unchanged. The formula-escape prefix is unaffected because the value starts with a digit.
- The ABUSE-07 lock test covers the refund behaviour on both sides: COMPLETED delete gives no refund, QUEUED cancel refunds exactly once.

## Required changes

1. **Finish BEA-13's reproductions, or record the rest as deferred.**
   - Make `parseSince` use `parseIntParam(raw)` so it stays within int4. Out of range should give `undefined` (the current "ignore" contract) or 400.
   - Add a route-level test for `?since=3000000000`.
   - Make `safeEqual` return `false` for non-string arguments, with a test for `{"widget":{"hash":1}}` → 401.
   - Validate the admin `[id]` (for example `/^\d{1,18}$/` → 404).
   - If any of these is owned by another package, say so in `03-progress.md`. BEA-13 must not be marked closed while its own reproductions still return 500.
2. **Don't pin photos for COMPLETED resumes in `purgeOldPhotos`.**
   - Keep only drafts plus QUEUED/IN_PROGRESS `values_json.photoAssetId`, and their originals. Drop the `COMPLETED` status and the `doc_json` references, because the finished document already holds its own copy in `generation_assets`.
   - Update `upload-retention.test.mts` to match: a photo referenced only by a COMPLETED resume is purged after 90 days, and the finished document's `/api/generations/{id}/assets/{aid}` still serves it.
   - This removes the permanent quota lockout and the unbounded `doc_json` scan.
   - If the owner prefers to keep COMPLETED pinning, it needs a bound (for example only while `finished_at` is within 90 days) and a photo delete path. Adding the partial index above is optional either way.

## Non-blocking notes

- The `essay-params.ts` registry (owned by W4-A) should add `"price"` to `wordTarget.impacts`. After that, the `PRICED_BY_ENGINE_VOLUME` special case in `essay-params.test.mts` can go (the "every param must work" rule).
- Some doc comments are now stale:
  - `components/forms/EssayComposer.tsx` header and `toValues`: «narx baribir `pages` chipidan».
  - `lib/generation/essay/input.ts` header.
  - `ESSAY_LIMITS.pagesMin` comment.
  - The price for word-sized contexts now comes from the engine volume.
- Replace the tautological `enginePages()` sweep with an independent oracle, for example a literal table of (`wordTarget` → price) at the boundaries 500/501/750/751/1000.
