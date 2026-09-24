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
