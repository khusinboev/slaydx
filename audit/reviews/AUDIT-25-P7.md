# AUDIT-25 P7 review — `plan` survives slide-edit reconstruction

Reviewer: independent (read-only). Commit `c8682e1` on `worktree-agent-af8a7de47015349b5` (base `e89c7c1`).
Contract: `docs/AUDIT-25.md` (slides-3) decision 1 — `SlideModel.plan?: number`, optional, 1-based.

## Verdict: CHANGES (1 required, merge-blocking; 2 optional)

The fix itself is right and complete. One integration defect: the `slide-types.ts` hunk merges **cleanly but
wrongly** with P1 (see C1).

## Verification

### (1) Every DocOp that rebuilds a slide — traced against the full union (`slide-edit.ts:33-59`)

| op | how the slide is produced | `plan` |
|---|---|---|
| `text` | `writeSlideField` → `{...s}` / `without(s,k)` / `refreshAnswerNote({...s})` | kept (spread) |
| `notes` | `{...s, notes}` / `without` | kept |
| `image`, `imageRestore` | `{...s, ...keep, image}` / `without` | kept |
| `list` | `{...s, [field]: items}` | kept |
| `layout` | `convertLayout` → `baseOf` (whitelist) → every branch spreads `...base`; same-layout returns `s`; then `without(c.slide,"image")` | **was dropped → fixed** `slide-edit.ts:560` |
| `add` | `newSlide()` — fresh slide | none (correct: a new slide is not a plan item) |
| `delete`, `reorder` | filter / permutation | kept |
| `insert`, `set` | `sanitizeSlideModel` (whitelist) | **was dropped → fixed** `slide-edit.ts:668` |
| `style` | `{...cur}` | kept |
| `footer` | `{...s, footer}` / `without` | kept |
| `answer` | `refreshAnswerNote({...s, quiz})` + `rebuildAnswerKey` (in-place on answers slide) | kept |
| end of `applyDocOps` | `renumber` → `{...s, id}` | kept |

`sanitizeSlideModel`'s early returns for degraded `table`/`quiz` (`{...out, layout:"bullets", …}`) run after
`plan` is assigned, so they keep it too. `inverseOps` produces `set`/`insert` carrying the full pre-op slide, and
those now go through the fixed sanitizer, so undo/redo keeps `plan`. The fix covers every reconstruction point
(3 points, 2 functions).

### (2) Bounds consistency with P2
`validPlan` (`slide-edit.ts:151`): `typeof number && Number.isInteger && 1..99`. P2's `planNumber`
(`slide-layout.ts:705` on `worktree-agent-a2fef9d701beab3ef`) uses the same test, so the two agree. P1 only writes a
truthy `beat.plan` (`slide-write.ts:448,639,814`, `slide-blocks.ts:478-513`), which is always a small positive
integer. Nothing out of range can come from generation.

### (3) `slideShapeOk` → 400 on a non-number `plan`
- It follows the existing pattern: `chart` rejects a non-boolean, `strOpt` rejects a non-string and `null`. Shape
  checks the type and gives a 400, and the sanitizer checks the content and silently drops a number that is not
  valid (0, 1.5, 100). The file header describes this same split.
- Old client (cached JS after deploy): the viewer never builds `plan`. `set`/`insert` only come from
  `inverseOps` (`components/files/useSlideEdit.ts:53-54`), which copies slides out of the server's `doc_json`.
  There `plan` is either absent or the number P1 wrote. JSON cannot hold NaN, and P1 never writes `null`.
  **An old client cannot send a non-number `plan`. Confirmed.**
- Harmless deploy-window edge case, not a change: an old bundle's local, optimistic `sanitizeSlideModel` drops
  `plan` from its own state after an undo. A later redo `set` from that state would then drop `plan` on the server.
  This only happens to a tab opened before the deploy that is editing a deck generated after it, and a reload fixes it.

### (4) `plan?: number` duplicated with P1 — NOT a trivial merge → C1
`git merge-tree --write-tree worktree-agent-a9012405b02674ca9 worktree-agent-af8a7de47015349b5` exits 0 (no
conflict), but the resulting `slide-types.ts` has `plan?: number;` **twice** (lines 68 and 90). P1 inserts it after
`chart`, P7 after `imageOrig`, so the hunks do not overlap. A duplicate property in a type literal is TS2300
"Duplicate identifier 'plan'". The `tsx` test runner strips types, so the tests would stay green, and only
`tsc`/`next build` would fail.

### (5) `doc/restore/route.ts` and `lib/server/slide-commit.ts`
- `restoreDoc` → `restoreGenerationDoc`: SQL `SET doc_json = doc_prev` stores the JSONB verbatim. `doc_prev` is
  written by `COALESCE(doc_prev, doc_json)` (`jobs.ts:1101`), also verbatim. No slide reconstruction happens, so
  `plan` is kept.
- `commitDocOps` → `adapter.apply` = `applyDocOps` (covered above). The slide adapter's `prepare` is the identity
  function (`edit-adapters.ts:77`). `renderHtml`/`buildPreview` only read. `patchDocFromRequest` → `parseDocOps`
  (covered). **No path there drops `plan`.**

### (6) Tests
`tests/slide-edit.test.mts`: **58/58 pass** (run once, in the worktree, under the cgroup cap).
The tests fail before the fix and pass after it (red→green). Mutation plausibility, checked by reasoning:
- removing the `baseOf` lines fails `:319`. The test converts bullets→process through `...base`.
- removing the sanitize lines fails `:355` and `:451`.
- removing the `slideShapeOk` line fails `:511`.
- `<=99`→`<=100` is caught (100 is in the bad list). `>=1`→`>=0` is caught (0). Dropping `isInteger` is caught
  (1.5). The upper boundary 99 is kept, and the lower boundary 1 is kept (the insert test uses `plan: 1`).
- dropping `typeof` in `validPlan` is an equivalent mutant: `Number.isInteger("3")` is false, so the result is the same.
- No DOM assertions (n/a).

## CHANGES

1. **(required, merge-blocking)** `lib/generation/slide-types.ts:82-83` — remove P7's `plan?: number` hunk and
   depend on P1's field (`worktree-agent-a9012405b02674ca9`, `slide-types.ts:62-68`, which has the fuller doc
   comment). Otherwise, merge P1 first and delete this copy while merging P7. Git merges the two branches **without a
   conflict** and leaves `plan?: number` twice in `SlideModel`, which is TS2300 at `tsc`/`next build` while the tsx
   tests stay green. After the merge, run `npx tsc --noEmit` (or confirm `grep -c "plan?: number" lib/generation/slide-types.ts` == 1).
2. (optional) `lib/generation/slide-edit.ts:151` — `validPlan` repeats P2's `planNumber` predicate
   (`slide-layout.ts:705`), so the bound 99 now lives in two places. After P2 merges, export one `isPlanNo(v)`
   (for example from `slide-types.ts` or `slide-layout.ts`) and use it in both.
3. (optional) `tests/slide-edit.test.mts:319` — also cover the layout that matters most: `layout → "section"`
   keeps `plan` (the bare-`base`/subtitle branch of `convertLayout`). Also add one undo round trip
   `apply(apply(doc, ops), inverseOps(doc, ops)) deepEqual doc` on a slide that has `plan`. This locks the
   `inverseOps`→`set` path end to end.
