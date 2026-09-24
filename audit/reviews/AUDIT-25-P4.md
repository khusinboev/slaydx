# AUDIT-25 P4 review — forma: «Reja bandlari» sig'im ko'rsatkichi

Reviewer: independent (read-only). Branch `worktree-agent-a7734c4329ed9f071`, commit `c9e4323`
(base `e89c7c1`). Diff: `components/forms/plan-capacity-stub.ts` (new), `components/forms/slide-fields.tsx`,
`tests/ui/slide-composer.test.mts`. `SlideComposer.tsx` / `ProSlideForm.tsx` / `SlideForm.tsx` untouched.
Compared against `docs/AUDIT-25.md` decisions 1/3, `docs/audit-25/A3-structure.md` (A3-01/02/04/06 + capacity
table), CLAUDE.md «Formalar (AUDIT-12/24)», `docs/research/forms3-etalon.md` §5, and P1's uncommitted
`planCapacity`/`planBudget`/`extractMeta` in worktree `agent-a9012405b02674ca9` (WIP, may still change).

## Verdict: CHANGES

The UI works as intended for the default case, but the form's effective value does not match what the server
writes when the stored value is 1 or 2 (items 1 and 2). One test mutation also survives (item 3). The stub
formula differs from the real engine in several places (see §3), and the planned import swap fixes all of
those. The swap is required: the stub must never ship on `slides-3`.

## CHANGES

1. **Form and server disagree on the effective `planItems` below 3.**
   - The form uses `clampInt(values.planItems, 1, …)` at `components/forms/slide-fields.tsx:163` and `:180`.
   - P1's `extractMeta` uses `Math.min(clampInt(values.planItems, PLAN_ITEMS_MIN /*3*/, 6, 5), planCapacity(…))`.
   - (a) When capacity is 2, clicking «1» shows «1» checked and the chip reads «1 band». The server writes 2,
     so option «1» is decorative, which breaks the "every param must work" rule.
   - (b) Suppose the user picks 1 or 2 on a 4-slide deck and then raises `slideCount` so capacity is at least 3.
     `lo` becomes 3 (`:177`), so no radio is `aria-checked`. The chip still says «1 band», but the server
     writes 3.
   - Fix: add ONE exported helper in `lib/generation/slide-params.ts`, e.g.
     `effectivePlanItems(raw: unknown, capacity: number): number`. Both `meta.ts` and `slide-fields.tsx`
     (`effectivePlanItems`, `PlanItemsField`) must call it.
   - Decision 3 says «`[1, capacity]`». Agree with P1 whether the floor is 1 (then 1–2 are real choices) or 3
     (then for `n < PLAN_ITEMS_MIN` render only `n === capacity`).
   - In `PlanItemsField`, compute `lo = Math.min(PLAN_ITEMS_MIN, capacity, effective)` so the effective value
     is always one of the rendered radios.
   - Add a test: slider at 4, click «1», slider at 30. Assert exactly one radio is `aria-checked="true"`, and
     that its label equals the chip number.
2. **The stub must not land on its own, and the tooltip must not ship before P1.**
   - `components/forms/plan-capacity-stub.ts` (whole file) and `slide-fields.tsx:39` must be swapped for
     `import { planCapacity } from "@/lib/generation/slide-params"` in the same merge as P1.
   - The new tooltip «har biri o'z slaydi bilan» (`:187`) is only true once P1's plan beats exist. Deploying
     P4 before P1 would repeat the A3-06 over-promise.
   - Delete the stub's private `clampInt`/`decodeBlockIds` together with the file.
3. **Test gap: an off-by-one on the disabled boundary is not caught.**
   - Mutating `n > capacity` to `n >= capacity` (`slide-fields.tsx:192`) disables the ONLY valid option. At
     capacity 1, «1» is disabled yet stays `aria-checked`, because `effective` is still 1.
   - Test 1 (`tests/ui/slide-composer.test.mts:151`) only checks `aria-checked` on «1». Test 2's click on «1»
     (`:188`) is a no-op on a disabled button, and the test still passes.
   - Fix:
     - At capacity 1, assert «1» has `aria-disabled="false"`.
     - Add one boundary case where capacity is exactly 4 or 5. Assert «capacity» is enabled and «capacity+1»
       is disabled.
     - Replace the no-op click at `:188` with a click that changes state.
4. **Test gap: the native-disabled click assertion is masked by the clamp.**
   - At `:185–186`, removing `disabled={disabled}` (while keeping `aria-disabled`) still passes: clicking «4»
     sets `planItems=4`, and `min(4, 1)` = 1, so the chip still says «1 band».
   - Only test 1's `.disabled` check catches that mutation.
   - Fix: after the click, also assert the stored value did not change. Once the slider goes back to 30, «5»
     (not «4») must be `aria-checked`.
5. **Test gap: `capacityFor` wiring is untested.**
   - Nothing fails if `quizCount`, `blocks`, `titleSlide` or `agendaSlide` is dropped from the object passed at
     `slide-fields.tsx:147–157`. All four tests change only `slideCount`, and only for `mount("slide")`.
   - After the swap, add one wiring test (see §5). For example: 10 slides with `agendaSlide` off gives capacity
     8 in the tooltip, and turning on «Nazorat testi» lowers it by 1.
   - Add one `mount("pro-slide")` smoke check: the default 12 slides give «12 slaydga 9 band» with real P1.
6. **Hand-rolled duplicate of `Segmented` (etalon §5 rule 25).**
   - `PlanItemsField` copies the whole `Segmented` markup and class string (`slide-fields.tsx:190–215`).
   - Preferred fix: add `disabled?: boolean` to `FieldOption` and support it in `Segmented`
     (`components/forms/compact.tsx:68`), then use it here.
   - `compact.tsx` is outside P4's file list, so the orchestrator has to allow it. Otherwise record it as
     follow-up debt in the AUDIT-25 execution log («Bajarilish yozuvi»).
7. **Small UI and text fixes (non-blocking, do together).**
   - The tooltip shows raw capacity, e.g. «10 slaydga 7 band sig'adi», but the maximum option is 6.
     Show `Math.min(capacity, PLAN_ITEMS_MAX)` or reword as «…7 tagacha band sig'adi».
   - The inline hint (`:217–221`) repeats the tooltip and does not say the choice was reduced. Suggested text:
     «Tanlangan 5 band sig'maydi — 1 band yoziladi».
   - Etalon rule 3 allows only a tooltip, no extra paragraph. A conditional status line is acceptable here,
     but keep it to one line.
   - Clamp the `slideCount` shown in the hint the same way the capacity does: use
     `clampInt(values.slideCount, SLIDE_MIN, SLIDE_MAX, …)` instead of `1, 999` (`:182`).
   - The pro-slide fallback should be `PRO_SLIDE_DEFAULT`, not `SLIDE_DEFAULT`. This only matters if
     `slideCount` is ever unset; `initialValues` always sets it.
   - Apostrophes: the rest of `slide-fields.tsx` writes `o‘`/`g‘` (U+2018), e.g. `:251–332`. The new strings
     use ASCII `o'z`/`sig'adi`. Pick the file convention and update the test strings to match.
   - Remove the redundant `key="planItems"` on `<Row>` inside the component (`:185`). The caller already keys
     the element.

## Findings by question

### (1) Forms rules
- **Probe target:**
  - Slide forms have no `data-field`. «Every param is rendered exactly once» is enforced by
    `tests/slide-form.test.mts:42–66`, a source regex `case\s+"([a-zA-Z]+)":` over `slide-fields.tsx`.
    `case "planItems":` is kept, now returning `<PlanItemsField key={id} …/>`.
  - `tests/viewer/slide-form.test.mts:83–106` checks the id arrays (`SLIDE_FIELD_ORDER` etc.), which did not
    change.
  - `tests/slide-params.test.mts` (differential probe) works on meta/prompt, not the DOM, so this change does
    not affect it. The radiogroup keeps `aria-label="Reja bandlari"`, which the UI tests query. OK.
- **Row:** still one param = one `Row`. OK.
- **Price:** no price text was added, and `priceFor` is untouched. OK.
- **Decorative field:** the new «1» option can be decorative (CHANGES 1).
- **Uzbek text:** the text is in Uzbek, but the apostrophe style is inconsistent (CHANGES 7).

### (2) A11y and semantics
- Disabled options have native `disabled` and `aria-disabled` (redundant but harmless), plus a muted style and
  `cursor-not-allowed`.
- Native `disabled` removes them from the Tab order. That matches native radio-group behaviour and WAI-ARIA
  guidance: disabled options should not be focusable. Screen readers in browse mode still announce them as
  «dimmed/unavailable».
- The `radiogroup`/`radio`/`aria-checked` semantics match `Segmented`. The existing `Segmented` also has no
  arrow-key roving, so this is no regression.
- The checked radio is the EFFECTIVE value, so what AT reads matches the visual state. Good.
- The inline hint shows only when `effective < raw`. Correct.
- The status `<p>` has no `role="status"`. A conditionally mounted live region is announced unreliably anyway,
  so this is optional.
- Downward expansion to 1–2 when capacity < 3 is correct in principle.
- Is a 1-item plan meaningful? Decision 3 and P1's `planBudgetForBody` allow it: on 4 slides the agenda slide
  is kept with 1 bullet (room = 1), which is thin. P1 could consider dropping the agenda when capacity would
  be 1. That is an engine question, not P4.
- Tooltip wording is fine, apart from «7 band» vs a maximum of 6 (CHANGES 7).

### (3) Server/client parity: stub vs P1 `planCapacity`
P1 WIP formula (`slide-params.ts` in `agent-a9012405…`):
- `bodyWant = clamp(slideCount, 4, 30) − (titleSlide===false ? 0 : 1) − 1`
- the active set is `activeBlockIds`: `quizCount>0` adds test, `quizCount===0` REMOVES test (A3-01),
  `internetSearch` adds adabiyotlar, `agendaSlide===true` adds reja (A3-02)
- `room = bodyWant − (test ? 1 : 0) − (reja && agendaSlide!==false ? 1 : 0)`
- if `room < 1`, the agenda yields (+1)
- `capacity = max(1, room)`

`adabiyotlar`, `diagramma`, the answer key (`speakerNotes:false`), extra quizzes, fillers and every other block
all YIELD. `section`+content (2 slides per item, decision 1) only applies when there is spare room, so it
does not lower capacity, and the tooltip «har biri o'z slaydi bilan» stays true.

Where the stub disagrees (form defaults: `quizCount 0`, `agendaSlide true`, `titleSlide true`,
`internetSearch false`):

| Case | Stub | Real (P1 WIP) | Visible effect |
|---|---|---|---|
| `adabiyotlar`/`diagramma` in blocks (lecture, report, defense, pitch) | −1 each | 0 | Stub under-reports |
| `test` in purpose defaults + `quizCount 0` (open_lesson, training) | −1 | 0 (test removed) | Stub under-reports |
| `internetSearch: true` | −1 | 0 | Stub under-reports |
| `titleSlide: false` | ignored | +1 | Stub under-reports |
| agenda counted without `reja` (pitch/training, pro with «Reja» chip off) | stub always counts agenda when `agendaSlide!==false` | real adds `reja` when `agendaSlide===true`, so same result under form defaults | same |
| `quizCount>0` | −1 | −1 | same |
| room < 1 (4 slides + test) | floor 1 | agenda yields → 1 | same |
| `speakerNotes: false` (answer key) | 0 | 0 (yields) | same |

Concrete cells to re-verify after the swap:
- 6 slides: real gives 3 for EVERY purpose. The stub gives defense 1; lecture/report/pitch/open_lesson/training 2.
- 8 slides: real 5; stub defense 3, the others above 4.
- 10 slides: real 7; stub defense 5.
- The default `general`/`lesson`/`seminar` columns agree: 10 slides → 7, 4 slides → 1.

A3's table (content counts BEFORE the fix) is superseded, because under decision 1 capacity no longer
subtracts yielding blocks.

### (4) `effectivePlanItems` and the summary chip
- The chip now uses the effective value (`slide-fields.tsx:357`). Right idea, but the floor differs from the
  server (CHANGES 1).
- Opening or closing Settings is unaffected. The chip string keeps its format («N band»).

### (5) Test quality
- The commit message says 5 new tests and the task says 6. There are **4** (`tests/ui/slide-composer.test.mts:151, 176, 192, 202`).
- No `assert.equal` on DOM nodes. All asserts compare attributes or strings (`assert.ok(btn.disabled)` is a
  boolean). Good.
- Mutations reasoned from the code:

| Mutation | Result |
|---|---|
| clamp removed (`effective = raw`) | caught by test 1 |
| `aria-disabled` removed | caught by test 1 |
| native `disabled` removed | caught by test 1 only; test 2 is masked (CHANGES 4) |
| `lo = PLAN_ITEMS_MIN` (no expansion) | caught by tests 1 and 2 |
| hint always or never shown | caught by tests 1 and 4 |
| chip back to `clampInt(…,3,6)` | caught by test 1 |
| `onClick` no-op | caught by test 4 |
| static tooltip | caught by test 3 |
| `>` → `>=` | **survives** (CHANGES 3) |
| `capacityFor` drops `quizCount`/`titleSlide`/`blocks` | **survives** (CHANGES 5) |

- The tooltip locator `closest(".grid")` depends on a Tailwind class. A `data-` hook on `Row` would be sturdier
  (non-blocking).
- **The run command given for this review is wrong for UI tests.** With `--conditions=react-server`,
  `@testing-library/react` → `react-dom/client` throws «not supported in React Server Components» at import,
  so the whole file fails before any test runs.
  - Use `npm run test:ui` style instead: `tsx --tsconfig tsconfig.viewer.json --test tests/ui/slide-composer.test.mts`, no conditions.
  - I did not re-run under the one-heavy-command limit. Test results above are reasoned from the code, not
    executed.

### (6) Closed composer height
- `planItems` renders inside the closed `<details>` (`SETTINGS_ORDER`, `SlideComposer.tsx:51–66`). The new
  hint line only appears when Settings are open.
- The chip text length is unchanged («N band»). The closed-height budget (≤ 1 200 px @1400) is unaffected.

### (7) Rest of diff
Only the three files listed above. There are no changes to `SlideComposer.tsx`, `ProSlideForm.tsx` or
`SlideForm.tsx`, and no Playwright spec was committed; the smoke described in the commit message was ad hoc.

## Tests coupled to the stub formula
All four hardcode capacity numbers derived with the stub's arithmetic. The comments say «10-2-1=7» and
«4 - 2 - 1 (reja slaydi) - 0 = 1».
- `planCapacity past bo'lganda …` (`:151`): expects capacity 7 at 10 slides and 1 at 4 slides.
- `sig'im 3 dan kichik bo'lsa …` (`:176`): expects capacity 1 at 4 slides, so options are exactly 1..6.
- `tooltip izohi (A3-06) …` (`:192`): exact strings «10 slaydga 7 band», «4 slaydga 1 band».
- `sig'im yetganda … (regressiya)` (`:202`): only needs capacity ≥ 6 at 10 slides, so it is effectively formula-free.

With P1's current WIP (`general`, `mount("slide")` defaults) the numbers happen to MATCH: 10 slides → 8 − 1 = 7,
and 4 slides → 2 − 1 = 1 with the agenda kept. The tests should therefore survive the swap unchanged. They will
break if P1 changes small-deck agenda handling (for example, dropping the agenda when capacity would be 1 gives
2 at 4 slides). Update the stub-arithmetic comments at the swap either way.

---

# Re-review — 8e4603e

Diff `c9e4323..8e4603e` touches `SlideComposer.tsx`, `compact.tsx`, `plan-capacity-stub.ts`, `slide-fields.tsx`
and `tests/ui/slide-composer.test.mts`. P1 semantics were checked against worktree `agent-a9012405…` (HEAD
`2af1974` plus uncommitted `slide-params.ts`/`meta.ts`/`slide-blocks.ts`): `resolvePlanFlags`, `planBudget`,
`effectivePlanItems(raw, capacity, slideCount)`, `defaultPlanItems`.

**Test run:** one heavy command, `npx tsx --tsconfig tsconfig.viewer.json --test tests/ui/slide-composer.test.mts`
in the P4 worktree. Result: **21 tests, 20 pass, 0 fail, 1 skipped** (the pro-slide TODO).

## Verdict: CHANGES

Items 1, 3, 4 and 7 are fixed. Item 5 is fixed for the plain «Slayd» form, but the pro-slide test is skipped and
will fail when turned on (N4). Item 6 is fixed and safe for the other forms. The new «send `quizCount`/`agendaSlide`
only when the user touched them» logic, however, does not match P1's final rule that an explicitly sent `blocks`
list wins. The main reason is that **the plain «Slayd» form also sends `blocks`**. Several form controls therefore
become decorative again (N1, N2). N3 is required for the swap to work.

## Previous items: status
- **1. Fixed.** Floor 1 via a stub `effectivePlanItems(raw, capacity)` with the P1 signature. `lo = min(PLAN_ITEMS_MIN, capacity, effective)`. New test `:205` checks exactly one checked radio, equal to the chip. The mutations "floor back to 3" and "drop `effective` from `lo`" both turn it red.
- **3. Fixed.** At capacity 1, «1» must have `aria-disabled="false"` (in test `:156`). New boundary test at capacity 4 (`:192`) makes a click that really changes state.
- **4. Fixed.** Test `:217`: after a disabled «4» click, raising the slider to 30 must show the default, not 4.
- **5. Fixed for «Slayd».** Wiring test `:240` (agenda off gives +1, quiz 3 gives −1). With real P1 the numbers are the same: 7 slides gives bodyWant 5, so 4, then 5, then 3. The pro test is skipped (see N4).
- **6. Fixed.** `Segmented` now takes `SegmentedOption = FieldOption & { disabled?: boolean }`.
  - `FieldOption` (`lib/types.ts:70`) has no `disabled`, and none of the other 16 files that use `Segmented` (`Article/Essay/Game/Infographic/Media/Resume/Work/Translation`, `ImageStudio`, `teacher/*`) builds options with that key. Their behaviour is unchanged.
  - The only DOM change for them is a new `aria-disabled="false"` attribute on every segment button. No test outside `slide-composer` refers to it (grep). See N5.
- **7. Fixed.** Tooltip number `min(capacity, 6)`. Hint «Tanlangan N band sig‘maydi — M band yoziladi.» `o‘`/`g‘` apostrophes. `SLIDE_MIN/MAX` clamp. Pro fallback `PRO_SLIDE_DEFAULT`. Inner `key` removed.

## CHANGES (new)

1. **N1 — the plain «Slayd» form sends `blocks`, so P1 ignores its «Testsiz» and «Reja slaydi» (A3-01/A3-02 regress).**
   - `SlideComposer.tsx:111` puts `blocks: resetBlocksForPurpose("general")` into the initial values for BOTH tools. `slide-fields.tsx:278` sets `blocks` again whenever the presentation type changes. `sanitizeValues` does not drop unused keys, so `blocks` reaches `extractMeta`.
   - P1's `resolvePlanFlags(blocksSent=true, …)` then treats the request as pro-slide:
     - `quizCount: 0` is IGNORED when `blocks` contains `test`: «Ochiq dars»/«Trening» plus «Testsiz» still gives 3 quizzes.
     - `agendaSlide: true` is IGNORED: «Trening»/«Taklif» plus «Reja slaydi» ON gives no agenda slide.
   - P1's own comment says «bloklar YUBORILMAGAN (oddiy slayd)». Its assumption does not hold for the current form.
   - Fix, in both places:
     - **P4:** set `blocks` only for `kind === "pro-slide"`, in both `initialValues` and the `slidePurpose` onChange (`ctx.tool`). Drop `blocks` from a restored draft when the tool is «Slayd». Have `capacityFor` pass `blocks: ctx.tool === "pro-slide" ? values.blocks : undefined`.
     - **P1 (server authority, protects against old drafts and old clients):** `blocksSent = tool.id === "pro-slide" && values.blocks != null`.
   - Test: «Slayd» + open_lesson + «Testsiz». The POST must have no `blocks` key and `quizCount === 0`. Add a meta-level test in P1 as well.
2. **N2 — in pro-slide the form contradicts «chips win».** `resolvedQuizCount`/`resolvedAgendaSlide` (`slide-fields.tsx:100–115`) read `purposeDefaults(slidePurpose)`, not `values.blocks`. Server outcomes vs what the form shows:
   - (a) The type has Test (open_lesson) and the user picks «Testsiz». The form sends 0 and shows «Testsiz». The server ignores the 0 and writes 3 quizzes. Test `:326` («Testsiz» sends 0) locks in exactly this decorative state.
   - (b) The user ticks the Test chip, which auto-sets `quizCount=3`, then unticks it. `quizCount` stays 3 and P1's `activeBlockIds` adds `test` back because `quizCount>0`. The form summary shows «3 savol» while the Test chip is off.
   - (c) The user unticks the «Reja» chip without touching the agenda switch. The switch and the summary still show «Reja» (from the purpose default), but the server makes no agenda slide.
   - (d) The Reja chip is off and the user turns the «Reja slaydi» switch ON. The server drops `agendaSlide: true`, so the switch is decorative.
   - Fix for pro-slide: keep the controls in step.
     - «Testsiz» removes `test` from `blocks`; N>0 makes sure `test` is in `blocks`.
     - Unticking the Test chip sets `quizCount: 0`.
     - Turning the «Reja slaydi» switch ON adds `reja` to `blocks`; unticking the Reja chip must show the switch OFF.
     - Compute what is displayed from P1's `resolvePlanFlags` + `activeBlockIds` (import at the swap), not from a copy based on `purposeDefaults`.
   - Tests: one per case (a)–(d). In each, the POST body and the summary chip text must agree with what the server would do.
3. **N3 — the adaptive default never reaches the server from the form.** `initialValues` still sends `planItems: PLAN_ITEMS_DEFAULT` (5) (`SlideComposer.tsx:112`). P1 treats a sent value as the user's choice, so `defaultPlanItems(slideCount)` (10 → 3, 12 → 4) never applies to form submissions.
   - Remove `planItems` from `initialValues`.
   - Call `effectivePlanItems(values.planItems, capacity, slideCount)`. `raw` in `PlanItemsField` should be `values.planItems` if the user set it, otherwise `defaultPlanItems(slideCount)`.
   - Show the «Tanlangan N band sig‘maydi» hint **only** when `values.planItems !== undefined`. The user never chose the default, so it must not be called «tanlangan».
   - Note: drafts saved by the current production form contain `planItems: 5`, `quizCount: 0` and `agendaSlide: true`. After deploy, a restored draft turns them into explicit choices. Either accept this or ignore these three keys when restoring legacy drafts (e.g. a draft version tag).
4. **N4 — the skipped pro test (`:253`) will fail when turned on.** It expects «12 slaydga 9 band», but the tooltip now shows `min(capacity, 6)`, i.e. «12 slaydga 6 band». Use a case where the stub and the engine disagree and the number stays ≤ 6. Example: pro + «Himoya» (defense) + 8 slides. Real gives 8 − 2 − 1 = 5, so assert «8 slaydga 5 band sig‘adi» with «6» disabled; the stub would give 3.
5. **N5 (nit, `compact.tsx`)** — use `aria-disabled={disabled || undefined}` so the other 16 forms' DOM stays byte-identical. The `onClick` guard is redundant with native `disabled`; harmless.

## Swap checklist (at the P1 merge)
1. Delete `components/forms/plan-capacity-stub.ts`. In `slide-fields.tsx:38` import `planCapacity`, `effectivePlanItems`, `defaultPlanItems` from `@/lib/generation/slide-params`, plus `resolvePlanFlags`/`activeBlockIds` for N2.
2. `effectivePlanItems` takes 3 arguments. Pass `slideCount` (the same clamp as `PlanItemsField`) at both call sites: the `effectivePlanItems(values)` wrapper and `PlanItemsField`.
3. N3: remove `planItems` from `initialValues` and derive `raw` via `defaultPlanItems`. Show the hint only for an explicit user choice.
4. N1: send `blocks` only for pro-slide, and have `capacityFor` pass `blocks` only for pro-slide. P1's `blocksSent` must also check the tool.
5. Delete the stub-only `resolvedQuizCount`/`resolvedAgendaSlide` purposeDefaults copies, or rebase them on P1's rule (N2). Keep `QUIZ_COUNT_FALLBACK` equal to P1's `QUIZ_COUNT_FALLBACK` (3) by importing it rather than redefining it.
6. **Tests/strings that change** (`tests/ui/slide-composer.test.mts`):
   - `:36` title + list: «5 band» becomes **«3 band»** (10 slides → `defaultPlanItems` 3).
   - `:156` (capacity test):
     - At 4 slides the hint must NOT appear, because the default was not chosen.
     - «joriy (standart 5)» comment: update.
     - At 30 slides «5» checked becomes **«6»** (`defaultPlanItems(30)=6`).
     - `!chips().includes("5 band")` remains true.
   - `:192` boundary: at 7 slides the default is 3 (`round(7/3)` = 2, clamped to 3), so «4 band» becomes **«3 band»**. Clicking «3» is then a no-op: click «4» and assert «4 band».
   - `:217` native-disabled: after going back to 30 slides, «5»/«5 band» becomes **«6»/«6 band»**. It still tells the default apart from the disabled «4».
   - `:231` tooltip: «10 slaydga 6 band» and «4 slaydga 1 band». **Unchanged** with real P1 (general: bodyWant 8 − 1 = 7, shown as 6; 4 slides: 2 − 1 = 1, agenda kept).
   - `:240` wiring (7 → 4, agenda off → 5, quiz 3 → 3): **unchanged** with real P1, **provided** `capacityFor` still reflects explicit `quizCount`/`agendaSlide` for «Slayd» after N1.
   - `:253` skipped pro test: rewrite per N4 and turn it on.
   - `:326` «Testsiz» sends 0: for pro-slide also assert that `blocks` lacks `test` (N2a). Add the «Slayd» counterpart asserting there is no `blocks` key (N1).
   - `:295`, `:313`, `:341`, `:354`: semantics unchanged. `:313` should additionally assert `blocks` contains `test`.
   - Every comment with stub arithmetic («10-2-1=7», «7-2-1-0=4», «4 - 2 - 1 (reja slaydi) - 0 = 1») becomes bodyWant wording.
7. After the swap, re-run this file and the `tests/slide-form.test.mts` / `tests/viewer/slide-form.test.mts` guards. P1's `tests/slide-params.test.mts` probe for `planItems` (probeA 3 / probeB 6) must still differ at the default slide count (capacity 7 at 10 slides; OK).

---

# Final review — caf9fcb

Scope: `git diff 58720e8..caf9fcb` (merge `a0870ab` of `slides-3` with P1/P2/P3/P5/P6/P7, then `caf9fcb` swapping to
the real engine and adding the N2 sync). The N1/N3/N5 changes from `58720e8` were re-checked in context
(`SlideComposer.tsx` drafts `v:2`, `compact.tsx`).

**Test run:** one heavy command, `npx tsx --tsconfig tsconfig.viewer.json --test tests/ui/slide-composer.test.mts`
in the P4 worktree. Result: **27 tests, 27 pass, 0 fail, 0 skipped.**

## Verdict: CHANGES (one small item; the rest are notes)

## What is right
- **Stub gone.** `plan-capacity-stub.ts` is deleted. `slide-fields.tsx` imports `planCapacity` (with `tool`),
  `effectivePlanItems`, `normalizeQuizCount`, `resolvePlanFlags` and `activeBlockIds` from
  `lib/generation/slide-params`, and `QUIZ_COUNT_FALLBACK` from `slide-blocks`.
- **No leftover data copy.** The only `purposeDefaults` read (`slide-fields.tsx:104`) is the engine's own
  function, used exactly where `extractMeta`/`planBudget` use it (blocks not given → type default).
- **Every displayed value is engine-derived:**
  - the plan-item options and which are disabled: `planCapacity`
  - the default and effective plan count: `effectivePlanItems(values.planItems, cap, slidePagesOf)`; the raw
    value is the same function with infinite capacity
  - the quiz and agenda values shown in the controls and the summary: `resolvedFlags` →
    `resolvePlanFlags` + `activeBlockIds`
  - `slidePagesOf` uses the same per-tool clamp as `meta.ts` (`slidePages`)
- **Parity with `meta.ts`.** `blocksSent` is `tool === "pro-slide" && blocks != null` on both sides.
  `normalizeQuizCount` and the `agendaSlide` tri-state are the same.
- **N2 cannot loop.** Each handler calls `set` (a functional `setValues`) directly. A chip handler never
  calls the quiz or agenda `onChange`, and the reverse is also true. There are no effects that react to these
  keys, so nothing re-enters. The two `set` calls inside one handler are functional updates, so both apply.
  Handlers read `values` from the render closure, which is correct for a single user event.
- **Drafts `v:2`.**
  - `sanitizeValues` (server `putDraft`/`getDraft`) keeps the numeric `v` key (the key regex allows it), so the
    version round-trips.
  - `v` is removed on restore and added only to the saved object, so it never reaches `values` or the POST.
  - Legacy drafts lose `planItems`/`quizCount`/`agendaSlide`, and «Slayd» drafts lose `blocks`. The first save
    after restore migrates the draft to `v:2`.
  - Test `:451` covers the legacy path; `:535` covers the version tag.
- **No new decorative field.** The registry and field order are unchanged. The «Reja slaydi» switch on plain
  «Slayd» now truly adds or removes the agenda: `agendaSlide:true` adds `reja` when no blocks are sent.
- **`compact.tsx`:** `aria-disabled={disabled || undefined}`. The other 16 forms that use `Segmented` render
  exactly as before.

## CHANGES
1. **F1 — changing «Taqdimot turi» on pro-slide leaves `quizCount`/`agendaSlide` behind, so chip and control disagree again.**
   - The `slidePurpose` onChange (`slide-fields.tsx:306–312`) resets `blocks` to the new type's defaults but
     keeps an explicit `quizCount`/`agendaSlide`.
   - Example (quiz): pro, «Umumiy», «Nazorat testi»=5 (the sync adds `test`), then type → «Ma'ruza». `blocks`
     becomes `reja,maqsadlar,adabiyotlar` without `test`, while `quizCount` stays 5.
     `resolvePlanFlags(sent, …, 5, …)` keeps 5 (only 0 is neutralised), and `activeBlockIds` adds `test`. The
     deck gets a 5-question test and the «Nazorat testi» control shows 5, but the **«Test» chip is OFF**. This
     is case (b) of N2 reached by a different route.
   - Example (agenda): switch «Reja slaydi» OFF (the sync removes `reja`, `agendaSlide=false`), then change the
     type. `reja` comes back from the new defaults, so the **«Reja» chip is ON**, but the switch stays OFF and no
     agenda slide is made.
   - Fix (pro only), in the same handler after resetting `blocks`, set both flags from the new defaults:
     `quizCount = newBlocks.includes("test") ? QUIZ_COUNT_FALLBACK : 0` and
     `agendaSlide = newBlocks.includes("reja")`. That matches «Taqdimot turi standart bloklarni beradi».
     Alternative: unset both keys; this needs a setter that accepts `undefined`.
   - Test: pro; «Nazorat testi»=5; type → lecture. The Test chip's `aria-pressed` and «Nazorat testi» must agree
     (both off/«Testsiz»), and the POST must have no `test` in `blocks` and `quizCount` 0. The mirror case: pro;
     switch OFF; type → lesson; the chip «Reja» and the switch agree.

## Notes (non-blocking)
- **The uncaught mutation (`else if (!hasRejaNow && hadReja) set("agendaSlide", false)`, blocks onChange) is
  dead at the moment it runs, and harmless.**
  - Once `reja` leaves `blocks`, `on.has("reja")` is false. `planBudgetForBody` and `resolvedAgendaSlide` then
    give "no agenda" whatever `agendaSlide` is. For pro, `resolvePlanFlags` also neutralises `true`.
  - The only later effect is stickiness: after a type change `reja` returns and the sticky `false` keeps the
    agenda off. That is the F1 mirror case, and the F1 fix makes it irrelevant.
  - Keeping the line for symmetry is fine. The opposite branch (`hasRejaNow && !hadReja → true`) is NOT dead: it
    clears an earlier `false` set by the switch.
  - The N2c test comment (`:404–405`, «…qatorlari olib tashlansa — bu qator qizaradi») is inaccurate for this
    line. Reword it, or make N2c also re-tick the chip after the switch was turned off.
- **No test that a `v:2` draft KEEPS explicit choices.** The mutation "always delete the three keys" survives.
  One test would close it: GET draft `{ v: 2, quizCount: 5, planItems: 4 }` → the POST carries both.
- **Small-deck agenda.** `planBudgetForBody` drops the agenda when `room < 1` (e.g. 4 slides + test + reja), but
  `resolvedAgendaSlide` shows the switch ON. This is automatic adaptation like the `planItems` clamp, but the
  switch has no hint. Either show `planBudget(…).agenda` in the summary chip, or accept and document it.
- **Duplicated steps.** `resolvedFlags` repeats the sequence in `planBudget` (`slide-params.ts:319–336`) step by
  step. It is correct today, but that makes three copies of the procedure (`meta.ts`, `planBudget`, the form). P1
  could export `planFlags(v): { on, quizCount, agendaSlide }` from `planBudget`, and the form would call it. This
  is a follow-up, not a merge blocker.
