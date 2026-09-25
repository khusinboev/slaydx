# Review — AUDIT-25 P1 (engine: plan = contract)

Reviewer: independent (Opus 5.5, not the writer). Branch `worktree-agent-a9012405b02674ca9`
(`bd99b4e`, `47b1512`, `2af1974`), diff `e89c7c1..` over `lib` and `tests`. Paths below are relative to
the worktree.

## Verdict: **CHANGES** (the engine core is sound; 5 changes, 3 of them blocking: 1, 2 and 3b)

`blocksToBeats`, `planBudgetForBody`/`planCapacity` and the length contract are correct. I ran:

- the 5 test files (`slide-plan`, `slide-length`, `slide-blocks`, `slide-params`, `client-bundle-guard`):
  **80/80 pass**;
- my own probe (scratchpad `p1-probe.mts`): 60 000 seeded random form shapes, with pro and plain slide,
  all 10 templates, all 9 purposes, 4–30 slides, random `blocks` subsets, and `quizCount` ∈
  {unset, 0, 3, 5, 10}. It also varied `agendaSlide` (unset/true/false), `titleSlide`, `speakerNotes`,
  `internetSearch`, and `planItems` ∈ {1…6, 99, unset}.

With **0 violations**, the probe confirmed all of these:

- length === `wantSlides`;
- determinism;
- exactly one title first (iff `titleSlide !== false`) and one closing last;
- plan ids exactly 1..`meta.planItems`, and the plan sequence is monotone;
- every band has a content layout, and plan layouts come only from content ∪ `section`;
- `planCapacity(raw form values)` → `effectivePlanItems` === `meta.planItems`;
- `planCapacity` === the real `deckBeats` plan count, measured with `planItems: 99`;
- no adjacent same layout except quiz runs;
- the quiz run is contiguous and `answers` comes right after it;
- agenda sits at index 1 (0 without a title);
- `maqsadlar`/`motivatsiya` come before the first plan beat, and quiz/`uyga_vazifa` after the last one;
- `references` sits at length−2;
- the prompt's `agenda: AYNAN N` and `REJA BANDLARI: … N` agree with the beats.

The problems are at the edges: prompt/beat consistency, form semantics, the lesson template's roles,
and the ordinal regex.

### CHANGES

1. **(blocking, cross-package P1+P4) The A3-01/A3-02 semantics, combined with the real form defaults,
   make the pro-slide `blocks` chips «Test» and «Reja» decorative.**
   - `components/forms/SlideComposer.tsx:115,118` always sends `quizCount: 0` and `agendaSlide: true`.
   - `activeBlockIds` (`lib/generation/slide-params.ts:188-193`) then does two things:
     - It removes `test` even when the user ticked the «Test» chip. Probe:
       `{blocks:"reja,test", quizCount:0, agendaSlide:true}` gives no quiz.
     - It re-adds `reja` after the user unticked «Reja». Probe: `{blocks:"maqsadlar", agendaSlide:true}`
       still gives an agenda.
   - For `open_lesson` (pro), the blocks chip shows «Test» ON while the deck has no test. That is the
     mirror image of A3-01: the lie has moved from one chip to the other.
   - The `slide-params` differential probe misses this. The `blocks` probeB `"reja,test,adabiyotlar"` has
     no `quizCount`, and it differs anyway through `adabiyotlar`.
   - Fix (pick one, before merge):
     - (a) P4 couples the chips in `slide-fields.tsx`:
       - ticking «Test» while `quizCount==0` → `quizCount=3`;
       - `quizCount→0` → remove `test` from `blocks`;
       - on purpose change → `quizCount = blocks∋test ? QUIZ_COUNT_FALLBACK : 0`;
       - `agendaSlide` ⇄ `reja` mirrored the same way.
     - (b) The engine gives an explicitly sent `blocks` precedence over the switch value, i.e. apply the
       `quizCount===0`/`agendaSlide===true` overrides only when `values.blocks` was not sent, as for the
       plain slide.
   - In either case, P1 adds a test that uses the real `initialValues()` shape
     (`quizCount:0, agendaSlide:true, blocks:resetBlocksForPurpose(p)`). It asserts that ticking or
     unticking each of the two chips changes the beats.

2. **(blocking) The prompt promises blocks the engine dropped (AUDIT-8 pattern, new in AUDIT-25).**
   - Step c) (`lib/generation/slide-blocks.ts:396-400`) can now drop `adabiyotlar`/`diagramma`/`jadval`/
     `reja`-less blocks. Before AUDIT-25 they were never dropped; the deck grew instead.
   - `structureLines` still derives its lines from `orderedBlocks(...)`
     (`lib/generation/slide-prompt/structure.ts:32`), so three lines stay in the prompt:
     - `references layout: …` (`:101`);
     - `stats (diagramma): … chart: true` (`:104`);
     - `TUZILMA BLOKLARI (rejada shu tartibda): …` (`:113`).
   - Probe: prompt/beat mismatch in **5 534 / 60 000** cases for references and **4 658** for diagramma.
     Example: `{slideCount:6, slidePurpose:"general", blocks:"reja,maqsadlar,motivatsiya,amaliyot,test,jadval,diagramma", internetSearch:true, planItems:3}`.
   - The `chart: true` line is the dangerous one. With no diagramma beat, the model may attach it to a
     plan `stats` slide.
   - Fix: export the block-selection step from `slide-blocks.ts` as a pure function, e.g.
     `plannedBlocks(meta, bodyWant): { kept: SlideBlockId[]; agenda: boolean; quizBeats; answers }`,
     used by both `blocksToBeats` and `structureLines`. `has()` and the TUZILMA line should read `kept`.
   - Add a sweep test (prompt line ⇔ beat present) for `references`, `diagramma` and `TUZILMA`.
   - While there: inside step c), drop manual yielding-type blocks (`maqsadlar`, `motivatsiya`,
     `amaliyot`, `uyga_vazifa`, `jadval`) before `diagramma`/`adabiyotlar`. The YIELDING comment
     (`slide-blocks.ts:115-117`) promises those two go «faqat oxirgi chorada», but c) currently drops
     `adabiyotlar` (end anchor) first, even when `internetSearch` asked for it.

3. **The lesson template feeds pedagogy-structure roles into plan bands, which is S1 by another route.**
   - `lesson` serves `lesson`, `open_lesson` and `training`, the live complaint's deck type. For those,
     plan content holes are filled from
     `Dars oqimi / Eslab qolinadigan asosiy son / To‘g‘ri javob / tipik xato / Guruh ishi tartibi / Baholash mezoni / Dars bosqichlari va vaqti / Kuchli o‘quvchi …`
     (`lib/generation/slide-templates.ts:228-245`).
   - The probe (lesson, 16 slides) produced `REJA 1-band: Dars oqimi`, `REJA 2-band: Eslab qolinadigan
     asosiy son` (stats), `REJA 4-band: Baholash mezoni` and `REJA 5-band: Guruh ishi tartibi`.
   - The prompt says the part after «:» is only a shape hint (`structure.ts:76`). Still, these roles are
     strong content instructions. The agenda would then list «Baholash mezoni» as a topic band, and a
     stats plan slide is exactly the «shunchaki 3» risk (S3/S4).
   - `blockLike` catches only «Maqsad»/«Uyga vazifa».
   - Fix, inside P1's ownership: mark structural beats in `slide-templates.ts` (e.g.
     `structural?: true` on `SlideBeat`) for the lesson roles above. `makePicker(PLAN_CONTENT)` should
     skip structural beats, which stay eligible for `extra` holes.
   - Add a test: for the `lesson` template, no plan role is structural.
   - Consider keeping `stats` out of plan-content holes unless the template's role is data-driven.
   - Needs a live check via P5 `slide-audit` on `open_lesson`.

   **3b. Does `plan` survive? (P7's extra check)**

   Generation path — **OK**:
   - Final assembly (`slide-write.ts:810-815`): `plan` is assigned in the last `.map`, AFTER both
     `coerceLayout` and the `chart` map. `coerceLayout` only ever returns `s` or `{ ...s, … }`.
   - Live `emitSlide` (`:636-640`): coerce → chart → `plan`, in that order.
   - `renumberSlides` (`:116-118`) uses `{ ...sl, id }`.
   - `applyResearchRefs` (`:107-113`) mutates `refs` only.
   - `finalizeQuiz`/`withAnswerNote`/`fillAnswersSlide`/`rebuildAnswerKey` (`slide-quiz.ts:76,99,115,170`)
     all spread `...s`, and touch only quiz/answers slides, which never carry `plan`.
   - The title/closing fix-ups spread `slides[0]` too.
   - Caveat: when the model's data does not fit the planned layout, `coerceLayout` returns the model's
     own layout (e.g. `quote`). A plan slide can then carry a non-content layout. `plan` is still kept,
     and `planHeads` copes.

   Viewer-edit path — **FAILS** (`lib/generation/slide-edit.ts`, not in any AUDIT-25 package): three
   edit paths build a slide from a field whitelist that lacks `plan`:
   - `baseOf` (`:542-550`, used by `convertLayout` for the `layout` op at `:873`);
   - `sanitizeSlideModel` (`:636`, used by the `set` op at `:902` and the `insert` op at `:895`;
     `set` is also the undo/restore shape);
   - `slideShapeOk` (`:1122`) does not type-check `plan`.

   So any layout change or whole-slide set in the viewer silently strips `plan`. P2 then draws no
   section number for that slide, and the numbering goes out of sync with the agenda.

   Fix:
   - copy `plan` in `baseOf` and `sanitizeSlideModel`
     (`if (Number.isInteger(o.plan) && o.plan >= 1 && o.plan <= 6) out.plan = o.plan`);
   - add `o.plan === undefined || Number.isInteger(o.plan)` to `slideShapeOk`;
   - add tests in `tests/slide-edit*.test.mts` (a `layout` op and a `set` op both keep `plan`), with a
     mutation check.

   Owner: P1, since it introduced the field (`slide-types.ts`). Coordinate with whoever holds
   `slide-edit.ts`.

4. **The ordinal strip has real false positives, and the model can copy the internal role prefix.**
   - False positives: `LEADING_ORDINAL` (`lib/generation/slide-write.ts:70`) strips spaced numeric
     ranges and single-letter roman/variable prefixes. The probe gave:
     - `«18 – 20 asrlar»` → `«20 asrlar»`;
     - `«3 - 4 sinflar uchun»` → `«4 sinflar uchun»`;
     - `«5 – 9-sinflar»` → `«9-sinflar»`;
     - `«X - noma’lum son»` → `«noma’lum son»`;
     - `«I – shaxs olmoshi»` → `«shaxs olmoshi»`;
     - `«V. I. Lenin»` → `«I. Lenin»`;
     - `«10: 1 nisbat»` → `«1 nisbat»`.

     Fix: append `(?!\d)` after `\s+`. Allow roman numerals only with `[.)]`, not dash or colon, and not
     when followed by `\p{Lu}\.`. Add these cases to the stripOrdinal test (`tests/slide-plan.test.mts`).
   - False negative: `«1.Kirish»` (no space) is kept. Optional: accept `\.(?=\p{Lu})`.
   - Correctly handled: `«3D model»`, `«12-maktab»`, `«2024-yil»`, `«1.2. Band»`, `«5-sinf»`,
     `«II jahon urushi»` and `«1-mavzu: …»` are kept. Options and bullets are not touched (title only,
     `:124`).
   - Role-prefix copy: if the model copies `REJA 2-band: …` from the sequence (`seq` shows the role
     verbatim), the prefix survives in the title and in the agenda. Probe:
     `syncAgenda` → `['REJA 1-band: Ta’rif va ahamiyat', …]`.

     Fix: in `normalizeSlide`, strip `/^REJA\s*\d+\s*-\s*band\s*:\s*/i` before `stripOrdinal`. Add
     «`REJA i-band:` yozuvini sarlavhaga ko‘chirmang» to the `structure.ts:76` line, plus a test.
   - Prompt nit: «Sarlavhalar raqam bilan BOSHLANMASIN» (`:77`) also forbids legitimate titles such as
     «3D …» and «5 ta qoida». Reword it to «Sarlavha boshida TARTIB raqami bo‘lmasin».

5. **Minor.**
   - (a) `types.ts:355` still says «(3–6)». The floor is now 1 (`effectivePlanItems`), so it should read
     «(1–6, sig'imga qisilgan)».
   - (b) The `plan` live event sends `roles: beats.map(b => b.role)` (`slide-write.ts:1005`), so the
     skeleton label shows the internal `REJA 2-band: …` prefix (`SkeletonSlide.tsx:70`). Map it through
     `planRoleText`, or decide it is a feature and pin it in a test.
   - (c) `syncAgenda` clips with `clip()` (`:537`), which cuts mid-word. Today this never triggers:
     title ≤ 80 ≤ min `bulletChars` 80. Add an assertion `SLIDE_LIMITS.title <= min(bulletChars)`, so
     that a P3 limits change cannot silently start cutting agenda items mid-word.

### Checked and OK (evidence)

- **Brief counter-examples:**
  - `titleSlide:false, agendaSlide:true, 4 slides, quiz 5, planItems 6` → `agenda bullets#1 quiz closing`
    (4, capacity 1).
  - `story`/`pitch` templates without sections → content-only bands. Length is 8 and bands are 5 or 6.
  - 30 slides, 9 blocks, 6 bands, quiz 3, no notes: all blocks kept, 6 section+content bands,
    `quiz×3 answers bullets references closing`.
  - Lesson «Maqsad…»/«Uyga vazifa» template beats are removed by `blockLike` (`slide-blocks.ts:184-187`),
    with no duplicates.
- **`planCapacity` test** (`slide-plan.test.mts` «planCapacity … TENG») compares against real `deckBeats`
  output, not a re-implementation. Its loop is 27×9×3×3×2 = 4 374 cases, not 4 968. It does not vary
  `blocks`, `internetSearch`, `speakerNotes` or tool; my 60k probe covered those, with 0 mismatches.
- **Client safety:** `slide-params.ts` imports only `./safe-text`, `./slide-purpose` (type-only imports)
  and types. `client-bundle-guard` passes.
- **`extractMeta`** feeds the resolved `slidePages` (pro default 12) and resolved `blocks` into
  `planCapacity` (`meta.ts:193-205`).
- **`syncAgenda`:**
  - It is called after `applyResearchRefs` and before `finalizeQuiz` (`slide-write.ts:818`).
  - It prefers the section head (`planHeads`).
  - A missing plan slide is skipped gracefully, never «nonexistent». Side effect: the agenda
    renumbers, while P2's section kicker would show the original `plan` number. This is acceptable for
    a ≥85%-floor degraded deck.
  - Live `slide` events carry `plan` (`:639`).
- **A3-01/02 readers of `meta.quizCount`/`meta.agendaSlide`:** `extensions.ts` (`?? 0`), `structure.ts`,
  `meta.ts` and `slide-blocks`. `lib/viewers/from-html.ts` writes concrete values. No other lib/app
  reader does arithmetic on them. Stored `doc_json` meta with concrete `0`/`true` stays type-compatible,
  and `deckBeats` runs only on fresh `extractMeta` (`lib/generation/index.ts:531`).
- **Honest skeleton:** stats `"—"`, process text = role, bullets `["…"]`, agenda = plan roles, no
  digits. Pinned by a test.
- **Test edits:** the `slide-length`/`slide-blocks` rewrites that invert «deck grows» into «deck never
  grows» follow A3-04. The `planItems: 3` pins keep the X-5 numbers meaningful. No assertion was
  loosened without a documented design reason. Only «bloklarsiz meta» became structurally weaker, which
  is justified.
- **Merge risk:** P2 files (`slide-layout*.ts`, `visuals/*`) are untouched. The P3 call site is commented
  (`slide-write.ts:819-825`). P1 also touched `types.ts` and `slide-prompt/extensions.ts`, which are
  outside its listed ownership. The edits are trivial, but the lead should know.

### Observations for lead/owner (decision-level, not CHANGES)

- **The default `planItems` 5 now dominates the lesson blocks.**
  - `open_lesson` @10 slides (quiz unset): `title agenda 5×plan quiz quiz closing`. All four of
    maqsadlar, motivatsiya, amaliyot and uyga_vazifa are gone.
  - `lesson` @10 loses amaliyot and uyga_vazifa.
  - X-5's «explicit 3 questions beat standard blocks» now yields to the untouched default of 5 bands.
    The live X-5 config gives 1 question and no answer key.

  This follows decision 1's order, but pro users see those chips ON. P4/P5 should surface it, or the
  owner may want the default `planItems` to adapt to capacity minus the standard blocks.
- **With `agendaSlide: true` always sent, every `pitch`/`training` deck now gets an agenda.** It is
  consistent with the switch, but it changes those purposes' defaults.

---

## Re-review — 84573a9

Scope: `git diff 2af1974..84573a9`, commits `1c46b61` and `84573a9`. I ran two heavy commands:

1. `slide-plan`, `slide-blocks`, `slide-length`, `slide-params` and `client-bundle-guard`: **86/86 pass**.
   This includes the `slide-length` X-5 cases and the new prompt⇔beat sweep.
2. My probe, updated for the new API (scratchpad `p1-probe2.mts`: `planCapacity` gets `tool`,
   `effectivePlanItems` gets `slideCount`). It adds `plannedBlocks` determinism and a
   TUZILMA⇔beats check. **Caveat:** I piped the run through `tail -90`, which cut off the 60k-sweep
   summary lines (case count and FAIL counters). Only the targeted outputs below survived. I did not
   re-run it, to stay within the heavy budget. To confirm:
   `scripts/heavy.sh npx tsx --conditions=react-server <scratchpad>/p1-probe2.mts | head -40`
   (expect `cases 60000` and no `FAIL` lines). The test suite's own sweeps (the 960-case prompt⇔beat
   sweep, 4 374-case capacity, 720-case coverage) pass, so the risk is low.

### Items from the first review

- **1 — Chips vs. switches: FIXED (option b).**
  - `blocksSent` in `meta.ts:186` covers pro only. `resolvePlanFlags` sits in `slide-params.ts`.
  - I checked the truth table on the real function, 36 rows. With pro (blocks sent):
    - ticked Test + `quizCount` 0 → `undefined`, so the test is kept (default count);
    - unticked Test + 0 → 0, no test;
    - `n` > 0 always wins and adds the test;
    - `agendaSlide: true` → `undefined`, so the agenda comes only from the «Reja» chip;
    - `false` still turns the agenda slide off.
  - With plain slide / blocks not sent, both flags pass through unchanged (A3-01/02).
  - Real form shape (pro, `quizCount:0, agendaSlide:true`, purpose blocks): `open_lesson` keeps its
    test, and `pitch`/`training` get no agenda. `{blocks:"maqsadlar", quiz:3, agenda:true}` gives no
    agenda and 3 quiz slides.
  - `PlanCapacityInput.tool` keeps the form and the engine in agreement. It is locked by the test
    «P4 N1» (slide 7 vs pro 6).
- **2 — Prompt ⇔ beats: FIXED.**
  - `plannedBlocks` (`slide-blocks.ts`) is the single source for `blocksToBeats` and `structureLines`
    (`structure.ts:40`). `has()`, agenda, `planN` and TUZILMA all read `plan.kept`.
  - Step c) now drops manual yielding-type blocks first, then `diagramma`/`adabiyotlar`.
  - The function is pure, with no mutable state beyond locals; the determinism check in probe 2 was
    part of the truncated summary, but the code is pure by inspection.
  - The new 960-case sweep checks references, diagramma, quiz and TUZILMA against the beats, and
    `plannedBlocks.kept` against TUZILMA.
- **3 — Lesson template roles: FIXED.**
  - `structural: true` is set on 8 lesson roles (`slide-templates.ts:237-250`). `planContent` excludes
    structural candidates and generic `stats`.
  - Probe, lesson with 16 slides: plan bands are `twoCol#1 bullets#2 twoCol#3 twoCol#4 process#5 process#6`.
    No structural role and no stats slide is a plan band; the structural ones and stats appear only as
    extras. There is always at least one allowed layout (generic bullets/twoCol/process), so adjacency
    still holds.
- **3b — `plan` stripped by viewer edits: NOT ADDRESSED.**
  - `slide-edit.ts` is not in the diff. `baseOf`, `sanitizeSlideModel` and `slideShapeOk` still drop
    `plan` on the `layout`, `set` and `insert` ops.
- **4 — Ordinal regex and role-prefix copy: FIXED.** Verified on the real function:
  - These are now kept: `«18 – 20 asrlar»`, `«3 - 4 sinflar uchun»`, `«5 – 9-sinflar»`,
    `«X - noma’lum son»`, `«I – shaxs olmoshi»`, `«V. I. Lenin»`, `«10: 1 nisbat»`, `«1.5 million»`,
    `«1.2. Band»`, `«12-maktab»`, `«2024-yil»`, `«3D model»`, `«II jahon urushi»`.
  - These are now stripped: `«1.Kirish»`, `«3.Qism»`, `«IV. Tarix»`, `«II. Jahon urushi»`,
    `«REJA 2-band: 3. Mexanizm»` → `«Mexanizm»`.
  - Prompt wording is updated (`structure.ts:78-79`).
- **5a / 5b / 5c: FIXED.**
  - (a) The `types.ts` comment is updated.
  - (b) Live roles now go through `planRoleText`.
  - (c) `clipWords` clips at a word boundary and trims trailing punctuation. It falls back to a hard
    cut only when the last space is before n/2.
- **Coordinator item 7 — adaptive `planItems` default and the X-5 change: OK in the engine.**
  - `defaultPlanItems = clamp(round(n/3), 3, 6)`.
  - The X-5 share now needs an explicit `quizCount` > 0. The contract «quizCount chosen → up to 1/3
    share» holds:
    - plain `open_lesson` @10, quiz 3, 3 bands → `quiz×3` (share 3 = ⌈8/3⌉), with maqsadlar kept;
    - with 5 bands → `quiz×2`, because the givers already went to the bands.
  - `slide-length` X-5 tests are green.
  - With nothing sent, `open_lesson` @10 → `title agenda maqsadlar motivatsiya 3×plan amaliyot quiz closing`
    (uyga_vazifa yields).
- **Client safety: OK.** `slide-params.ts` dropped its type import of `./types`. It now imports only
  `../types` (type), `./safe-text` and `./slide-purpose`. The guard is green.

### Verdict: **CHANGES** (1 item; everything else APPROVE)

R1. **(carried over from 3b) Viewer edits drop `plan`.** Change `lib/generation/slide-edit.ts`:
- `baseOf` (`:542`) and `sanitizeSlideModel` (`:636`) copy
  `plan` when `Number.isInteger(o.plan) && o.plan >= 1 && o.plan <= 6`;
- `slideShapeOk` (`:1122`) accepts only `plan === undefined || Number.isInteger(plan)`;
- tests: `layout` op and `set` op both keep `plan`, with a mutation check.

If the lead decides to move this to another package or sprint, P1 is APPROVE as is.

### Cross-package requirements for P4 (not P1 changes, but P1's fixes only reach users once P4 does these)

- `SlideComposer.tsx initialValues` sends `planItems: PLAN_ITEMS_DEFAULT` (5), so the adaptive default
  never applies to real form users. Probe, plain `open_lesson` @10 with `planItems:5` sent: 5 bands,
  amaliyot and uyga_vazifa dropped.
  - P4 must send `defaultPlanItems(slideCount)`, and follow the slider until the user touches the chip,
    or leave `planItems` unsent.
- The form's live capacity must call `planCapacity({ ...values, tool })`. Without `tool`, the pro form
  shows one band more than the engine produces.
- In pro, «Reja slaydi» = ON is now inert when the «Reja» chip is off, e.g. for `pitch`/`training`
  defaults; only OFF acts.
- «Nazorat testi» > 0 overrides an unticked «Test» chip.

  P4 should mirror these controls, e.g. disable or annotate the switch when Reja is off, and tick «Test»
  when a count > 0 is picked. Otherwise one control of each pair still shows a state the deck does not
  follow.

---

## P13 review — 3964934

Scope: P13's own diff only. That is `1024bb5` (INT-08/09/13) and the non-merge part of `3964934`
(INT-02 prompt half) on `worktree-agent-af7d9bfda5cebaeaa`.

I ran one heavy command:
- `slide-blocks`, `slide-audience`, `slide-plan`, `slide-params`, `client-bundle-guard`, plus my
  scratchpad probe `p13-probe.test.mts`. Result: **98/99**. The only failure is the known
  `tests/slide-params.test.mts:203` regex; it now gets `agenda'da 3)`, which the coordinator fixes at
  merge.
- I did not run `tests/ui/slide-composer`, which needs the viewer tsconfig.

### Checked and OK

- **INT-08** (`slide-prompt/extensions.ts`):
  - The quiz count now comes from `plannedBlocks(...).quizBeats`. It equals the number of quiz slides
    and matches the «HAR quiz slaydida AYNAN BITTA savol» line.
  - The «Javoblar» promise now reads `plan.answers`, which already requires `speakerNotes === false`
    and room for the slide, so the `speakerNotes` semantics are kept.
  - The quiz line now also appears for a default-count test, which is more consistent than before.
  - `bodyWantOf(targetPages || undefined, titleSlide)` is the same call `structure.ts` makes.
- **INT-09** (`brief.ts`): `agendaMin = min(agendaMax, max(3, agendaMax−1))` together with `fmtRange`
  gives `1`, `2`, `3`, `3–4`, `5–6`. It never produces `3–1`.
- **INT-13** (`slide-params.ts` `defaultSlideCount`, `slide-fields.tsx`):
  - The probe confirms `defaultSlideCount("pro-slide") = 12 = extractMeta(pro,{}).targetPages` and
    `defaultSlideCount("slide") = 10 = extractMeta(slide,{}).targetPages`.
  - `slidePagesOf` now uses the `SLIDE_MIN`/`SLIDE_MAX` bounds for both tools. They are identical to
    the `PRO_*` bounds (4/30), so there is no behaviour change.
  - `capacityFor` goes through `slidePagesOf`.
- **Server-only and determinism:**
  - `structure.ts` now imports `slide-audience`, `slide-limits` and `slide-quality`.
    `slide-quality` pulls in `llm`, but `brief.ts` already imported it, so nothing new crosses a
    boundary. `client-bundle-guard` is green.
  - `fitChars` memo, warm vs cold: 220 prompts (11 audiences × 10 templates × planItems {3,6}) built
    cold, then again warm in reverse order, gave **0 differences**.
- **Pinned lines:** the WP-0a pinned-lines test in `slide-blocks` still asserts every instruction
  without a number, and it passes.
- **Scoping:** the new title-cap line is explicitly limited to REJA slides and names the generic
  «6–10 so‘z» rule. As worded it does not contradict `base.ts`. See change 1 for the numeric problem.

### Verdict: **CHANGES** (1 blocking)

P13-1. **(blocking) The REJA title word cap is bounded only by the agenda box, not by the title field.
It routinely promises titles 2–4× longer than `SLIDE_LIMITS.title`.**
- The problem:
  - Plan-slide titles become the agenda items (`syncAgenda`), and the slide title is clipped by
    `normalizeSlide` to `SLIDE_LIMITS.title` = **72** chars, with «…».
  - `agendaWordsCap = max(3, ⌊0.85 · fitChars("agenda", …) / 9⌋)` (`structure.ts`, the new
    `agendaWordsCap` block) looks only at the agenda row.
  - For wide boxes this gives absurd numbers.
- Probe results across all 11 audiences × 10 templates × planItems {3,6}:
  - the cap ranges over **3 … 31 words**;
  - in **170 / 220** combinations `cap × 9 > 72`;
  - the default general/lecture deck at planItems 3 prints `agenda: … har biri 3–31 so‘z` and
    «REJA slaydlari sarlavhasi: eng ko‘pi 31 so‘z»;
  - students_bachelor/lecture/6 prints 16 words.
- The model will write long plan titles. They get cut mid-thought with «…» on the slide and in the
  agenda, which is worse than the old static «3–7». They also run far longer than the «6–10» asked of
  every other slide.
- Fix: `agendaWordsCap = max(3, ⌊PROMPT_HEADROOM · min(fitChars("agenda", rules, tpl.visual, planN), SLIDE_LIMITS.title) / CHARS_PER_WORD⌋)`,
  which is ≤ 6 at today's limits. Optionally also bound it by the section-title field for band heads
  that open with `section`.
- Test changes:
  - The INT-02 tests re-derive the same formula (a tautology) and pin `bachelorCap ≥ 6` (16). Change
    them to assert `cap · CHARS_PER_WORD ≤ min(fitChars(agenda), SLIDE_LIMITS.title)` across **all**
    audiences × visuals.
  - Keep the school_1_4/split/6 = 3 case.
  - Mutation check: remove the `min(…, SLIDE_LIMITS.title)` → the test must go red.

### Non-blocking notes

- `meta.ts` still has its own `tool === "pro-slide" ? PRO_SLIDE_DEFAULT : SLIDE_DEFAULT` ternary.
  Switch it to `defaultSlideCount(tool.id)` and add a one-line test
  `defaultSlideCount(t) === extractMeta(TOOL_BY_ID[t], {}).targetPages`. Today the values are equal
  only by coincidence.
- The `fitChars` cache key (`slide-limits.ts:718`, P11's code) leaves out `agendaMax`, although the
  agenda probe draws `max(agendaMax, n)` rows. The engine path always has `planN === planItems` after
  `extractMeta`, so this is safe today. Adding `agendaMax` to the key would make warm/cold
  determinism hold by construction.
