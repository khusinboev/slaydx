# AUDIT-25 P3 review: text density (decision 6)

- **Branch:** `worktree-agent-a9f7a67a08728361d`, commits `3af333a`, `7d4c1e4`, `154e5d9` and `51ea3db` on top of `8862be5`.
- **Worktree:** `.claude/worktrees/agent-a9f7a67a08728361d`.
- **Reviewer:** independent and read-only. The only file written is this one.
- **Heavy commands:** 1 of 2, run through `heavy2.sh -m 3G -t 900`. It ran two things:
  - a probe script, `scratchpad/p3rev/probe.mts`. The fetch was stubbed and no real LLM was called.
  - 8 test files: `slide-quality`, `slide-limits`, `slide-audience`, `slide-quiz`, `slide-edit`, `slide-edit-v2`, `safe-text` and `slide-convert`. Result: **171/171 pass**.

## Verdict: **CHANGES**

The overall design is right. There is one measured source for the prompt, the detector and the clip. `limitsFor` answers P2's CHANGE 1(a): text length and element count now depend on the audience. `clipTo` cuts at word boundaries.

However, the repair step can make a slide **worse**, and in two cases it can make a slide **false**:
- it can produce 5 cut-off steps for 1–4 grade;
- it can put a wrong answer key on a quiz;
- it can invent an extended version of a real quote.

Separately, the prompt and the clip disagree for tables, so an adult table that follows the prompt gets cut to 25 characters. All of these were reproduced with stubbed replies (probe §5).

---

## CHANGES

### Blocking

1. **Repair ignores the audience step count and produces cut-off steps.**
   - **Where:** `lib/generation/slide-quality.ts:575,580,586`.
     - `textMax` is computed for `raw.steps.length`, which can be up to 5.
     - The steps are sliced to `SLIDE_LIMITS.stepsMax` (5), not to `rules.stepsMax`.
     - `stepTitle` is clipped to the static 40.
     - The acceptance check at `:497` then lowers `minWords` to whatever fits at 5 steps. That makes the result "not thin" automatically.
   - **Probe:** `school_1_4`, a thin 3-step slide, and a stub that returns 5 steps. The result is **accepted with 5 steps**, and every text is `"Suv sathi…"` (10 characters, from `limitsFor(kids,{steps:5}).stepText`). `stepsMax` for this audience is 3.
   - **Fix:**
     - In `mergeRepair`, set `n = min(raw.steps.length, limitsFor(rules).stepsMax, layoutWordTargets(rules, visual).maxSteps)`.
     - Slice to `n` **before** clipping.
     - Clip text with `clipLimit("stepText", rules, visual, n)` and title with `clipLimit("stepTitle", rules, visual, n)`.
     - Reject the repair if `n < PROCESS_MIN_STEPS`.
     - In `thinReasons` (`:497`), evaluate `minWords` at `min(list.length, rules.stepsMax)`. This stops an oversized step list from lowering its own bar.
   - **Test:** the kids stub above must return ≤ 3 steps, each text ≥ `minWords` words, and no `…`.

2. **Quiz repair can silently corrupt the answer key.**
   - **Where:** `slide-quality.ts:619-631`. The code accepts any 4 options as long as `answer` equals the original index.
   - **Probe:** the stub rewrites the clipped option, moves the correct text into slot B, puts a distractor in slot A and keeps `answer: 0`. The result is **accepted**. The key now points to "Yer silkinishi natijasida…", which is wrong. `finalizeQuiz` then writes this wrong key into the speaker notes and the answers slide.
   - **Fix:**
     - Only options that are flagged may change: those that end with `…` or are longer than `clipLimit`.
     - Copy every other option byte-for-byte from the original and ignore the model's version.
     - A changed option must start with its original's un-clipped prefix (the original minus `…`, compared case-insensitively on the first ⌈60 %⌉ of the characters). Otherwise reject the slide.
     - Apply the same prefix rule to `q` (`:629`).
   - **Test:** the swap case must be rejected, and unflagged options must stay identical.

3. **Drop `short-quote` from the detector.** This also resolves the P5 contradiction.
   - **Where:** `slide-quality.ts:515-518` and `REASON_TEXT` at `:646`.
   - **Probes:**
     - "Bilim — kuch." (F. Bekon) is flagged `short-quote`.
     - A stub reply that pads it to 20 words is **accepted and attributed to Bacon**. That is a fabricated quotation. It breaks the project's honesty rule and the repair prompt's own «Uydirma … manba YO'Q» (`:707`).
     - The motivation block's question quote «Orol nega qurib qoldi?» is also flagged.
   - **Why this settles P5:** P5 removed `thin-quote` for exactly these reasons (P5 CHANGE 9, approved). P5 also has a merge-time requirement to replace its heuristic with `thinSlides`, so keeping the rule here would bring the false positive back through the live gate.
   - **Recommendation:** keep `QUOTE_MIN_WORDS` only as the prompt floor in `wordTargetLines`, which is fine as guidance. Remove it from `thinReasons`/`thinSlides`.
   - **Tests to update:** `tests/slide-quality.test.mts:124-129` and `:151-156`. Change the latter's fixture to `section` + `process`.

4. **Block slides are bullets candidates (another P5 alignment).**
   - **Where:** `slide-quality.ts:487-493` treats every `bullets` slide alike.
   - **Probe:** `school_5_7` "Dars maqsadlari" with 4–5-word goals is flagged `short-bullets`. Repair would lengthen block slides (maqsadlar, uyga_vazifa) that are short by design.
   - **Fix:** following P5's approved rule, apply `few-bullets`, `short-bullets`, `short-columns` and `short-steps` only to plan content slides (`typeof s.plan === "number"`, from P1). Keep `empty-subtitle` and `clipped-option` for all slides.

5. **Tables: the prompt and the clip use different keys, so prompt-compliant cells get cut.**
   - **The clip side** (`lib/generation/slide-limits.ts:336-337`): `rowKey` sends `rows === 5` to the **5×6** measurement.
     - Every ≤ 16 pt audience has `tableRows: 5`, so `limitsFor(rules)` and any 3×5 or 4×5 table get `tableCell = 25` and `tableHeader = 25`.
     - Kids with the default rows (4) get `tableCell = 20`, but 40 with `rows: 3` (probe §4).
   - **The prompt side:** `layoutWordTargets.tableCellMax` (`slide-quality.ts:425`) is measured with `tableRowsOf(cols)` rows (`:128`, so 4×4) and a static cap of 60. So the bachelor prompt asks for «4 tagacha ustun, 5 tagacha qator, katak ≤ 6 so‘z» (~54 characters). A table that follows it is cut at 25 characters.
   - **Fix:**
     - (a) Measure the combinations `countRules` actually allows (3×3, 3×4, 4×4, 4×5, 5×6) with `fitChars(…, "none") × 0.88` and key `COUNT_LIMITS` by `(cols, rows)`.
     - (b) Give `fitChars`, `clipLimit` and `PROBES.tableCell/tableHeader` an explicit `rows`.
     - (c) Compute `tableCellMax` at `(maxTableCols, maxTableRows)`, the same key that `normalizeSlide`/`slide-edit` will pass.
   - **Test:** for every audience, `tableCellMax × 9 ≤ limitsFor(rules, {cols: maxTableCols, rows: maxTableRows}).tableCell`.

6. **The contract changed without the doc: record it.**
   - The doc says `thinSlides(slides, rules): number[]`. The code is `(slides, rules, visual?) => {index, reasons}[]`.
   - The doc says `repairThinSlides(…, deadline)`. The code adds a **6th** parameter, `jobDeadline`.
   - Update `docs/AUDIT-25.md` §3. P5's merge must use `.map(x => x.index)`, or better, the reasons.
   - P1's commented call site (`worktree-agent-a9012405…:slide-write.ts:822`) passes only 5 arguments. Without `jobDeadline`, the job-deadline pre-check (`:697`) is skipped and `llmComplete` has no EXT-03 deadline. See the wiring list, W1.

### Should-fix before merge (not blocking on their own)

7. **Static cap vs editor.**
   - **The problem:** `SLIDE_LIMITS.quizOption` 60 → 130 (`slide-limits.ts:206`) is also the **editor** cap (`slide-edit.ts:372`). The tightest measured option box is 85 characters at 16 pt (circle/cards; `lesson` = circle), 75 at 18 pt, 53 at 20–22 pt and 24 at 24 pt.
   - **Before and after:** before, 60 fit every box at ≥ 16 pt. Now a viewer edit of 86–130 characters in a general, management or employees `lesson` deck overflows. The viewer clips it (`overflow: hidden`) and the PPTX spills it, which breaks "ko'rdim = oldim".
   - **Fix:** add `quizOption` to `limitsFor`, per floor, from the measured row × 0.88 (≈ 110/70/65/45/45/20). `slide-edit.ts` and `normalizeSlide` then use `limitsFor(rules).quizOption`, while the runtime `clipLimit` stays visual-aware.
   - **Ownership:** `slide-edit.ts` belongs to no package. The lead must assign it, together with P2's CHANGE 1(a) requirement that the editor enforce the same per-audience limits.

8. **Degenerate or contradictory prompt ranges** (probe §1).
   - Examples:
     - «har band 1–1 so‘z» (school_1_4/circle twoCol);
     - «2–2» (5_7);
     - «text 4–4»;
     - bachelor «3–4 bosqich, har bosqich text 6–6 so‘z», which is sized for 4 steps with an image even when the model writes 3 (capacity 3 steps ≈ 90 characters);
     - «closing 8–8».
   - One-word column items also contradict «TO‘LIQ gap».
   - **Fix:**
     - add `maxColItems` through `maxCount` (as for steps), so the item count drops before words drop below `COL_MIN_WORDS`;
     - give the step-text range per count ("3 bosqich: a–b; 4 bosqich: c–d");
     - print `min === max` as a single number.
   - Also at `slide-quality.ts:444`, the register «kam yozsang … ko‘p yozsang» is informal against the rest of the prompt («yozing»). Use «kam yozilsa … ko‘p yozilsa kesiladi».

9. **Comments that are wrong.**
   - **`slide-quality.ts:751-755`** says a later `assertJobTime` stops the deck. There is none in the slide pipeline; the only call is `slide-write.ts:622`, inside `askRange`.
     - Swallowing `DeadlineError` **is** correct here. `deadline.ts:12-15` defines optional stages as ones that route `DeadlineError` into their skip path.
     - The call cannot push completion past the job deadline. The timeout is `min(45 s, remainingMs(stageDeadline))`, and the stage deadline comes before the image and assembly shares. The chain is also bounded by `jobDeadline`.
     - Cite `deadline.ts` instead, and log `isDeadlineError(e)` distinctly.
   - **`:283-288` and `:328-329`** say the clip "never goes below `CLIP_FLOOR_CHARS`". That is false when `limitsFor` < 24: kids `tableCell×5` = 5 and `stepText×5` = 10 (probe §4). Safety relies on P1 truncating counts first (W3). Say so.

10. **Measurements in this branch come from the pre-P2 layout.** `c7a1c82` is not an ancestor of `8862be5`, so `fitChars` here measures the old process/stats/table font floors.
    - The `limitsFor` lock (`tests/slide-quality.test.mts:511-526`) therefore passes trivially on this branch.
    - **After merging P2** (and again after P2's CHANGES 1–2), re-run `slide-quality`, `slide-audience`, `slide-limits` and the probe. Expect `COUNT_LIMITS` cells and brief numbers to move.
    - `layerFits` (`:211-221`) re-implements the fit formula. Switch it to P2's exported measure (`inkHeight`, bold-aware after P2 CHANGE 2), or the two will drift.

### Minor

11. **`clipTo`** (`slide-limits.ts:381-388`).
    - It produces «Orol dengizi.…» (period plus ellipsis). Strip `[.!?]` before `…`, or end without `…` when the cut lands on a sentence end.
    - `/\s+/` turns NBSP (U+00A0) into a plain space, so a cut can split «5 %». This behaviour existed before, but the new word-boundary logic now acts on it. Use `/[ \t\n\r\f\v]+/`.
    - The other edge cases are fine: n = 1 → «…», n = 2 → «O…», a single long word or URL is hard-cut to exactly n, a trailing comma or dash is dropped, and an emoji at the boundary is handled.

12. **The `clipped` check (`:475`) flags fill-in-the-blank questions.** For example, «1/2 + 1/4 = …» → `clipped-option`. `clipTo` output is always ≥ ⌈0.6(n−1)⌉+1 characters, so gate the check: `endsWith("…") && length ≥ ⌈0.6·(cap−1)⌉`.

13. **Repair prompt (`:700-712`).** It says «Boshqa slaydlarni takrorlamang» but never shows the other slides. Add the deck's slide titles, one line.

14. **`short-steps` uses `some`.** One healthy 5-word step («Natijani baholash va xulosa chiqarish») flags the whole bachelor slide. Consider "average < `STEP_MIN_WORDS` OR any step ≤ 3 words".
    - Kids bullets of 4–6 words are flagged because `bulletMinWords` rounds 5.5 up to 6 (`:69`). Use `Math.floor`.
    - `section` < 6 words = "empty" is acceptable. A subtitle makes no factual claim, and repair only adds to it. Optionally also treat subtitle == title or topic as empty.

---

## Checks (by question)

**1. Detector.**
- Rules follow decision 6 (few or short bullets, step < 6 words, empty section subtitle, option `…`). Two additions go beyond it: `short-columns` and `short-quote`, see CHANGE 3.
- Thresholds depend on the audience: `bulletMinWords(rules)`, `minBullets`, and `fitWords` clamps at `:497,505`.
- Stats, table, agenda, closing, answers and references are never candidates.
- Quiz is flagged only for clipped or oversize options (`:519-523`).
- Probe results on realistic slides:

  | Slide | Result | Verdict |
  |---|---|---|
  | Bachelor bullets, 10–12 words | not flagged | correct |
  | 4 × 6–8-word steps | not flagged | correct |
  | 7-word Navoiy quote | not flagged | correct |
  | Short famous or motivational quote | flagged | wrong (CHANGE 3) |
  | Block goals | flagged | wrong (CHANGE 4) |
  | Terse compare items (4 words) | flagged | borderline, acceptable |

**2. Repair.**
- Exactly one `llmComplete` call (`:726`) with `json: true`.
- `timeoutMs = min(45 s, remainingMs(stage))`, `deadline: jobDeadline`, and pre-checks of 12 s on both deadlines (`:695-697`). This mirrors `slide-write.ts:620-627`.
- It never throws. Swallowing `DeadlineError` matches the EXT-03 optional-stage rule (see 9).
- `maxTokens = min(6000, 600 + 450·n)` is in line with the writer's `2000 + 420·n`. Thinking defaults to 0, and usage goes to `recordLlmUsage`.
- `REPAIR_MAX_SLIDES = 8`, in deck order, is fine.
- The prompt carries the language directive, topic, subject, `rules.note`, the bullet range, all MAKET HAJMI lines and the research lines.
- **The title is never changed:** `mergeRepair` spreads `orig` and never reads `raw.title`. The hostile test at `:336-356` locks this. The agenda therefore does not go stale.
  - P1's `syncAgenda` after repair is harmless. Keep it as a guard in case a future repair rewrites titles.
- The accept rule ("no longer thin") is sound once CHANGE 1 closes the self-lowering bar.

**3. Limits.**
- **`COUNT_LIMITS` against P2 × 0.88, rounded down to 5 and capped.** I recomputed every row: stepText 3/4/5, stepTitle 3/4/5, statLabel 2/3/4 (minimum of cards and chart), tableCell 3/4/5 and tableHeader 3/4/5. **All cells match.** Explicit spot-checks:
  - stepText×3 @24 pt: 50 → 44 → 40 ✓
  - stepText×5 @24 pt: 15 → 13.2 → 10 ✓
  - statLabel×3 @22 pt: min(75, 55) = 55 → 48.4 → 45 ✓
  - statLabel×4 @15 pt: 85 → 74.8 → 70 ✓
  - tableCell×4 @18 pt: 50 → 44 → 40 ✓
  - tableHeader×4 @16 pt: 40 → 35.2 → 35 → cap 26 ✓
- **0.88 headroom:** this is the 10–15 % P2 asked for.
- **`title` 80 → 72:** no test or editor path hard-codes 80. The tests use `SLIDE_LIMITS.title` symbolically (`slide-limits.test.mts:89-91`, `slide-edit.test.mts:139`), and editor clipping is only in `slide-edit.ts:270`. Old docs with 73–80-character titles are left alone, because only the edited field is re-clipped.
- **`clipTo` in tests:** every test using it with `"a".repeat` hard-cuts to exactly n, so it stays green.
- **How the static cap and the runtime clip interact:**
  - `SLIDE_LIMITS` is the ceiling for the editor and the static path.
  - `limitsFor` is audience × count and is client-safe.
  - `clipLimit` = min(`limitsFor`, visual-measured) and is server-only.
- **Can a long option still overflow?** Yes, **if P1 keeps static `QUIZ_OPTION_MAX` (130)** (`slide-write.ts:53,257`):
  - options of 86–130 characters pass `normalizeSlide` and overflow circle/cards at 16 pt;
  - `thinReasons` catches them (`o.length > clipLimit`, `:520-521`) and asks for a repair;
  - if the repair is skipped (no budget, rejected, or more than 8 thin slides), the overflow ships.
  - So P1 **must** clip options with `clipLimit("quizOption", rules, tpl.visual)` (W4). The editor is covered by CHANGE 7.

**4. Counts and brief.**
- `countRules` is sensible: ≥ 20 pt → 3/3/3×4; 18 pt → 4/3/3×4; ≤ 16 pt → 4/4/4×5. It matches P2's capacity table: kids at 5 steps get 15 characters and at 4 stats 30. It needs the row-key fix in CHANGE 5.
- The `bulletChars/9` upper bound is correct. The bachelor maximum is now 18 words (≈ 162 ≤ 165), where it used to be 21 words ≈ 190, which was clipped.
- The brief's Uzbek is correct apart from the register note in CHANGE 8.
- The static `structure.ts` lines contradict it: the brief gives bachelor process 6 words, but `structure.ts:44` says 10–15. See W6.

**5. Client safety.**
- `slide-limits.ts` imports only `safe-text` plus a **type-only** `BodyRules`, so it stays client-safe. `slide-quiz.ts` (imported by `SlideEditor.tsx`) now imports `slide-limits`, which is fine.
- `slide-audience.ts` is unchanged in its imports.
- `slide-quality.ts` imports `llm.ts`, `planSlide` and `research`, so it is server-only. Its only importer is `slide-prompt/brief.ts`, reached through `slide-prompt/index.ts`, which only `slide-write.ts` imports. No component imports it (grep of `components/`, `app/`, `lib/api-client.ts`).
- There is no import cycle.
- The measurement cost with a known visual is 9–22 ms per audience on a cold cache (probe §1). This is fine.

**6. Tests.**
- **Result:** 171/171 pass across the 8 files.
- **Good:**
  - boundary pairs (min−1 against min) for every reason;
  - hostile-field preservation;
  - single-call and no-call checks under the budget gates;
  - 400, abort, broken JSON and `DeadlineError` paths;
  - the quiz answer-shift reject;
  - an absolute live-deck pattern for each reason, which keeps the tests alive under constant mutation.
- **Missing:** the three failure modes in CHANGES 1–3 (step count on repair, option-order swap, real-quote rewrite) and block slides (CHANGE 4).
- **The `limitsFor` lock:** it is one-sided (limit ≤ measured + 12 characters), which is the right direction. On this branch it is vacuous (CHANGE 10). After merge it becomes the useful "which cell is stale" alarm, and that is not fragile.
- **Mutation claims:** plausible from the boundary pairs. I did not re-run the mutations, as I was limited to 2 heavy commands.

**7. Wiring.** See the list below. The lead has P3's own 6 requests, which were not shown to me. This list is what the contract actually needs; compare the two.

---

## Exact list P1 must wire

- **W1.** In `slide-write.ts writeSlidesWithLlm`, after `applyResearchRefs` + `syncAgenda`:
  - **move the `slideFloor` check above the repair**, so no money is spent on a deck that returns `null`;
  - `slides = await repairThinSlides(slides, meta, tpl, ctx, deadline, jobDeadline)`: **six arguments**, and `slides` must become `let`;
  - `syncAgenda(slides, rules)`, then `finalizeQuiz`.
- **W2.** Delete the local mid-word `clip` (`slide-write.ts:55-58`) and use `clipTo` everywhere: `arr`, `normalizeSlide`, `syncAgenda`, and the title kicker at `:787,792`. The live `lecture-12` mid-word cuts came from **this** path. P3's `clipTo` only reaches the editor and the quiz note.
- **W3.** `normalizeSlide` must truncate **counts first**:
  - `steps ≤ rules.stepsMax`
  - `stats ≤ rules.statsMax`
  - `table cols ≤ rules.tableCols`
  - `rows ≤ rules.tableRows`

  Only then clip lengths. Otherwise the n = 5 limits of 5–10 characters apply.
- **W4.** Length clips through `clipLimit(field, rules, tpl.visual, count)`:
  - `stepText` and `stepTitle` at `steps.length`;
  - `statLabel` at `stats.length`;
  - `tableCell` and `tableHeader` at cols **and rows**, after CHANGE 5;
  - `colItem` at the column length;
  - `quizOption` with no count.

  Plumb `tpl.visual` through `parseDeckJson`, `extractNewSlides` and `normalizeSlide`.
- **W5.** Replace the hard-coded `clip(head, 40)`, `clip(rest, 90)` (`:348-349`) and `clip(quote, 220)` (`:362`) with `SLIDE_LIMITS.stepTitle`, `limitsFor(rules,{steps}).stepText` and `SLIDE_LIMITS.quote`.
- **W6.** In `slide-prompt/structure.ts`, delete the **5** numeric lines that `wordTargetLines` now owns:
  - `:41` section 20–35;
  - `:42` closing 15–25;
  - `:43` twoCol/compare 10–15;
  - `:44` process 10–15;
  - `:50` table «2–4 ustun, 3–5 qator, 2–5 so‘z».

  Keep their non-numeric instructions as number-free lines: «Savollar va muhokama» kabi bo‘sh ibora emas; «nima qilinadi va natija nima»; «Uydirma raqam emas — tasnif, qiyos…».
  Tests to update:
  - `tests/slide-blocks.test.mts:451` (section line) and `:454` (table line), to pin `— section: subtitle` and `— table:` from `wordTargetLines`;
  - the comment at `tests/slide-chart.test.mts:216` («10–15 so'z»).
- **W7.** Unowned, so the lead must assign it. `slide-edit.ts` must use `limitsFor(rules, counts)` for step, stat and table text, and `limitsFor(rules).stepsMax`/`statsMax` for the count guards (`:317,338,590,594`). It also needs `quizOption` per CHANGE 7. Without this, P2's CHANGE 1(a) is not met.

## Requests to P2 (confirming and completing P3's notes)

- **Boxes too small to be fixed by limits:**
  - option cards in circle, cards and editorial at 24 pt hold 24 characters (≈ 2 words), and 53 at 20–22 pt;
  - twoCol items at 22–24 pt with 4 items hold 16–24 characters;
  - rail, dashboard, circle and split column and step boxes;
  - the longest-word and bold-width issue (P2 CHANGE 2) cannot be fixed by character limits.
- **Export the layout's `inkHeight` fit measure** so that `slide-quality.ts layerFits` uses the same model.
- **After P2's CHANGES 1–2 land,** re-run the P3 lock tests. Update `COUNT_LIMITS` cells where the lock fails, and update the fingerprint only after that.
