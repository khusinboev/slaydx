# Review W1-C: C03 lone surrogate / NUL causes JSONB failure, leading to a free document plus a refund

- Branch: `worktree-agent-a63f661c6fe868522` @ `1e3e864`
- Reviewer: independent read-only review, 2026-09-23
- Scope: `lib/server/{jsonb,jobs,storage,worker,form-draft,game-sessions}.ts`, `lib/generation/safe-text.ts` and 11 clip call sites, `tests/{jsonb-writes,safe-text}.test.mts`

## Verdict: **APPROVE** (no blocking changes; recommendations below)

The P0 chain is closed at three independent layers:

1. **Root cause.** Every JSONB write on the job and request path now goes through `toJsonb`: `values_json`, `doc_json`, `preview`, `delivered_json`, `live_json`, `cost_json`, `form_drafts.data`, `game_sessions.settings_json` and `game_results.answers_json`. Every user or LLM TEXT sink on those paths goes through `cleanText`: `topic`, the charge `note`, `step`, `error`, `html`, `file_name`, `player_name` and the refund note. Because of this, `completeJob` can no longer be made to throw by input content.
2. **Download gate.** `getGenerationFile` requires `g.status = 'COMPLETED'`.
3. **Cleanup.** `failAndCleanup` deletes the file and assets after a successful `failJob`.

## Adversarial checks

**1. Completeness.** I grepped `INSERT|UPDATE|::jsonb|JSON.stringify` across `lib/server`, `app/api` and `research/cache.ts`. Four `JSON.stringify` calls into jsonb remain:
- `research/cache.ts:80` has its errors caught (`cache.ts:112-116`), so the worst case is a cache miss.
- `photo.ts:72` crop contains only numbers.
- `template-upload.ts:139` (profile/previews from a user PPTX) is not on the money path. The worst case is a 500 on template upload. Owned by W1-D, see R4.
- `live.ts:29` only measures size.

Writes to `users` in `users/me` are TEXT with NUL already stripped. For TEXT, node-pg's UTF-8 encoding turns a lone surrogate into U+FFFD, so TEXT columns only need NUL handling, which the fix does. `generations` has only one INSERT, in `jobs.ts`.

Other ways to get a file from a FAILED job:
- `/assets/[assetId]`: `getAsset` has no status gate, but `failAndCleanup` deletes the assets. Before failure, the same images were already visible live through `live_json` while the job was IN_PROGRESS. Gating to COMPLETED would break the live deck. **Not a real leak.**
- `thumb.ts:108-111` reads `generation_files` without a status gate. This matters only if an orphan file survives, which needs both a failed cleanup and a failed completion (see R1/R2). The exposure is a page-1 JPEG, not the document. Low.
- `ensureFreshFile` and `rebuildFile` bail unless the job is COMPLETED (`slide-commit.ts:84,286`). `GET /[id]` computes `hasFile` only for COMPLETED jobs. Game sessions require COMPLETED.

**2. `failAndCleanup`.**
- The refund happens only if `failJob` won (`locked_by = us AND IN_PROGRESS`), so it runs exactly once, and cleanup happens only on a win.
- A newer run's COMPLETED file cannot be deleted. After our `failJob` wins, the status is FAILED, so no run can reach COMPLETED.
- A lost lease makes `failJob` return false, so nothing is touched. Test (c2) proves this.
- Delete failures are logged with the job id.
- One gap: if `refund` throws, cleanup is skipped. See R2.

**3. `toJsonb`.** The replacer returns `v` untouched for clean input, so the output is byte-identical; a test covers this, including `Date#toJSON`. Keys are cleaned, and objects are rebuilt only when a key is dirty. No hash, signature or text-equality CAS is computed over doc JSON; CAS is the integer `doc_version`. The cost is one extra `isWellFormed` + `includes` pass per string and key, which is fine. Two harmless edge cases: two keys that collide after cleaning (last one wins), and a rebuilt object losing its prototype, which JSON ignores anyway.

**4. `safeSlice`.**
- A high surrogate at `n-1` is dropped only when the string continues past the cut. `n=0` gives `""`. A negative `n` keeps the old `slice(0,-k)` semantics. Splitting before a combining mark is valid Unicode, so that is acceptable.
- All 11 call sites keep the same limits and types, and output length is still ≤ the limit (at most 1 unit shorter).
- ASCII behaviour is unchanged: the existing `slide-limits`, `slide-params` and `game-sessions` suites pass 41/41.
- `cleanText` (`isWellFormed`/`toWellFormed`) is used only server-side on Node 22. The shared client code imports only `safeSlice`, so older browsers are unaffected. TypeScript 5.9 with lib `esnext` has the typings.

**5. Status gate.** Partial deliveries end COMPLETED (`completeJob`, then `refundPartial`). Re-renders only run on COMPLETED jobs. Neither the admin panel nor the bot reads `generation_files`. A REVOKED job has a leftover file only after a requeue plus a cancel, and it is now correctly blocked. Nothing legitimate breaks.

**6. Tests (through the heavy2 gate against the throwaway DB).**
- `jsonb-writes` + `safe-text`: 15/15 pass, 0 skipped. The DB-backed suite really ran.
- `slide-limits` + `slide-params` + `game-sessions`: 41/41 pass.
- The DB tests exercise real Postgres rejection paths: `completeJob`, `setLive`, `setCost`, `failJob`, `updateGenerationDoc`, `enqueueGeneration`, `putDraft`, `addResult`, FAILED vs COMPLETED `getGenerationFile`, `failAndCleanup` won and lost, and a single refund row. The mutation notes are credible. Test (b2) fails outright without the gate.

## Recommendations (non-blocking, can go to a follow-up)

- **R1. The dead-job path leaves stored bytes behind.** In `lib/server/worker.ts:357-364`, `housekeeping`'s loop over `reclaimStaleJobs()` sets FAILED and refunds, but never deletes the file or assets. This is the same class of bug as BEB-01, reached through a worker crash or hang between `putGenerationFile` and `completeJob`. The file is gated, but assets and the thumb are not. Suggested fix:
  ```ts
  if (owner) {
    await refund(String(owner.user_id), id, "Ish vaqti tugadi");
    await Promise.all([
      deleteGenerationFile(id, String(owner.user_id)).catch((e) => console.warn(`[worker] dead ${id}: fayl o'chirilmadi:`, e)),
      deleteAssets(id).catch((e) => console.warn(`[worker] dead ${id}: aktivlar o'chirilmadi:`, e)),
    ]);
  }
  ```
- **R2. A refund error skips cleanup.** At `lib/server/worker.ts:329`, if `refund` throws, the deletes never run. Put the deletes in `try { await refund(...) } finally { await Promise.all([...deletes]) }` so a DB error during refund does not leave bytes behind. The retry and outbox side of refunds is BEA-04 and is out of scope here.
- **R3. Add a status gate to the thumb query.** At `lib/server/thumb.ts:108-111`, add `AND g.status = 'COMPLETED'`, mirroring `getGenerationFile`, as a second barrier. This file is owned by W2-A, so it could go there.
- **R4. BEA-02 items outside W1-C file ownership.** NUL in `source_uploads.text`/`name` (`lib/server/source-upload.ts:175-181`, TEXT 22021 → 500 on upload) and `template-upload.ts:139` should use `cleanText`/`toJsonb`. Hand these to W1-D, which owns both files, and track them so BEA-02 is not marked fully closed.

## Nits

- **N1. Remaining `.slice` calls produce U+FFFD instead of failing.** These are only cosmetic now that `toJsonb` and `cleanText` catch the result. Switching them to `safeSlice` would avoid a visible "�" in titles and preview cards:
  - `lib/server/validate.ts:87` (`sanitizeValues`)
  - `lib/server/preview.ts:57,88,109,116,132` (160-unit preview lines)
  - `app/api/extract/route.ts:50`
  - client slices in `TranslationForm.tsx:93`, `ImageStudio.tsx:72`, `ResumeComposer.tsx:572`
- **N2. Import placement.** `lib/generation/slide-limits.ts:1` puts the import above the file's header doc comment. Move it below the comment for consistency.
- **N3. Pre-existing and out of scope.**
  - The `!won` branch (`worker.ts:270-273`) can delete a file that a newer run already COMPLETED after a lost lease, leaving a COMPLETED job with no file.
  - `WORKER_ID` is per process, so a job re-claimed by the same process shares the lease id with the stale run.

  Both belong with the lease-token work (C16/C19), not here.
