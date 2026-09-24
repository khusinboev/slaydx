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
