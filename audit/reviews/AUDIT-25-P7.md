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

---

# P12 review — eee9a8a

INT-03 fix on `worktree-agent-a45f8181f192e88ae` (3d4587c red tests, 10b648f fix, eee9a8a refinements; base slides-3
`6a9f101`). Reviewed `git diff 6a9f101..eee9a8a -- lib tests` and the callers in `lib/server/**`.

## Verdict: CHANGES (1 required or owner sign-off, 1 required at the P11 merge, 2 optional)

The chokepoint is right, the ordering is right, the scope is slide-only, and it uses the same measure as generation.
The gap is **undo and restore across PATCHes on old decks**. The monotone rule compares against `before` only, so an
old deck can no longer get back its **own original** AI image once that image leaves the slide.

## Verified

- **Slide-only.** `guard` is implemented only by `slideAdapter` (`edit-adapters.ts:218`) and called optionally
  (`slide-commit.ts:159`, `cur.adapter.guard?.`). The resume, article, work and teacher adapters don't define it.
  Article polish and rewrite (`doc-polish.ts:469`, `article-rewrite.ts:190/366`) go through `commitDocOps` but get
  article adapters, so no guard. `commitPolishedDoc` (games and infographic) writes directly and is not a slide path.
  Deck restore (`doc_json = doc_prev`) bypasses the guard, which is correct: it returns the original state.
- **Nothing persists on rejection.** `commitDocOps` checks the version (409) → `apply` (422) → `guard` (400) →
  render → `transaction` (doc + `storeGenerationUploads`). `pendingUpload` is pure (`upload-quota.ts:188`), so a
  rejected upload writes neither the doc nor the asset row. A stale `baseVersion` gets 409 before anything is
  measured. Removing `assertTextFitsImage` loses nothing: the upload is an `image` op through the same guard, and
  test (6) covers replacing an image while the text stays the same.
- **`slideOrigins` index math.** It mirrors `applyDocOps` for each op:
  - `add` → `after+1`;
  - `delete` → filter;
  - `insert` → splice at `index`;
  - `set` → in place;
  - `reorder` → `order.map(k => o[k])`.

  Every other op edits in place. That includes `answer`, whose `rebuildAnswerKey` changes the answers slide in
  place, so it is not structural. The guard runs only after `apply` succeeded atomically, so every index is valid.
  I found **no counter-example** for a successful op list, including mixes such as `insert 0; reorder; delete 1;
  add -1`, where each step applies the same transform in both functions. On a length mismatch, `slideOrigins`
  returns `null` and every image slide gets the full check, so an error in this code refuses rather than lets
  overflow through.
- **Same measure as the writer.** `imageYieldField` is now the first key of `imageOverflowChars`. The predicate is
  unchanged: `longest > withImage && withImage < none`, with keys inserted in check order, and test `:586` locks it.
  Generation calls it with `bodyRules(meta, tpl.id)` + `tpl.visual` (`slide-write.ts:1151` →
  `slide-images.ts:240`). The guard uses `buildSlideDeck(after)`, which gives `bodyRules(doc.meta, tpl.id)` + `doc.slideVisual`,
  and the latter is pinned to `tpl.visual` at generation. The writer and the editor therefore can't disagree:
  a freshly generated image slide has overflow 0.
- **Performance is fine.**
  - `fitChars` is memoized process-wide (`slide-quality.ts:277/300`, keyed by field|count|rows|visual|bodyPt|minPt|images).
  - A cold miss is a linear probe of up to `MAX_PROBE_WORDS` layouts × 2 image modes. The key space is small and finite.
  - Untouched image slides skip measurement through a `yieldText` string compare, and `buildSlideDeck` runs once per PATCH.
- **Tests.** `slide-image-edit` + `slide-doc-route`: **62/62 pass** (33 + 29, one heavy run). I did not re-run
  `viewer-upload-commit` (Postgres).

## "Wrong slide after renumber": quantified

`renumber` makes ids positional (`s{i}`) after every commit. `via.id` therefore names a **position in `before`**,
not a slide. Within one PATCH (tested at `:616`) it is exact. Across PATCHes:
- (a) **False refusal.** Delete an old-deck image slide A that overflows (PATCH 1), then Ctrl+Z (PATCH 2:
  `insert` with id `sK`). `prevById("sK")` is now A's former neighbour, so the undo is refused unless that
  neighbour has an image and at least A's overflow on **every** field. In practice it is almost always refused, so
  the "undo of delete via id" claim holds **only within one PATCH**.
- (b) **False accept.** A new image slide with overflowing text, inserted with the id of an existing image slide
  whose overflow is at least as large per field, is accepted. The accepted overflow is limited by overflow the deck
  already has, this happens only on old decks, and it only affects the user's own deck. **Acceptable as debt.**

## CHANGES

1. **(required, or explicit owner sign-off as debt) Old decks: across PATCHes, undo and restore of the original
   image are refused, and the AI image becomes unrecoverable.** `edit-adapters.ts:138-170`: the bases are only
   `before[from]` and `before[via.id]`. Take an old deck (pre-P8) with an image slide whose box text already
   overflows the with-image box. INT-03 measured 17/18 audience × visual rows over in some field, so such slides
   are common:
   - «Rasmni o'chirish» (PATCH 1) → Ctrl+Z (PATCH 2, inverse `set` with the image). The base now has no image, so
     the full check runs → **400**, and the client reloads and drops the queue (`useDocEdit.settleFailure`).
   - «Rasmni qaytarish» (`imageRestore`) on the same unchanged slide → **400**.
   - Delete the slide → Ctrl+Z in a separate PATCH → **400** (renumber note (a)).
   - Shorten the text (allowed) → Ctrl+Z back to the original → **400** (the overflow grew relative to `before`).

   Before P12 all four worked. Afterwards, the only way back to the AI image is «Asl holatga qaytarish», which
   throws away every edit in the deck. Fix: add the **original deck** as a base. Load `doc_prev` lazily, only when
   a touched image slide fails both fast paths. Accept a slide if some image slide in `doc_prev` (or in `before`)
   has **the same `image.url`** and has no smaller overflow on any field (or the same `yieldText`). Matching by
   image URL identifies the slide whatever renumbering happened. That fixes (a) above and all four flows, and it
   keeps INT-03 flow 2 closed: text lengthened after the image was removed is still worse than the original.
   If `doc_prev` is null (deck never edited), `before` is the original. Add tests for each of the four flows as
   two-PATCH sequences.
2. **(required at the P11 merge; P11/P12 owners) The editor's clip on image slides must not be looser than the
   guard.** P11 (`worktree-agent-a237fc05b62d8188f`, `slide-edit.ts:112-115` `editLimits`) clips image-slide
   steps/stats/table/quiz at `clipLimit(…, {images:"both"})` = `max(CLIP_FLOOR_CHARS=24, fitChars)`
   (`slide-limits.ts:856` there). The guard (`imageOverflowChars`) uses the raw `fitChars`. Where the with-image
   box is under 24 characters (for example rail `stepText`×4 = 4, per the INT-03 table), the viewer accepts 5–24
   characters optimistically and then the server returns **400 `text_too_long`**. The client reloads and drops
   every unsent op. Fix: for `images:"both"` on an image slide, use the raw `fitChars` in `editLimits` (or give
   the guard the same floor, but then generation's `imageYieldField` would disagree). Lock the fix with a test
   on a rail process slide that has an image.
   **P12 tests that expect 400, checked against P11:** none of them change status. P11 text ops clip; they don't
   return 422, which comes only from count and structure guards. Every P12 test that expects 400 on a
   text/list/set/insert uses twoCol `left`/`right`, and P11 leaves those at the static `colItem` 110 (P11
   `slide-edit.ts:210`, `:369`, `:816`). The tests: (1) `:419`, (1b) `:425`, (3b) `:446`, (4b) `:479`, (5d)
   `:516`, (5e) `:530`, (6b) `:557`, monotone `:594` (second half), undo with a foreign id `:627`. If P11 later
   makes `colItem` image-aware, (1), (1b), (5d), (6b) and `:594` would flip to 200 (clipped before the guard) and
   must move to `set`/`image`/`imageRestore` payloads.
3. (optional) `edit-adapters.ts:150-165`: the monotone comparison is per field **key**. A `layout` op on an old
   overflowing image slide (twoCol `colItem` +50 → bullets `bullets` +10) is refused, because `bullets` is a new
   key (0 → 10), even though the overflow shrank. Compare the worst overflow ratio across fields instead, or treat
   a new key's baseline as the origin's worst overflow.
4. (optional) `edit-adapters.ts:97` `yieldText` omits `leftTitle`/`rightTitle`/`quoteBy`. It is correct today,
   since `imageYieldField` doesn't read them, but the comment's rule ("add new fields here too") has no test
   pinning it. Add one test that builds `yieldText` keys from the `imageOverflowChars` check list, or derive both
   from one table.
