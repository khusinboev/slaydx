# AUDIT-25 P2 review — layout numbering (decision 4) + audience font floors (A2-04)

Branch `worktree-agent-a2fef9d701beab3ef` (5 commits `042b547..754ec44` over `e89c7c1`), worktree
`.claude/worktrees/agent-a2fef9d701beab3ef`. Reviewer: independent, read-only (only this file written).
Heavy commands used: 2/2 via `heavy2.sh -m 3G -t 900`: (a) a measurement script
(`scratchpad/p2rev/measure.mts`: branch vs `e89c7c1` extracted with `git archive` into the scratchpad),
(b) a capacity script plus 7 test files. Contact sheets looked at: `sheet-atlas-a0/a1/a2/b0/b2`, `sheet-ink-a2`.

## Verdict: **CHANGES**

The decision-4 half (numbers come only from `plan`) is correct and well tested. I would approve it as is.
The A2-04 half (audience font floors) stops text shrinking below `minPt`, but nothing stops text from
overflowing its box. At lengths the writer and the editor are allowed to produce (`SLIDE_LIMITS`), text
overflows its box in almost every visual. In the smallest cases a realistic 45-character step text is
enough. Because the viewer clips text (`overflow: hidden`) and the PPTX spills it (`shrinkText: false`),
the overflow also breaks "ko'rdim = oldim". The fingerprint test also fails on the branch (1/107).

---

## CHANGES

1. **Blocking: the A2-04 overflow has no guarantee.** `lib/generation/slide-layout.ts:399-408` (`bodyFit`)
   says "uzunlik yozuv bosqichida (`SLIDE_LIMITS`/`clipTo`) cheklanadi". That is false today. `SLIDE_LIMITS`
   (`lib/generation/slide-limits.ts:41,43,49,51,59,61,63`) is independent of the audience: stepText 160,
   statLabel 110, tableCell 60, stepsMax 5, statsMax 4, tableCols 5, tableRows 6.
   At `school_1_4` (minPt 24) with limit-length text, the measured overflow is: process 69–136 of 102–170
   boxes (worst 884 % of box height), stats 51/51 and 68/68 in every visual (worst 325 %), and table 102–595
   boxes (worst 396 %). Before the branch, the same text fit in 0 boxes overflowing, except process×5.
   Even `general` (minPt 16) now overflows: table 5×6 has 510/595 boxes over, stats-chart×4 has 68/68, and
   process×4 has 68/136. See the table below.
   The two renderers then disagree:
   - `components/viewers/SlideCanvas.tsx:54` (`overflow: "hidden"`, with `valign: middle` it clips both top and bottom);
   - `lib/generation/render-pptx.ts:170` (`shrinkText: false`, text spills out of the card).

   Choose one before merging:
   - (a) Make merging P2 depend on P3 shipping **per-audience** limits for text length **and** counts
     (stepTitle/stepText, statLabel, tableHeader/tableCell, stepsMax/statsMax/tableRows/tableCols) taken from
     the capacity table below. `slide-edit.ts` must enforce the same limits, because viewer edits also go
     through `SLIDE_LIMITS`.
   - (b) Add an interim guard inside `bodyFit`. It keeps `minPt` when the text fits at `minPt`, and
     otherwise continues down to the old hardcoded floor (16→12 / 14→11 / 15→11 / 14→10), so the result
     never overflows. The guard can be removed once (a) lands.

   Either way, add a test to `tests/slide-plan-numbers.test.mts`: for every audience × visual × layout at
   that audience's limits, `inkHeight(text, box.w, size) <= box.h`. The current "uzun" case (`:284`) only
   asserts `size >= minPt`, so it **locks the overflow in** instead of catching it.

2. **Blocking: realistic short content already overflows or breaks mid-word.** This is independent of the
   limits question.
   - 5-step `process` at school_1_4/5_7/8_9: the step text "Suv sathini har oy o'lchab, jadvalga yozamiz."
     (45 chars) overflows in **all 17 visuals**. At 4 steps it overflows in `rail`. The two-row flow test
     (`tests/slide-plan-numbers.test.mts:340`) only runs `general` and excludes `rail` (`:350`), which is
     why this was missed.
   - `rail` process with 5 steps at school_1_4: the step titles break **mid-word**. "Kuzatis|h" and
     "Taqqosl|ash" are visible on `sheet-atlas-b2.png` (rail row, column 3). `bodyFit(st.title, tBox, 19, …)`
     (`lib/generation/visuals/rail.ts:320`) now starts at bodyPt 28. `CHAR_EM` 0.55 underestimates bold
     glyph width, so `fitSize` believes "Kuzatish" fits in the roughly 1.7″ column.
   - At school_10_11, "Taqqoslash" does not fit per line even by the model's own estimate (10 > 9 chars at 22 pt).
   - dashboard stats-chart×4 at school_1_4: "Sug'orishga" and "Filtratsiya" (11 > 10 chars/line at 28 pt).

   Fix: `bodyFit` must also shrink (not below `minPt`) until the **longest word** fits on one line. Use a
   bold-aware width factor for bold layers. Where the longest word still does not fit at `minPt`, the fix
   depends on change 1: fewer steps per audience, or the guard in (b). Extend the fit tests to every
   audience, include `rail`, and cover 4 and 5 steps.

3. **Blocking before merge: the fingerprint is stale.** `tests/slide-image-strip.test.mts:366` still
   expects `23b6f081e48c642414a88a1d96fdcce6`. The branch produces `d096c8285f6d6acedcd9fe2ecdbcfdc4`.
   Suite result: 107 tests, 106 pass, 1 fail. I checked the claim that only A2-04 moved it: my replica
   reproduces the old hash exactly. The changed rows are **only** `{classic,cards,dense,timeline,magazine,hero-split} × {stats,process,table} (± logo)`.
   All twoCol/compare rows are byte-identical. So the claim holds. Update the hash **after** changes 1–2
   settle (they will move it again). Add the usual "Yangilangan: AUDIT-25 A2-04 …" note with the old hash,
   as the test's own comment requires.

4. **Non-blocking: title slides should never be numbered in code either.** `editorial.ts:86`,
   `split.ts:111` and `story.ts:61` call `planNumber(s)` inside `planTitle`. Today they only stay
   un-numbered because P1 never sets `plan` on a title slide. Decision 4 says title slides are never
   numbered, so hard-code `no = null` in these three `planTitle`s. That also removes the dy/up branches.
   Add a `plan: 2` title case to the test at `tests/slide-plan-numbers.test.mts:196`, which currently only
   covers plan-absent.

5. **Merge housekeeping.** When P1's `SlideModel.plan?: number` lands, drop these aliases:
   - `type PlanSlide` and the `(s as PlanSlide)` cast at `lib/generation/slide-layout.ts:689,706`;
   - the alias at `tests/slide-plan-numbers.test.mts:34`;
   - the `as SlideModel` cast in `tests/slide-layout-audit8.test.mts` (`planned`).

   `LAYOUT_KIT` gains `bodyFit` and `planNumber`, and `planNumber` is also a named export. Both are fine to keep.

---

## (4) Overflow and capacity data for P3 (measured with the layout's own `inkHeight` / `fitSize` model)

**Overflow at SLIDE_LIMITS lengths** (stepTitle 40 / stepText 160, statLabel 110, tableHeader 26 / tableCell 60):

| case | school_1_4 (minPt 24): boxes over, worst | before (e89c7c1) | general (minPt 16): boxes over, worst |
|---|---|---|---|
| process×3 | 69/102, 333 % | 0 | 19/102, 156 % |
| process×4 | 136/136, 633 % | 4, 107 % | 68/136, 244 % |
| process×5 | 122/170, 884 % | 85, 199 % | 90/170, 378 % |
| stats cards×2 | 4/34 (bold, dashboard), 135 % | 0 | 0 |
| stats cards×3 | 51/51 (all 17 visuals), 217 % | 0 | 0 |
| stats cards×4 | 68/68, 325 % | 0 | 8/68 (bold, dashboard), 144 % |
| stats chart×3 | 51/51, 217 % | 0 | 0 |
| stats chart×4 | 68/68, 325 % | 0 | 68/68, 144 % |
| table 3×3 | 102/204, 144 % | 0 | 0 |
| table 4×4 | 340/340, 188 % | 0 | 0 |
| table 5×6 | 595/595, 396 % | 0 | 510/595, 188 % |

Typical school_1_4 boxes: step text box 1.74″ (3 steps, 0.49″ at 5 steps; rail 1.30″) against 4.3–9.5″
of ink. Stat label box 1.1–2.3″ against 3.0–4.8″ of ink. Table cell box 1.30″ against 1.73″ of ink;
header box 0.60″ against 0.87″.

**Capacity: the longest word-cut text that fits every box in every visual** (chars, binding visual in parentheses):

| case / field | 1_4 @24 | 5_7 @22 | 8_9 @20 | 10_11 @18 | general @16 | bachelor @15 |
|---|---|---|---|---|---|---|
| process×3 step.text | 50 (rail) | 50 | 55 | 75 | 90 | 105 |
| process×3 step.title | 30 (rail) | 30 | 35 | 40 (classic) | 70 | 75 |
| process×4 step.text | 30 (rail) | 30 | 35 | 55 | 65 | 65 |
| process×4 step.title | 20 (classic) | 20 | 20 | 30 | 45 | 45 |
| process×5 step.text | 15 (rail) | 25 | 25 | 35 | 35 | 35 |
| process×5 step.title | 15 (rail) | 15 | 15 | 30 | 30 | 30 |
| stats cards×2 label | 80 (bold) | 110 | 130 | 140 | 200+ | 200+ |
| stats cards×3 label | 45 (bold) | 75 | 75 | 90 | 110 | 135 |
| stats cards×4 label | 30 (bold) | 40 | 40 | 50 | 75 | 85 |
| stats chart×3 label | 45 (bold) | 55 | 75 | 90 | 110 | 135 |
| stats chart×4 label | 30 (bold) | 35 | 40 | 50 | 75 | 85 |
| table 3×3 cell | 50 (classic) | 55 | 70 | 105 | 110 | 125 |
| table 3×3 header | 20 | 20 | 20 | 30 | 55 | 65 |
| table 4×4 cell | 25 | 25 | 45 | 50 | 75 | 90 |
| table 4×4 header | 15 | 15 | 15 | 20 | 40 | 40 |
| table 5×6 cell | 10 | 10 | 20 | 25 | 30 | 30 |
| table 5×6 header | 10 | 10 | 10 | 15 | 30 | 30 |

Takeaway for P3: at school ages, limits must depend on **count** as well as length. Allowing 5 steps,
4 stats or a 5×6 table at school_1_4 makes any meaningful text impossible (at most 15/30/10 chars).
The model's width estimate is also optimistic for bold text (change 2), so leave about 10–15 % headroom.

---

## Checks that passed

1. **Deck-index number sites.** All 12 sites from A2-01 and 3 from A2-02 are gone. In
   `slide-layout.ts`, `slide-layout-extra.ts` and `visuals/*.ts`, every remaining `i + 1`, `two(i + 1)` and
   `padStart(2` is a **list ordinal** and is fine:
   - `slide-layout.ts:1448,1519,1582` (bullet cards, lab rows, agenda); `slide-layout.ts:251` (plain-text join);
   - `slide-layout.ts:2357` and `rail.ts:305` (`st.n || i+1`);
   - `slide-layout-extra.ts:530` (references);
   - agenda and bullets in `dashboard.ts:264`, `story.ts:279`, `split.ts:275`, `notebook.ts:254`,
     `formal.ts:216`, `bold.ts:194/196`, `rail.ts:234`, `editorial.ts:243,292`;
   - badges at `academic.ts:251` and `circle.ts:225,261`.

   The one deck-index use left is the footer page counter at `slide-layout.ts:314` (`n / total`), which is
   correct. The test "indeks 0 → 6 matnni o'zgartirmaydi" sweeps every layout × visual × image × plan and is
   a strong guard for this.
2. **`planNumber` semantics.**
   - With a plan, "03" appears exactly once per slide in 17 visuals × all themes × 4 variants (tested).
   - The rail double paint is fixed: with an image the number sits on the label, without one inside the ring.
   - Invalid plan values (0, −1, 2.5, NaN, > 99) give null.
   - Without a plan, no bare number is drawn, and the sheets show no hole or misalignment. Each design
     collapses its number space instead:
     - academic moves the rule left;
     - bold/notebook/story/editorial raise or centre the block;
     - dashboard widens the title;
     - circle shows a target, rail a node, split nested squares;
     - magazine centres the block with a rule.
   - Title slides are un-numbered today (but see change 4).
3. **`src`.** The new number layers and decorative rects (`pushSquares`, circle target, rail node, story
   inset frame) carry no `src`. The "03" test asserts `src` and `srcLines` are both undefined.
   `slide-src.test.mts` and `slide-src-extra.test.mts` pass.
4. **Old docs (plan absent), compared as byte-identical `planSlide` JSON against e89c7c1:**
   - agenda, twoCol, compare, quote, closing, quiz, references and answers are **identical** in every
     visual, with and without an image;
   - the changes are limited to title (story/split/editorial: number removed), section (magazine + the 10
     designs: number removed, plus the deliberate dashboard grid-line move 3.75→4.22), bullets (story
     without an image only) and stats/process/table (A2-04 only).

   This matches the claim.
5. **Viewer/PPTX parity.** No new layer kind (still rect/text/image) and no new field. `rect.line` without
   a fill is handled by both renderers (`render-pptx.ts:90-91`, `SlideCanvas.tsx:156-158`). `tracking` and
   `radius` were already supported. The only parity risk is the overflow in change 1.
6. **Tests.** The 12 new tests plus 3 changed audit8 tests all pass (together with slide-src, slide-src-extra,
   slide-layout and slide-visuals). The decision-4 tests are strong. The mutation claim (short text never
   reaches the floor, so a long case was added) is plausible and matches cf5a6ee. However, the A2-04 tests
   assert only `size >= minPt` and never that the text fits, except two narrow cases; see changes 1–2.
7. **Observation, no change requested.** The story no-image bullet column shows the plan number on content
   slides that have a `plan`. That gives one number per slide and is consistent with the band number. A2-02
   preferred dropping it, and this is an acceptable reading of decision 4.

---

# Re-review — b90a4db

Commits `e8053de → 63cdb43 → 1d71e2f → 8ff830a → b90a4db`, reviewed as `git diff 754ec44..b90a4db`.
Heavy commands used: 2/2.
- Run 1: `tests/slide-plan-numbers.test.mts` + `tests/slide-image-strip.test.mts` (**23/23 pass**), plus a probe script (`scratchpad/p2rev/probe2.mts`).
- Run 2: six mutants of `slide-layout.ts`, run against a scratch copy (`scratchpad/p2rev/mut/run-mutants.sh`). The worktree was not touched.

Contact sheets checked: `z-rail-atlas-09.png` shows whole words and the same size in every card. `z-classic-atlas-09.png` shows two rows of 3+2 cards, each row at one size, with no overflow.

## Verdict: **CHANGES** (test-only, 2 small items; no code change requested)

The code addresses first-review changes 1–4. The fit test can still pass after two targeted regressions of that code, as shown by the surviving mutants below.

## CHANGES

1. **The fit test reads the width constants from the layout under test, so the rail mid-word regression
   survives.** `tests/slide-plan-numbers.test.mts` has `BOLD_EM = LAYOUT_KIT.CHAR_EM_BOLD` and imports
   `CHAR_EM` from `slide-layout.ts`. Mutant **M1** sets `CHAR_EM_BOLD = 0.55` in
   `lib/generation/slide-layout.ts:402`, which is exactly the value that produced "Kuzatis|h". The mutant
   **SURVIVES** the whole file.
   The height model `inkIn` is a real re-implementation, not the layout's `inkHeight`/`wrapRows`, and that
   part is good. But its constants must also be independent. Pin literals in the test: `0.55` for regular
   and `0.60` for bold, citing the PIL measurement. Optionally also assert `LAYOUT_KIT.CHAR_EM_BOLD >= 0.6`.
   After the change, M1 must be killed.
2. **Nothing locks the "same size across a row" rule.** Mutant **M5** makes `fitStepCards` always
   `return own`, which undoes 1d71e2f, and it **SURVIVES**.
   Add a test using the real `Kuzatish/Taqqoslash/Tahlil/Xulosa/Taklif` case with 3, 4 and 5 steps, for
   every visual and for school_1_4 and general. Within each row, all `steps.title` layers must share one
   `size`, all `steps.text` layers must share one `size`, and all title boxes must share one `h`. Apply the
   same check to the single row in `rail`.

## Notes (non-blocking)

- **N1: the word check is switched off for real Uzbek words in narrow rail cards.** `bodyFit`
  (`slide-layout.ts:436-455`) computes `wordFitsAtLow` **with** `WORD_HEADROOM`. In a 5-step `rail` card
  (bold title box about 1.6″), natural 15–19 character words fail that check even at the 12 pt floor.
  Examples are "O'zgartirishlar", "Rivojlanishining", "Tadqiqotchilarning" and "Ko'rsatkichlarining". The
  check is then disabled, and the probe shows these titles set at **18 pt breaking mid-word**, both for
  school_1_4 and for general.
  - "O'zgartirishlar" (15 chars) fits at 12 pt without the headroom, so computing `wordFitsAtLow` without `WORD_HEADROOM` fixes that case.
  - Words of 16 characters or more cannot fit in that column at any size at or above the floor. That needs a P3 count limit: no 5-step rail at school ages.

  No other box in the probe (base process with 4 or 5 steps, stats cards×4, table with 5 columns) hit this
  path. So the escape for strings without spaces does not switch off the word check for normal text,
  except in that one column.
- **N2: the floors hold.** Across all 14 audiences × 17 visuals, at 1× and at 2× `SLIDE_LIMITS`, the
  smallest sizes seen are: step title 12, step text 11, table cell 10 (11 at 1×), table header 11, stat
  label 11 (dashboard 13 at 1×), and stat values base 18, bold 24, dashboard 19. None is below the old
  floors (12/11/10/11/11/15/24/18).
  By construction the lowest possible size is `min(floor, minPt)`. For body text that is always the old
  floor, because `minPt` is at least 15. For the big values in `bold`/`dashboard` it becomes `minPt` when
  that is below 24 or 18. The chart value was a fixed 16 pt before and can now shrink to 11. Both happen
  only for values that previously overflowed their box, so this is a deliberate improvement.
- **N3: overflow.** At 1× `SLIDE_LIMITS`, **0 of 18 802** body layers overflow (the first review measured
  up to 884 %). At 2× the limits, 10 318 of 18 802 overflow. Text that long is outside the limits, and
  e89c7c1 overflowed there too, so it needs P3's limits and `slide-edit`'s limits, not the layout.
- **N4: `fitStepCards` fallback is sound.** If any card fails on its own, each card keeps its own result.
  The shared attempt uses the smallest title size, which cannot increase any card's title height (it stays
  within `titleCap`). It then re-checks every description at the shared height and falls back if one does
  not fit. `fitTitleText` returns its last attempt with `ok: false` when nothing fits. In base
  `planProcess` that is the one remaining overflow path, and it only happens beyond the limits.
  `rail` grows the card to 6.75 before giving up. The empty `slice(perRow)` for single-row layouts returns
  `[]`, which is correct.
- **N5: the fingerprint comment follows the house format.** It reads "Yangilangan: AUDIT-25 A2-04 — …",
  lists the affected rows, and keeps the old hash `23b6f081…` and the earlier AUDIT-8 entry. The new hash
  is `0e94598e…` and the test passes.
- **Mutation summary:**

  | Mutant | Change | Result |
  |---|---|---|
  | M1 | `CHAR_EM_BOLD` 0.55 | SURVIVED (change 1) |
  | M2 | guard removed (`low = minPt`) | killed |
  | M3 | `WORD_HEADROOM` 1.0 | survived; acceptable, the test does not model headroom |
  | M4 | word check disabled | killed |
  | M5 | `fitStepCards` → own | SURVIVED (change 2) |
  | M6 | title cap not lowered | killed |

- The earlier change 4 (titles never numbered) is done. `editorial`, `split` and `story` `planTitle` no
  longer read `plan`, and the test covers `plan: 2`. Change 5 (drop the `PlanSlide` alias at merge) still stands.
