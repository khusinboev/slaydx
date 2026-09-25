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

---

# Re-review — 7d335fb

- **Scope:** `git diff bb61411..7d335fb`. `bb61411` merges `slides-3`, which includes P2's `d05550e`. `6c1dca2` holds the fixes and `7d335fb` the test hardening.
- **Heavy command:** 2 of 2, one run through `heavy2.sh`. `tests/slide-quality.test.mts` + `tests/slide-limits.test.mts`: **48/48 pass**. The run also re-ran the probe with new re-review cases.
- **Contract (item 6):** fixed by the lead in `docs/AUDIT-25.md:59-62` (`thinSlides(…, visual?) → {index, reasons}[]`, 6-argument repair, order `slideFloor → repair → syncAgenda → finalizeQuiz`). Confirmed on `slides-3`.

## Verdict: **APPROVE**

Items 1–5 and 7–14 are closed. The three failure modes I reproduced now fail safe, and the probe re-run confirms it.

## Item by item (file:line in `7d335fb:lib/generation/slide-quality.ts` unless noted)

1. **Closed.** `mergeRepair` process:
   - `n = min(raw.steps.length, rules.stepsMax, maxSteps)`, with a reject below 3 (`:677-678`);
   - `slice(0, n)` comes before clipping (`:682`);
   - text and title are clipped with `clipLimit` at `n` (`:679-680`).

   `thinReasons` now evaluates at `min(list.length, stepsMax)` (`:579`), so an oversized list cannot lower its own bar. Test `repair: process — son auditoriya ruxsatigacha qisiladi`.
2. **Closed.**
   - Unflagged options are copied byte-for-byte (`:733-737`).
   - Flagged options must pass `samePrefix` at 60 % (`:651-656`, `:740`), and so must `q` (`:744-746`).
   - `answer` must match (`:730`).
   - Probe: the swap attack from the first review is now **rejected**.
3. **Closed.** `short-quote` is gone from `ThinReason` (`:520`) and from `REASON_TEXT`. `QUOTE_MIN_WORDS` is kept only as the prompt floor (`:56-61`). The quote prompt line adds «haqiqiy iqtibos bo‘lsa — aynan asl matn» (`:507`), and the repair rules add «iqtibos YO‘Q» (`:828`). Probe: «Bilim — kuch.» is left untouched.
4. **Closed.** The `isPlanSlide` gate (`:541-544`) applies to bullets, process and columns. `empty-subtitle` and `clipped-option` still apply to all slides. This matches P5's rule.
5. **Closed.**
   - `tableKey(cols, rows)` picks the smallest measured table that covers both, from 3×3/3×4/4×4/4×5/5×6 (`slide-limits.ts:303-316`).
   - `fitChars`, `clipLimit` and `staticCap` take `rows`, which defaults to `rules.tableRows` (`:276`, `:339`, `:367-369`).
   - `tableCellMax` is computed at `(maxTableCols, maxTableRows)` (`:476`).
   - Probe: adult `limitsFor(rules).tableCell` = 45 (it was 25).
   - A new test pins prompt ≤ clip on the same key for 5 audiences × 2 visuals.
7. **Closed on the P3 side.** `limitsFor().quizOption` per floor is `[110,70,65,45,45,20]` (`slide-limits.ts:~299`, `:380`); kids get 20 and adults 110. The editor wiring (`slide-edit.ts`, W7) is still unassigned. It is the lead's item, not P3's.
8. **Closed.**
   - `fmtRange` (`:441-443`) removes «N–N».
   - Step-text ranges are given per count, e.g. bachelor «3 bosqichda 8–10, 4 bosqichda 6».
   - `maxColItems` now drops the item count first, e.g. kids «har ustunda 2 band».
   - The prompt says «kam yozilsa … ko‘p yozilsa kesiladi».
   - The test scans for any `N–N`.
9. **Closed.** The catch comment now cites the optional-stage rule in `deadline.ts` and logs `isDeadlineError` separately (`:873-884`). The `CLIP_FLOOR_CHARS` comment now says it applies only to live measurement and that P1 W3 truncates counts first (`:312-321`).
10. **Closed.**
    - Re-measured on P2's merged layout.
    - `layerFits` uses `LAYOUT_KIT.inkHeight` with `CHAR_EM_BOLD` for bold layers (`:232-241`).
    - Floored fields count as "fits" only at ≥ `minPt` (`AUDIENCE_FIELDS`, `:119-128`, `:289-292`), which is correct because P2's `bodyFit` goes below the floor to stay inside the box.
    - `COUNT_LIMITS` is rebuilt as min(P2, live) × 0.88 (`slide-limits.ts:250-300`).
    - The lock test now re-derives each cell with the same rule, so it is a real alarm.

    Two consequences are justified by the measurement:
    - `countRules` at 18 pt → 3 steps (`slide-audience.ts:127-129`);
    - `quizQ` 200 → 100, because the question is bold: the narrowest box holds 104 and the median 121.

    `title` was removed from the static lock with a note that it is a P2 box problem (bold section title in circle/editorial). The lead should confirm this is on P2's list.
11. **Closed.** `clipTo` keeps NBSP and uses `/[ \t\n\r\f\v]+/`. It strips `.!?` before `…`. Tests at `tests/slide-limits.test.mts:331-335`.
12. **Closed.** `clippedAt` checks the length gate `≥ ⌈0.6·(cap−1)⌉` (`:536-539`). «1/2 + 1/4 = …» and «Va hokazo…» are no longer flagged.
13. **Closed.** The user prompt now lists «Dekadagi slaydlar: 0) … ; 1) …» (`:836`).
14. **Closed.**
    - Step rule: average < `minWords` OR any step < min(4, `minWords`) (`:582-583`). One healthy 5-word step passes; a one-word step fails.
    - `bulletMinWords` uses `floor` (`:72-75`).
    - A section subtitle equal to its title counts as empty (`:601`).

## Mutations reasoned through (test named, not re-run)

- **R1:** set the process slice back to `SLIDE_LIMITS.stepsMax`, i.e. `n = min(raw.steps.length, 5)` at `:677`.
  - For kids, `textMax` becomes `clipLimit(stepText, kids, circle, 5)` ≤ `limitsFor(steps 5)` = 5, so every text becomes a stub.
  - Acceptance then evaluates at n = 3 (`:579`). The average is ≈ 1 word, below `tiny`, so the merged slide is still thin and is rejected, and `out[0] === thin`.
  - `assert.notEqual(out[0], thin, …)` in «repair: process — son auditoriya ruxsatigacha qisiladi» turns red. **Killed.**
- **R2:** delete the byte-identical branch (`:735-737`), so every option goes through the model.
  - «Jarima solish (MODEL O'ZGARTIRDI)» still passes `samePrefix` against «Jarima solish» (60 % of 13 characters = «jarima s»), so it is accepted.
  - `assert.equal(opts[0], "Jarima solish", …)` turns red. **Killed.**
- **R3:** drop the `samePrefix` check at `:740`.
  - In the swap reply, slot 0 is unflagged and kept. Slot 1 (flagged) takes «Yer silkinishi natijasida suv kamaydi», which is not clipped and is ≤ cap, so the slide is accepted.
  - `assert.equal(…[0], quiz, "almashtirish — rad")` turns red. **Killed.**
- **Also checked:**
  - R4, `:579` back to `list.length`: kids 5 × 3 words gives `fitWords` at 5 = 1, the slide is not thin, and the «five … short-steps» assert turns red.
  - R5, the old `max(cols, rowKey)` key: adult `tableCell` = 20, and «limitsFor(adult).tableCell >= 40» turns red.
  - R6, `clippedAt` without the length gate: «1/2 + 1/4 = …» is flagged, and the `[]` assert turns red.

## Non-blocking follow-ups (not required for merge)

- **N1. Degenerate shortening passes `samePrefix`.**
  - **Probe:** a 178-character option (cap 110) that the model shortens to «Am» is **accepted**. `k = ⌈0.6·min(len)⌉ = 2` («am»).
  - **Why it is non-blocking:** it cannot move the key, because the prefix is the original's, and it needs a pathological reply.
  - **Fix:** when shortening, also require `next.length ≥ min(was.length, ⌈0.5·cap⌉)` in `samePrefix`/`:740`.
- **N2. Student tables prefer more columns over fuller cells.** After P2's floors, the bachelor and general brief says «4 tagacha ustun, 5 tagacha qator, katak ≤ 2 so‘z». `TABLE_CELL_MIN_WORDS = 2` (`:410`) lets 4 columns beat 3 fuller columns. Consider 3 for ≤ 16 pt.
- **N3. Very tight boxes are P2's to fix, not character limits.** For 1–4 grade (circle) the brief says «ustun sarlavhasi ≤ 1 so‘z», «har variant ≤ 2 so‘z» and «2 tagacha karta/ustun»; the general/dashboard column title is also ≤ 1 word. The numbers are coherent (prompt ≤ clip). The boxes are small, which is already on the P2 request list.
- **N4. P1 wiring changed with this re-review.**
  - `clipLimit` now takes `(field, rules, visual, count, rows)`, so W4 must pass the table **rows**.
  - `QUIZ_Q_MAX` becomes 100 through `SLIDE_LIMITS.quizQ`, with no code change.
  - W1–W7 from the first review otherwise stand.

---

# Wiring review — 3807d0b (P1: W1–W6 + N4)

- **Scope:** `git diff 720814e..3807d0b -- lib tests` in worktree `agent-a9012405…`. The branch already contains P3 `7d335fb` and P2 `d05550e` (checked with `merge-base`).
- **Heavy command:** one fresh run through `heavy2.sh`. Files: `slide-plan`, `slide-limits`, `slide-blocks`, `slide-chart` and `slide-quality`. Result: **112/112 pass**.

## Verdict: **CHANGES** (one item, small)

The call site, clip order, counts and `visual` plumbing are all correct. One regression came in with W6: the AUDIT-8 minimum row count for tables was deleted from the prompt.

## CHANGES

1. **The AUDIT-8 minimum table size is gone.**
   - W6 replaced `structure.ts`'s «table layout: 2–4 ustun, 3–5 qator» with «katak matni qisqa». It also deleted the comment that explained the floor: «Qator soni POLI 3: «2–5» so'ralganda model 2 qator qaytarar, jadval slaydning yuqori uchdan birida qolardi (AUDIT-8)».
   - The replacement, `wordTargetLines`, gives only an **upper** bound: «— table: N tagacha ustun, M tagacha qator» (`slide-quality.ts:504`).
   - The model is therefore free to return 2 rows again. That brings back the AUDIT-8 layout defect, and below 2 rows `normalizeSlide` falls back to bullets.
   - **Fix, preferred in P3's single source:** `wordTargetLines` → «— table: 2–${maxTableCols} ustun, 3–${maxTableRows} qator…». `maxTableRows` is ≥ 4 for every audience, so this never contradicts the maximum.
   - **Alternative:** a number-free line in `structure.ts` («jadval kamida 3 qatorli bo‘lsin»).
   - **Pin it in `tests/slide-blocks.test.mts:517-529`.** In the same test, also pin the kept non-numeric tails. Today only the line prefixes are matched, so these could be deleted unnoticed:
     - «Savollar va muhokama» kabi bo‘sh ibora emas;
     - Bir so‘zli yorliq emas;
     - nima qilinadi va natija nima;
     - Uydirma raqam emas — tasnif, qiyos.

## What I checked (file:line in `3807d0b:lib/generation/slide-write.ts`)

- **Repair call site (W1)** is correct.
  - The order is `applyResearchRefs` → `syncAgenda` → `slideFloor` (return `null` before any repair spend) → `slides = await repairThinSlides(slides, meta, tpl, ctx, deadline, jobDeadline)` → `syncAgenda` → `finalizeQuiz` (`:858-889`).
  - `deadline` is `writeSlidesWithLlm`'s text-**stage** deadline, and `jobDeadline` is the EXT-03 job deadline. The contract in `docs/AUDIT-25.md:62` is met.
  - Moving the floor above `finalizeQuiz` is safe, because `finalizeQuiz` never changes `slides.length` (no splice or push).
  - The agenda re-sync is harmless: repair keeps titles.
  - Tests: «W1: … AYNAN bitta ta'mir chaqiruvi…» (calls `["writer","repair"]`, `plan` kept, agenda equals the plan titles) and «… kam slayd (pol) — ta'mirdan OLDIN rad» (no repair call).
- **No double clipping that cuts a word twice.** The local mid-word `clip` and `clipWords` are removed.
  - `list()` only normalizes and truncates the **count**; `arr()`, `col()`, table, process, stats and quiz each call `clipTo` **once** (`:85-97`, `:196-200`, `:210-231`, `:244-258`, `:261-291`, `:311`).
  - The only re-clip is `coerceLayout` bullets→process (`:398-406`). It runs `clipTo` over a string that `clipTo` already cut. Both cuts land at word boundaries (≥ 60 % share), so there is still no mid-word cut. The W2/W5 test asserts the boundary on the coerced text.
- **Counts are truncated before length clips (W3):**
  - stats: `.slice(0, lim.statsMax)`, then `clipLimit("statLabel", …, cards.length)`;
  - process: `.slice(0, lim.stepsMax)`, then title and text limits at `raws.length`;
  - table: headers `lim.tableCols` and rows `lim.tableRows`, then `clipLimit(…, cols, rows)` (N4);
  - columns: `SLIDE_LIMITS.colItems`, then `clipLimit("colItem", …, items.length)`.

  The test «W3/W4: normalizeSlide AVVAL sonni kesadi…» proves the count and length for 1–4 grade and bachelor, word-boundary cuts, and that the two audiences differ.
- **`visual` reaches `normalizeSlide` from the real deck template on both paths:**
  - streaming: `extractNewSlides(…, { final: false }, tpl.visual)` (`:759`);
  - batch: `parseDeckJson(raw, footer, n, rules, tpl.visual)` (`:772`);
  - streamed slides go through `coerceLayout(…, rules)` (`:678`), the same as final assembly (`:851`).

  The new parameter is optional and last, so older callers keep working.
- **W5:** the hard-coded 40/90/220 are gone. `coerceLayout` uses `limitsFor(rules, {steps})` and `SLIDE_LIMITS.quote`. It is audience-aware but not visual-aware, which is acceptable: `limitsFor` is already the narrowest visual × 0.88.
- **The `slide-limits` test rewrite did not weaken P3's guarantees.**
  - Only the `normalize:` expectations changed. The expected values now come from `limitsFor` and `clipLimit` with the deck's own rules and visual, so they check that the right count, rows and visual reach the call. On their own they are a weaker oracle than a fixed number.
  - The independent checks live in `slide-plan` W3/W4 (counts, audience difference, word boundary).
  - P3's own sections are **untouched**: the `clipTo` word-boundary, NBSP and «.…» tests, the `limitsFor` table and floor tests, and the `tableKey` test.
  - `slide-chart`'s ≥ 135 `stepText` lock is still there (comment only).

## Non-blocking

- **N1. No test pins the `jobDeadline` forwarding.** If the 6th argument were dropped, W1 would still be green. Add a case: stage deadline ample, `jobDeadline = now + REPAIR_MIN_MS − 1 s` → `calls` equal `["writer"]`.
- **N2. `list()` and the title path collapse NBSP before `clipTo`.** Both use `/\s+/`, which undoes P3's NBSP preservation («12 km») for generated text. Use `/[ \t\n\r\f\v]+/`, the same as `clipTo`.
- **N3. Column item count is still the static 4.** `normalizeSlide` does not apply `layoutWordTargets.maxColItems`, which is prompt-only (for example, 2 for 1–4 grade/circle). A 4-item kids column is clipped to ≥ 24 characters per item (the `CLIP_FLOOR_CHARS` floor), not dropped. That is acceptable, but if P2 cannot enlarge those boxes, consider truncating to `maxColItems`.

---

# P8 review — 2244e93 («matn rasmdan ustun»)

- **Scope:** `git diff 879f495..2244e93 -- lib tests`, worktree `agent-a3f1353a…`.
- **Heavy commands:** 2 fresh runs through `heavy2.sh`.
  1. `slide-quality` + `slide-images`: **54/54 pass**.
  2. `slide-plan` + `slide-limits`: **48/48 pass**. The same run included a bullets-capacity probe (`scratchpad/p3rev/p8probe.mts`: 14 audiences × {standart, kop} × 17 visuals, box ink measured with the layout's own `listRows`/`inkHeight`).

  The tests ran with `hermetic-env` and without `.env*`. `fetch` is stubbed in every new test: Gemini `/interactions` for images, and `withLlm` for repair and the writer. No network or LLM call is made (question 6).

## Verdict: **CHANGES** (1 code item) + 1 owner decision

The P8 mechanism is correct and well tested:
- `PROMPT_HEADROOM` applies to words only, while counts stay on raw capacity;
- the text stage clips with `NO_IMAGE`;
- the yield predicate is shared by planning and logging;
- the exclusion happens before `want`.

The code change is the one field P8 left out: bullets. P8's own rule is "normalizeSlide and repair clip at the same no-image limit", and for bullets it does not hold today.

## CHANGES

1. **Clip bullets at the box, not only at `bulletChars`.**
   - **Where:** `lib/generation/slide-write.ts:368` (and the table fallback at `:260`). Bullets are clipped at `rules.bulletChars` only. P8's own `mergeRepair` already clips bullets at `clipLimit("bullets", …, NO_IMAGE)` (`slide-quality.ts`, mergeRepair `bullets`), so the writer and the repair disagree for the same field.
   - **Probe:** at `bulletChars` length, bullets are longer than the no-image bullets box in **21 template-visual cases at `standart`** (11 of them with ink > 100 % of the box) and in most `kop` cases:

     | Case | bulletChars | Box (chars) | Ink / box |
     |---|---|---|---|
     | school_1_4/circle | 80 | 75 | 111 % |
     | school_5_7/circle | 100 | 85 | 101 % |
     | school_5_7/dashboard | 100 | 75 | 115 % |
     | school_8_9/editorial | 120 | 104 | 112 % |
     | school_10_11/dashboard | 140 | 139 | 116 % |
     | school_5_7/kop/circle | 135 | 85 | 142 % |
     | school_10_11/kop/circle | 189 | 75 | 241 % |
     | students_bachelor/kop/circle | 223 | 121 | 201 % |

   - **Why it is visible:** bullets use `fitSize`/`fitLines`, which stop at `minPt` and then overflow. The viewer clips the overflow (`overflow: hidden`) and the PPTX spills it, which breaks "ko'rdim = oldim". This does not happen for a model that obeys the prompt, because the bullet maximum is ≤ 0.85 × box. It does happen on the overshoot that P8's own live data shows (4 of 7 decks).
   - **Fix:** in the `bullets` layout, clip at `Math.min(rules.bulletChars, clipLimit("bullets", rules, visual, items.length, undefined, NO_IMAGE))` after the count is cut to `maxBullets`, the same "count first" order as the other fields. Agenda, references and answers keep their own limits.
   - **Test:** school_5_7/circle, 3 bullets of ~100 characters → each ≤ the box limit and cut at a word boundary. Also confirm that normalize and repair agree.
   - **Not a P8 regression:** the clip has been at `bulletChars` since before AUDIT-25. It is cheapest to fix here, because P8 owns these call sites and the "one rule for writer and repair" claim.

## Owner decision (not a code defect)

- **D1. Dropping images with no refund on `pro-slide`.**
  - **What the code does:** `plannedImageSlots(…, rules)` removes a slide whose text does not fit the with-image box **before** `want` is set. The image is not produced and no partial refund follows.
  - **The conflict:** `pro-slide` is advertised as «Har slaydda AI chizgan rasm» (`lib/tools.ts:376`) and priced per slide.
  - **Why it needs sign-off:** this is a money and promise policy, which by project rule needs the owner's agreement before deploy.
  - **The choices:**
    - (a) accept, and optionally reword the promise to «har mos slaydga»; or
    - (b) count yielded slides in `want` so the existing refund applies.

  The code is correct for either choice; only the placement of `want` changes.

## Questions asked

1. **`want`/`got` and refund.** Correct.
   - `report.want = planned.length` is taken after the exclusion (`slide-images.ts:~321-325`).
   - `jobs = planned.filter(!s.image)` and `got = want − jobs.length + successes`, so **`got ≤ want`** always.
   - `delivered.ts:90-94` reads the **stored** `doc.slideImages.want/got` and never recomputes the plan.
   - Test (c) asserts want 3 → 2, got = want, and that the live wait list excludes the yielded slide.
2. **Old docs and re-render.** Safe.
   - The exclusion applies only to `!s.image` slides, so a slide that already has an image is never excluded.
   - `plannedImageSlots` is called only from `attachSlideImages`, which runs only at generation time. The render paths, `lib/server/slide-image.ts` and the viewer never call it.
   - A later layout change can therefore change future plans only. Stored `want`/`got` and attached images are never touched.
3. **Bullets at `bulletChars`.** A **real overflow risk** (see CHANGE 1). school_5_7/circle is borderline at standard volume (100 vs 85, 101 % ink at the full 100 characters). The wider risk is school_1_4/circle and school_5_7/dashboard at `standart` (111–116 %) and nearly every visual at `kop` (up to 2–2.8×). **Fix it now, in P8** (one line plus a test). It is a pre-existing gap, not a P8 regression, but P8's same-rule claim and the headroom rationale both depend on it.
4. **The prompt vs clip test is still meaningful.** Test (a) asserts `words × 9 ≤ 0.85 × clipLimit(with-image)` for every audience × volume × visual (floor exceptions only at 1–2 words). It fails if the headroom is removed (`PROMPT_HEADROOM = 1`), or if any field goes back to a static maximum. The earlier P3 invariants, "prompt ≤ `limitsFor` on the same table key" and "min ≤ max", are kept. Counts use raw capacity (`maxCount` with headroom 1), so P2/P3's count decisions do not move.
5. **Editor path** (the viewer adds an image to an over-long slide; P8's request 2). **Severity: medium. P8 makes it reachable.**
   - **Why P8 exposes it:** before P8, the text stage clipped at the with-image box, so adding an image could not push text past it. Now text can legitimately reach the larger no-image box.
   - **What happens:** adding an image through `lib/server/slide-image.ts uploadSlideImage` (or the viewer editor) to a twoCol/process/stats/table slide narrows the content zone.
     - twoCol (`fitLines`, floor `minPt − 2`) **overflows**, with the viewer/PPTX mismatch described above;
     - process/stats/table (`bodyFit`) drop **below the audience floor**, down to the old design floor, which breaks the Slide Law but stays inside the box.
   - **Owner:** the editor/image-route owner (the W7 assignee, `slide-edit.ts`/`slide-image.ts`), not P8.
   - **Fix:** on image set, call `imageYieldField(slide, bodyRules(meta, tpl), visual)`. If it is non-null, either refuse with «Matn rasm bilan sig‘maydi — avval matnni qisqartiring» or accept with a visible warning.
   - **Timing:** it should land before P8 is deployed, since P8 widens the gap.
6. **No network or LLM in tests.** Confirmed (see the top of this section).

## Non-blocking

- **N1.** `imageYieldField` compares `clipLimit` values, which include `CLIP_FLOOR_CHARS` 24 and the static cap, not raw `fitChars`. In a with-image box of fewer than 24 characters, a 24-character text is treated as fitting. This is an edge case.
- **N2.** The `rules` parameter of `plannedImageSlots` and `attachSlideImages` is optional. `image-lab` and other callers keep the old behaviour, as intended. Worth one line in the `AttachImageOpts` doc saying that the `buildSlideAcademicDoc` path must always pass it (it does, at `slide-write.ts:1128`).

---

# P11 review — 74d9446 (+ addendum 9c20f85)

- **Scope:** P11's own files: `git diff 6118d66..74d9446 -- lib tests` (`slide-limits.ts`, `slide-quality.ts`, `slide-edit.ts`, `slide-write.ts` + tests), plus `git diff 74d9446..9c20f85`.
- **Heavy commands:** 2 of 2, run through `heavy2.sh`.
  1. `slide-quality`, `slide-limits`, `client-bundle-guard`, `client-boundary`, `bundle-split`: **76/76 pass**. The same run included a module-init cycle probe (`scratchpad/p3rev/cycle.sh`: every cycle member imported **first** in a fresh process, then `clipTo`/`clipLimit`/`QUIZ_LETTERS` called).
  2. `slide-plan` + `slide-edit` (at `74d9446`): **111/111 pass**. The same run included an agenda-capacity and cold-cost probe (`scratchpad/p3rev/agenda-probe.mts`).
- `9c20f85` was reviewed by reading only; my heavy budget was already spent.

## Verdict: **CHANGES** (2 blocking, 1 should-fix)

The core is right. `clipLimit` follows the deck visual, with the tightest-visual table used only as a fallback. The prompt rule is "5 words, otherwise the no-image box", and the detector uses the same rule. Counts are the audience limit ∩ `layoutWordTargets` on every path. The quote and `coerceLayout` clips are correct, and so is the P8 bullets fix (`bulletItems`). What remains is the clip edge that `raw` opened and the agenda contract.

## CHANGES

1. **Blocking (addendum `9c20f85`): `clipTo(text, 0)` returns almost the whole text, and the `raw` editor path can pass 0.**
   - **Where:** `lib/generation/slide-limits.ts clipTo`. With `n = 0`: `safeSlice(t, -1)` is `t.slice(0, -1)`, and `Math.ceil((0 − 1) × 0.6) = −0`, so the word-boundary branch always succeeds. Example: «Suv bug‘lanadi va bulut hosil qiladi» → «Suv bug‘lanadi va bulut hosil…» (30 characters for a 0-character box).
   - **How 0 happens:** `fitChars` returns 0 when not even one word fits (`probeText(0)`). `limitsFor(…, { raw: true })` no longer has the 24-character floor, so a new step, or a field whose old text is empty, gets `editLimit(0, …, 0) = 0`.
   - **The result:** the editor writes a long «…» text optimistically. The P12 guard then answers 400 `text_too_long`, and `useDocEdit` drops the queued ops.
   - **Fix:**
     - (a) `clipTo`: `if (n <= 0) return ""; if (n === 1) return t ? "…" : "";`, with a test next to the existing `clipTo` tests.
     - (b) In `writeSlideField`, on an **image** slide where the raw limit is below `CLIP_FLOOR_CHARS` and the value would be cut, **refuse** with a local error (for example «Rasm yonida bu maydonga matn sig‘maydi — rasmni olib tashlang yoki maketni o‘zgartiring») instead of writing «Suv…». Today the rail 4-step image box (4 characters) silently turns a sentence into «Suv…».
   - **Guard tolerance of ≤ 1 character: not recommended.** A lone «…» in a 0-character box still overflows, and it would make the guard and the editor disagree. The editor should refuse instead.
   - **`raw` does not leak into generation:** its only use is `slide-edit.ts:122`. Neither `normalizeSlide`, `coerceLayout`, repair nor the prompt passes it.
2. **Blocking: agenda clipping breaks "agenda == plan titles" and trips P5's live gate.**
   - **The change:** INT-02 now clips agenda items at `min(bulletChars, clipLimit("agenda", …, n, NO_IMAGE))` (`slide-write.ts syncAgenda`).
   - **Probe:** titles are ≤ 72 characters, but the agenda box holds much less for schools:
     - school_1_4 / 5_7 with 5–6 items: 27–53 characters (split, story, editorial, dashboard);
     - `dashboard` school_1_4 with 3 items: 41.
     Adults (general, bachelor) are 72 everywhere.
   - **Consequence:** in school decks, agenda items become «…» cuts of the titles. `scripts/slide-audit.mts:233-237` compares `normTitle(agenda) !== normTitle(title)`, so it reports `plan-title-mismatch` for every clipped item, and its truncation rule (`TRUNCATED_RE`) counts them too. The live gate will fail on correct output. Decision 2's "agenda = sarlavha" also stops being literally true.
   - **Fix (two parts):**
     - (a) **Prompt:** give plan-slide titles a word maximum from the agenda box (`layoutWordTargets` → `agendaTitleMax`, one brief line «reja slaydi sarlavhasi ≤ N so‘z»), so clipping becomes rare;
     - (b) **P5's `slide-audit.mts`:** an agenda item that equals `clipTo(title, cap)`, i.e. a prefix of the title ending in «…», is a match and not a truncation.

     Assign (b) to the P5 owner. Record the contract nuance in `docs/AUDIT-25.md` decision 2.

## Should-fix

3. **The editor's prose fields are still not visual-aware.**
   - **What is covered:** `editLimits` covers only stats, steps, quiz and table (`slide-edit.ts:369-472`).
   - **What is not:** everything else still uses static or audience-only caps:
     - bullets and agenda: `rules.bulletChars` (`:198-201`);
     - column items: `SLIDE_LIMITS.colItem` 110 (`:369`, `:693`);
     - quote: `SLIDE_LIMITS.quote` 280 (`:350`, `:722`);
     - subtitles: `subtitleMax` (`:191`).
   - **Why it matters:** on a **no-image** slide, an edit can exceed the box that generation clips to and overflow. This is P8 CHANGE 1's bullets case, now fixed in generation but not in the editor. Examples: the 8–9 grade circle 4-item column holds about 60 characters but the editor allows 110; the agenda editor allows `bulletChars` where the box holds 27–53.
   - **Fix:** route these through `clipLimit(field, rules, visual, count, undefined, NO_IMAGE)` with the W7 never-shrink `editLimit`.
     - Keep **`NO_IMAGE` for prose fields even on image slides**, and leave image-slide overflow to P12's guard, which returns an explicit 400 message. This keeps every prose field on the same UX.
     - Today `stepText` on an image slide is silently cut to the raw with-image box (200 with «…»), while `colItem` gets P12's 400. Consider moving `stepText` to the same rule, keeping raw with-image clipping only for the label fields (stat label, cell, header, quiz option).

## Answers

1. **Module-init cycle and client safety.** Safe.
   - Every real entry imported first initializes correctly: `slide-limits`, `slide-layout`, `slide-quiz`, `slide-layout-extra`, `slide-edit`, `slide-quality`, `slides`, `visuals/index`, `slide-custom`.
   - At module level, `slide-limits` reads nothing from `slide-layout`, `slide-themes` or `visuals/spec` (`allVisuals`/`probeTheme` are lazy; `layerFits`/`probeLayers` read `LAYOUT_KIT` at call time). `slide-quiz`'s top-level `const clip = clipTo` binds a hoisted function declaration, which is safe in the TDZ. `slide-layout-extra` reads `QUIZ_LETTERS` and `LAYOUT_KIT` only inside functions.
   - The one failing entry is `visuals/circle` imported first («Cannot access 'circleVisual' before initialization»). That is the **pre-existing** `slide-layout ↔ visuals/*` cycle, not P11's, and no code imports a visual module directly.
   - `slide-layout` pulls nothing server-only. `client-bundle-guard`, `client-boundary` and `bundle-split` are green.
   - The viewer bundle already contains `slide-layout` (through `SlideCanvas`), so there is no new weight there.
2. **Rotation cost.**
   - `fitChars` is memoised in a module `Map` keyed by field | count | rows | visual | bodyPt | minPt | images.
   - Measured cold cost is **2–3 ms per rotated bullets key**, warm 0.01 ms. A full sweep of 480 agenda keys took 695 ms cold. `normalizeSlide` hits the cache after the first slide.
   - Minor: the key omits `agendaMax`, while the agenda probe uses `max(agendaMax, n)`. Calls with the same `n` but a different `agendaMax > n` could reuse a stale value. Add `agendaMax` to the key for `field === "agenda"`.
3. **`max(24, …)` floor vs the 5-word rule.** Consistent.
   - The prompt uses the with-image box if it holds ≥ 5 words for a prose field, otherwise the no-image box, always × 0.85. The writer always clips at the no-image box, so "prompt ≤ 0.85 × clip" holds.
   - The 24-character floor only matters when the no-image box itself is under 24 characters. Then the prompt asks for ≤ 0.85 × box and only an overshoot overflows. That is a layout problem, as P3 documented.
   - The floor must **not** apply on the editor's image path, which 9c20f85 does correctly, but see CHANGE 1 for the 0 case.
4. **Agenda images and `want`.** `imageYieldField` now checks `agenda`, and `plannedImageSlots` excludes yielded slides **before** `report.want`, which P8 left unchanged. So `got ≤ want` and there is no refund. The agenda text is clipped at the no-image agenda box; if it does not fit beside the image, the image yields.
5. **`syncAgenda` order.** `applyResearchRefs → syncAgenda(visual) → slideFloor → repair → syncAgenda(visual) → finalizeQuiz`. Clipping never changes the slide count, so the floor check is unaffected, and repair never touches titles. This is correct; the only problem is the contract issue in CHANGE 2.
6. **W7 invariants.**
   - `editLimit(audit, static, previousLength)` (never shrink) wraps every `editLimits` result.
   - `afterConvert` measures the post-convert image state.
   - The `slide-edit` suite, including the undo round trip, is green (111 with `slide-plan`).
   - `9c20f85`'s rail test pins raw ≤ the guard and has a named mutation.
7. **P12 interaction (branch `worktree-agent-a45f8181…`, `tests/slide-image-edit.test.mts`).**
   - **No P12 test flips.** Every text-edit test there edits twoCol `left`/`right` (`colItem`, still static 110 in the editor), or uses `set`/`insert`/`image`/`imageRestore`, which are not clipped. `LONG_ITEM` (≈ 100 characters) therefore still reaches the guard and gets 400.
   - **P11 produces no 422s.** `writeSlideField` clips; it does not fail.
   - **The real divergence:** with `9c20f85`, step, stat, table and quiz edits on image slides are clipped to the raw with-image box by the editor, so the guard never sees them. The user gets 200 with «…», where `colItem` gets 400 with a message. The exception is the 0-character box, which gets 400 because of the `clipTo` bug in CHANGE 1.
   - **If CHANGE 3 is done with `"both"` for `colItem` instead of `NO_IMAGE`,** these P12 tests would flip to 200:
     - INT-03 (1), (1b), (5d) and (6b);
     - the monotone "uzaytirish — 400" commit case.
   - **Merge note:** P12 rewrites `imageYieldField` as `imageOverflowChars` in `slide-quality.ts`. That merge must keep P11's `agenda` check and import `fitChars` from `slide-limits.ts`. `edit-adapters.ts yieldText` already includes `s.bullets`, so agenda edits are covered.

## Non-blocking

- **N1.** When the visual is known, the cap is now exactly the model capacity (`fitChars`), with no × 0.88. That is acceptable because bold width is now modelled (`CHAR_EM_BOLD`) and the prompt keeps its 15 % headroom. Keep an eye on LibreOffice PDF parity in the next live run.
- **N2.** `clipTo("Salom dunyo bu test", 10)` gives «Salom dun…», because the 60 % boundary rule allows a mid-word cut for short limits. This is P3's documented behaviour and matters only below about 20 characters, which the editor's raw path can now reach. Covered by CHANGE 1(b).
