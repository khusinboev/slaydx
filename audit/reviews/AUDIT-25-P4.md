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
