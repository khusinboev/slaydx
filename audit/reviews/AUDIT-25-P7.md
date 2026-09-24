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

---

# W7 review — 913ffaf

Commit `913ffaf` on `worktree-agent-a0d5632d4caac1626` (base slides-3 `720814e`, with P3's `limitsFor`).
Claim: in `slide-edit.ts`, the editor now clips steps/stats/table/quiz text through `limitsFor(rules, counts)` and
takes its count guards from `rules.*Max`, in `writeSlideField`, `sanitizeSlideModel` and `convertLayout`.

## Verdict: CHANGES (1 required, merge-blocking; 2 optional)

The wiring does what the commit says. Merged alone, though, it makes the editor **stricter than the generator**.
The result is that a one-character edit, or any undo, on an ordinary generated process or table slide silently
deletes content.

## What checks out

- **Static uses removed.** `grep SLIDE_LIMITS.(stepText|stepTitle|statLabel|tableCell|tableHeader*|quizOption|stepsMax|statsMax|tableCols|tableRows)`
  in `slide-edit.ts` finds only the default parameters of `splitStat`/`splitStep` (`:460`, `:471-472`).
  `canConvert` is the only caller that uses those defaults, and it only checks for null and throws the value away.
  The `quizOptions` (=4) uses are structural and correct.
- **Consumers of `EditRules`.** The only places that build it are `applyDocOps` (`buildSlideDeck(doc).bodyType`, the
  full `BodyRules`) and `SlideEditor.tsx:331` `listCap(slide, field, bodyType)`, where `bodyType` is also the full
  `BodyRules`. `lib/server/edit-adapters.ts:79` and `components/files/useSlideEdit.ts:53` both reach it through
  `applyDocOps`. Nothing passes the old narrow type. `rules.*Max` is never larger than the static cap
  (`countRules`: 3/3/3/4 or 4/4/4/5), so using `rules.stepsMax` directly instead of `limitsFor(...).stepsMax` is
  equivalent.
- **Count, then clip.** `convertLayout` (`:627-633`) and `sanitizeSlideModel` (`:746`, `:761`, `:779`) slice the
  count first and then clip at that count.
- **`canConvert` unaffected.** It still checks every item in the pool. `convertLayout`'s stats path now slices
  before calling `splitStat`, which gives the same result because `canConvert` has already guaranteed every item splits.
- **Tests.** `tests/slide-edit.test.mts` passes **68/68** (one heavy run). The 8 new tests compare school_1_4 against
  bachelor, so reverting a clip to `SLIDE_LIMITS` would fail the "narrow < wide" assertions. That matches the claimed mutation.

## CHANGES

1. **(required, merge-blocking) Editor ⊄ generator: edits and undo destroy generated content.**
   `normalizeSlide` in slides-3 (`lib/generation/slide-write.ts:138`, lines ~218/232/238/273, `STEP_TEXT_MAX =
   SLIDE_LIMITS.stepText`) still accepts **5 steps × 160 chars, 5 columns × 6 rows** from the model. The contract
   comment at `slide-quality.ts:355-365` ("generatsiya ⊆ tahrir"; P1 was to wire `normalizeSlide` to `rules`
   counts and `clipLimit`) has not been implemented, and none of the decks already in the DB were built under it.
   W7 now clips all of these, even for bachelor (`rules` = minPt 15, stepsMax 4, tableCols 4, tableRows 5;
   `limitsFor(rules,{steps:5}).stepText` = 30).
   Probe on the W7 tree (bachelor `lecture` deck, a `notes` edit, then undo via `inverseOps`):
   - process, 5 steps × 109 chars → after undo **4 steps × 50 chars** (round trip `false`)
   - table 5×6 → after undo **4×5** (a column and a row lost; round trip `false`)
   - stats with 4 cards: round trip `true`
   The same happens with no undo at all. Fixing a typo in step 1 of a generated 5-step slide goes through
   `writeSlideField` (`:353`, count 5 → stepText 30), so that step's 109 characters come back as about 30 plus "…".
   This breaks the documented invariant `apply(apply(doc,ops), inverseOps(doc,ops)) = doc`.
   Fix (owner W7, with the P1 area for the generator):
   (a) wire `normalizeSlide` to `rules.*Max` + `clipLimit`/`limitsFor` (the P3 contract) **before or together
   with** W7, so that new decks satisfy generation ⊆ edit;
   (b) for decks that already exist, never let the editor shrink content it did not change:
   - keep `sanitizeSlideModel` (the channel for undo, redo, delete-undo and restore through `set`/`insert`) on
     the static `SLIDE_LIMITS` caps for both counts and text, since it is a safety filter and not the fit policy;
   - in `writeSlideField`, clip the edited field at
     `max(limitsFor(...), min(staticCap, previousLength))`, so an edit can never make an over-limit field
     shorter than it already was.
   Add a regression test: an undo round trip on a bachelor deck with a 5-step process slide and a 5×6 table, `deepEqual`.
2. (optional) `slide-edit.ts:746-790`: `sanitizeSlideModel` now slices **before** it filters out invalid
   items. A step without a title or a stat without a value inside the first N therefore pushes a valid later
   item out, which the old filter-then-slice order kept. `colsN` also counts empty or non-string headers that
   `list()` then drops, so the limit key is conservative. Filter first, then slice, then clip at the real count.
3. (optional) `writeSlideField` add-step/add-stat (`:353`, stats new card): the count key goes up by one, but the
   existing siblings are not re-clipped. The slide can then sit over `limitsFor` at the new count, and the next
   `set` (undo) clips the siblings. Either re-clip the siblings when adding an item, or state that the layout's
   `fitSize` covers the difference.

## Client-side note (report only)

The viewer does **not** disagree with the server. It runs the same `applyDocOps`/`inverseOps` optimistically
(`components/files/useSlideEdit.ts:53-54`) with the same `buildSlideDeck(doc).bodyType`, and it adopts the server's
doc after each save (`useDocEdit.ts` `adoptKeepingQueue`). `components/viewers/**` has no static `SLIDE_LIMITS` and
no `maxLength` for the W7 fields. The only pre-check is `SlideEditor.tsx:331` `listCap`, which covers
bullets/columns and is unchanged. What the user sees: while typing, the inline editor shows the full text, and on
commit it is clipped with "…". That was already true under the static caps; the clip is just tighter now. An old
cached bundle clips optimistically at the static caps and then snaps to the server doc on save. Nothing to fix on
the client. The real visible problem is C1, the loss of content the user never touched, and it belongs to W7 and
the generator owner, not the viewer.
