# Design — file retention (C23)

**Owner decision (2026-09-23):** files of generations made with only the signup bonus (paid entirely with `points`) are deleted after **180 days**. Files paid with real money, meaning `balance` or Pro `quota`, are kept forever.

## Background
- Commit `112c9a3` (2026-09-07) made every file permanent at the owner's request, and README documents this ("muddatsiz").
- Files live in Postgres `bytea`, and slide images are stored twice: inside the PPTX and again as assets.
- A slide-heavy mix is about 3–10 MB per generation, so a shared 100 GB disk fills within weeks at full capacity (`verify-scale.md` FILE-01).

## Design
1. **Which generations are bonus-only:** there is a `charge` transaction for the generation id (net of refunds), the balance and quota deltas are 0, and the points delta is < 0. This is the same rule as W1-E `spend.ts` "paid" (reuse it).
2. **Purge**, in worker `housekeeping()` as a new `purgeBonusFiles()` in `lib/server/retention.ts`:
   - It targets COMPLETED, bonus-only generations with `finished_at < now() - RETENTION_BONUS_DAYS` (default 180).
   - It deletes the `generation_files` row and the assets, sets `doc_json`/`html` to NULL, and records `files_purged_at = now()`.
   - It runs in batches of 200 (`LIMIT`), is idempotent, and each batch is its own transaction.
   - The `generations` row survives, so the history list and the ledger stay intact.
3. **Migration `022_retention.sql`:**
   - `ALTER TABLE generations ADD COLUMN IF NOT EXISTS files_purged_at timestamptz;`
   - A partial index on `(finished_at) WHERE status='COMPLETED' AND files_purged_at IS NULL`, built with `CREATE INDEX IF NOT EXISTS` on a small table (the build takes seconds).
   - It is backward compatible, so the old code ignores the column. Rollback: `DROP INDEX`, then `DROP COLUMN`.
4. **UI:** a purged generation shows the existing "file gone" state (`ResultView` expired branch) with the text "Bonus bilan yaratilgan hujjatlar 180 kun saqlanadi". A line on the form or price hint tells users this before they generate (frontend package, Wave 3).
5. **README:** the "muddatsiz" sentence becomes "real to'lov bilan — muddatsiz; faqat bonus bilan — 180 kun".
6. **Dead config:** `FILE_TTL_HOURS` is removed from compose, along with the unused `STORAGE_DIR`, because they mislead.
7. **Duplicate slide images** (inside the PPTX and as assets): left as is. Removing them would require re-rendering from assets, which is a larger change noted in REPORT's optimisation section.

## Tests
- `tests/retention.test.mts` (Postgres) covers five cases:
  - A bonus-only generation older than 180 days is purged, and its row survives.
  - A generation paid with balance is never purged.
  - A bonus-only generation younger than 180 days is kept.
  - A partially refunded generation is judged correctly.
  - Batching respects `LIMIT`.
- Mutation checks: the "paid" condition and the day threshold.
