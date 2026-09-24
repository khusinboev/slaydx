# A2 — Slide layout/visual audit (AUDIT-25)

Scope: `lib/generation/slide-layout.ts`, `slide-layout-extra.ts`, `visuals/*.ts` (+ README),
`slide-themes.ts`, `render-pptx.ts`, `components/viewers/SlideCanvas.tsx`, `slide-audience.ts`,
`slide-fonts.ts`. Read-only on code.

Material: two live decks already rendered at 40 dpi
(`/tmp/claude-1000/.../scratchpad/decks/{Orol_dengizi_fojiasi_va_uni_tiklash_choralari,Kasr_sonlarni_qoshish_va_ayirish}-NN.png`,
`*-sheet.png` contact sheets) plus their PPTX (`eval-out/live/*.pptx`). For four slides that needed a
closer look I re-rasterized the **already-produced** PDFs in the scratchpad (`decks/*.pdf`, output of the
earlier soffice conversion) at 200 dpi with a plain `pdftoppm -r 200` on single pages — this does **not**
invoke LibreOffice again, so it did not go through the `heavy2.sh` gate; the gate's soffice+pdftoppm
command was not used at all (0/2 calls spent). Output: `/tmp/claude-1000/.../scratchpad/decks/hi/*.png`
(gitignored scratchpad, not part of `eval-out/`).

Decks seen: `atlas`/circle-family theme, 10 slides, pro-slide, `open_lesson` ("Orol dengizi…") and a
second slide theme/deck, 10 slides ("Kasr sonlarni qoshish va ayirish").

---

### A2-01 — `String/two(index+1)` deck-index sites for P2 to retarget onto `s.plan` (S2 family, exact sites)

Severity: **P2**. Location: 10 visual designs + `slide-layout.ts`. Owner: **P2** (per AUDIT-25 §3,
decision 4 — "raqam faqat rejadan").

Already-known root cause S2 (`docs/AUDIT-25.md`) is not re-analyzed here; this is the exhaustive site
list P2 needs when it wires these to `s.plan` instead of the deck-order `index`. 12 of the 15 sites are
inside `planSection*` (matches S2's description); **3 sites are outside `section` entirely** and are not
covered by decision 4's stated scope ("section (va bo'lim vazifasidagi kicker raqamlari)") — flagged
separately as A2-02.

`planSection*` sites (deck-index number shown as section badge):
- `lib/generation/visuals/circle.ts:145`
- `lib/generation/visuals/editorial.ts:137`
- `lib/generation/visuals/bold.ts:122`
- `lib/generation/visuals/academic.ts:156`
- `lib/generation/visuals/dashboard.ts:142`
- `lib/generation/visuals/formal.ts:108`
- `lib/generation/slide-layout.ts:710` (`planSectionMagazine`)
- `lib/generation/visuals/split.ts:112`
- `lib/generation/visuals/rail.ts:142` and `lib/generation/visuals/rail.ts:149` (`pushRingPhoto(..., two(index+1))` — same number painted a second time inside the ring photo)
- `lib/generation/visuals/story.ts:112` (via `pushNumberDecor`, `story.ts:31`)
- `lib/generation/visuals/notebook.ts:170`

Proposed fix: same shape everywhere — replace `index`/`two(index+1)` with `s.plan` (1-based reja band),
render nothing when `s.plan` is undefined (per decision 4), single helper if convenient to avoid repeating
the `String(n).padStart(2,"0")` idiom across 10 files. Effort: **M** (mechanical but 12 call sites across
10 files + tests/slide-plan-numbers.test.mts assertions per site).

---

### A2-02 — Deck-index decorative numbers also leak onto `title`/`bullets` layouts (not just `section`)

Severity: **P2**. Location/Evidence:
- `lib/generation/visuals/editorial.ts:95` — `planTitle` paints a giant 84pt `two(index+1)` next to the
  deck's **title** slide kicker (title slide is never `s.plan`-numbered by decision 4, so after the S2 fix
  this will still show an arbitrary deck-order number like "01" on slide 1 even when the plan has no
  band 1 to point to, or worse "03" if the title isn't slide index 0 in some future flow).
- `lib/generation/visuals/split.ts:92` — `planTitle`'s image-missing fallback draws a 110pt `two(index+1)`
  in the empty photo slot, same issue.
- `lib/generation/visuals/story.ts:158` — `planBullets`'s image-missing fallback draws a 96pt
  `String(index+1).padStart(2,"0")` on an ordinary **content** slide (not `section`), via the same
  `pushNumberDecor`-style pattern used at `story.ts:35`/`story.ts:112`. This is the most confusing of the
  three: a large serif page number appears on a random body slide whenever it has no image, with no
  connection to plan, section, or slide position that a reader could infer.

None of these three are `section` slides, so decision 4's phrase "section (va bo'lim vazifasidagi kicker
raqamlari)" as literally scoped will not catch them — recommend P2 either (a) drop the deck-index number
entirely for these three fallback-decor sites (they are pure "no image" filler, not counters — there's no
"plan" equivalent for a title or a body slide to hang a number on), or (b) explicitly extend the fix list
to include them. Proposed fix: **P2**, drop the number / use a neutral decorative shape instead. Effort: **S**.

---

### A2-03 — 6 of 11 slide-layout types have zero theme-specific art across all 10 visual designs (fall back to one of 2 generic looks)

Severity: **P2**. Location: `lib/generation/visuals/index.ts` (`VISUALS` registry) + `lib/generation/visuals/spec.ts`
(`VisualSpec.plan`) + `lib/generation/slide-layout.ts:2509` (`dispatch`).

Evidence (from each design file's own `plan: {...}` map, read directly):

| layout | designs with custom art | designs falling back to `base` (legacy family) |
|---|---|---|
| `stats` | `bold`, `dashboard` (2/10) | academic, circle, notebook, formal, story, split, rail, editorial (8/10) |
| `process` | `rail` (1/10) | academic, circle, notebook, formal, story, split, bold, dashboard, editorial (9/10) |
| `table` | none (0/10) | all 10 |
| `quiz` | none (0/10) | all 10 |
| `references` | none (0/10) | all 10 |
| `answers` | none (0/10) | all 10 |
| `twoCol`/`compare` | circle, story, split, dashboard (4/10) | academic, notebook, formal, bold, rail, editorial (6/10) |

`table`/`quiz`/`references`/`answers` only ever branch on `visual === "dense"` (dark chrome) vs. the light
default inside the shared `slide-layout.ts`/`slide-layout-extra.ts` functions — so a deck bought as
"Rail" and a deck bought as "Academic" render **pixel-identical** quiz/reference/answer-key/table slides
(only the theme's bg/accent color differs), even though the product markets 10 distinct designs. This is
architecturally documented and intentional (`visuals/spec.ts:9-12`: "qolgan maketlar … base — eski yetti
oiladan biri — bilan chiziladi"), so it is not a regression, but it is the direct, code-confirmed
explanation for why both decks in the material show the same generic white-rounded-card grid for their
quiz slides (Orol slide 6/7, Kasr slide 6/7/8) regardless of theme, and is worth a product decision:
either it's accepted (10 "designs" really means 10 title/section/bullet looks + 2 shared utility looks),
or P2 should budget custom `process`/`stats`/`table`/`quiz`/`references`/`answers` art for at least the
highest-traffic designs. Proposed fix: **P2** (design decision + implementation if pursued). Effort:
**L** (each new custom layout is a full art pass, ~1 file per design × 6 layout types if pursued fully).

---

### A2-04 — `planProcess`/`planStats`/`planTable` (base family) ignore the audience type-size floor (`ctx.bodyType.minPt`) that every other layout respects

Severity: **P1**. Location:
- `lib/generation/slide-layout.ts:2262` (`planProcess`, step title) — `fitSize(st.title, tBox, 16, 12)`
- `lib/generation/slide-layout.ts:2273` (`planProcess`, step description) — `fitSize(st.text, dBox, 14, 11)`
- `lib/generation/slide-layout.ts:2128` (`planStats`, stat value) — `fitSize(st.value, valBox, 30, 15)`
- `lib/generation/slide-layout.ts:2148` (`planStats`, stat label) — `fitSize(st.label, labBox, 15, 11)`
- `lib/generation/slide-layout.ts:2378` (`planTable`, header) — `fitSize(h, box, 15, 11)`
- `lib/generation/slide-layout.ts:2417` (`planTable`, cell) — `fitSize(cell, box, 14, 10)`

All six calls hardcode a numeric floor (10–15pt) instead of `ctx.bodyType.minPt`, even though `ctx` (a
`PlanCtx` carrying `bodyType`) is in scope in every one of these functions and is used correctly
everywhere else in the codebase for exactly this purpose — confirmed by grep, every other layout function
(`planBullets`/`planAgenda`/`planTwoCol` in all 10 visuals, `planQuiz`/`planReferences`/`planAnswers` in
`slide-layout-extra.ts`, the base `asList`/bullet-card/lab-row helpers in `slide-layout.ts`) passes
`ctx.bodyType.minPt`/`bodyType.minPt` as the floor. `slide-audience.ts` documents this floor as "Slide Law"
(`bodyPt`/`minPt` comment, line 55) with `minPt` ranging from **15pt** (bachelor/master/educators) up to
**24pt** (`school_1_4`, 1st–4th grade). Because `process`/`stats`/`table` never read `minPt`, a deck built
for `school_1_4` or `school_5_7` (`minPt` 22–24) can legally shrink process-step or table-cell text down
to **10–12pt** — roughly half the audience's mandated floor — the exact opposite of the Slide Law's intent
("bolalar uchun kichik shrift YO'Q"). This is also the concrete mechanism behind the "process cards look
tiny" symptom: on the material deck (`open_lesson`, likely `school_5_7`/`school_8_9`, `minPt` 20–22) the 3
process cards on slide 5 (Orol) happened to have short enough text to stay near the 16pt/14pt caps, but any
process/table/stats slide with slightly longer text on that same audience will fall through the 12pt/11pt/
10pt floor, well under the 20–22pt Slide Law minimum — evidence: `hi/orol5-05.png` (200dpi re-raster,
`/tmp/claude-1000/.../scratchpad/decks/hi/orol5-05.png`) shows generous card boxes (3.7in tall) with text
using well under half the box, i.e. the box was sized for more/larger text than what actually rendered —
consistent with a floor bug that just hasn't been hit yet by this particular deck's wording.

Proposed fix: **P2** (violation site is inside P2-owned `slide-layout.ts`) coordinating with **P3**
(`slide-audience.ts` owns the Slide Law definition) — thread `ctx.bodyType.minPt` through the six call
sites the same way every sibling function already does. Effort: **S** (mechanical, 6 call sites, one file).

---

### A2-05 — Generous card sizing + short LLM content ⇒ visibly empty cards on `process`/`answers` slides

Severity: **P3**. Location:
- `lib/generation/slide-layout.ts:2167-2295` (`planProcess`, base family) — Orol slide 5
  (evidence: `.../decks/Orol_dengizi_fojiasi_va_uni_tiklash_choralari-05.png`, zoomed
  `.../decks/hi/orol5-05.png`): each of the 3 step cards is 3.7in tall; title+body text occupies roughly
  the top 45% of the card, leaving a clearly visible blank lower half in every card. `rowH` is deliberately
  uncapped per the `AUDIT-9`-referenced comment at `slide-layout.ts:2189-2196` ("karta butun balandlikni
  egallamaydi" was the *previous*, now-fixed bug) — but the current fix only bounds card height, it does
  not grow the description text or add a second content element to use the freed space, so short
  `st.text` still reads as a half-empty card.
- `lib/generation/slide-layout-extra.ts:613-678` (`planAnswers`) — Orol slide 8 "Test javoblari"
  (evidence: `.../decks/Orol_dengizi_fojiasi_va_uni_tiklash_choralari-08.png`, zoomed
  `.../decks/hi/orol8-08.png`): with only 2 quiz answers the layout correctly stretches the 2 hero cards to
  fill ~87% of the usable zone (per the `AUDIT-8 N-3/N-5` fix comment at line 597-607, verified by
  measurement — this part is *not* a regression), but each card's actual content is just `"1 — A"`/`"2 — B"`
  — 5 characters set in a ~2.4in-tall box, `valign: "middle"`. The result is a slide that is technically
  "full" by area but carries almost no information: no restated question, no per-option breakdown. A
  reader sees two huge, mostly-white cards holding a single glyph pair each.

Proposed fix: **P3** (density/brief package) — for `answers`, consider showing the (shortened) question
stem alongside the number/letter so the hero-card space carries actual content instead of whitespace; for
`process`, consider a min-fill rule (e.g. if `fitSize` lands well under the box, add step number context or
cap card height more aggressively rather than leaving dead air) — same spirit as the `thinSlides`/
`repairThinSlides` detector already planned in AUDIT-25 §2.6, which should catch these via a
"card text-to-box-area ratio" style check if one is added; currently `thinSlides` per the plan only checks
band/word counts, not per-card whitespace, so these two would slip through as-is. Effort: **M**.

---

### A2-06 — `accentInk` contrast (theme.accentInk) — spot check found no confirmed violations

Severity: informational (no P-level defect filed). The codebase already enforces the rule explicitly in
comments (`slide-layout.ts:2061`, `:2124` "WCAG AA"; `academic.ts:145`; `slide-layout-extra.ts:15`) and in
several places switches to `titleMuted`/`titleText` for the `dense` (dark-card) branch instead of
`accentInk` (e.g. `slide-layout.ts:1875`, `:2065`, `:2127`; `slide-layout-extra.ts:510`). A grep-based
proximity scan for `accentInk`-colored text sitting on top of a `theme.accent`-filled shape
(`bold.ts:186`, `editorial.ts:208`, `notebook.ts:66`, `rail.ts:143`) turned up four candidates on manual
review, but in every case the accent-filled shape and the `accentInk` text are either (a) a thin 0.02–0.13in
divider/rail line that does not sit *behind* the text box, or (b) a heavily alpha-reduced tint (0.16–0.45)
that is much closer to the page background than to full accent, so none is a real stacked-contrast
violation. No action item filed; note this in case a future full accessibility pass wants a starting list.

---

### A2-07 — PPTX/viewer parity (`render-pptx.ts`, `SlideCanvas.tsx`): clean

Severity: informational. Both files read exclusively from `planSlide`'s `SlidePlan.layers` — `render-pptx.ts`'s
`paintLayer` and `SlideCanvas.tsx`'s `LayerView`/`textLayerStyle` do not compute any layout, size, or color
decision themselves; every pixel value traces back to `SlideLayer` fields produced by `planSlide`. Both
files carry explicit "parity" comments pointing at `tests/viewer/parity.test.mts` for exactly this
invariant (`SlideCanvas.tsx:31-35`, `render-pptx.ts:93-94/104-116/167-170`). No parity risk found in this
scope; the one deliberate PPTX/viewer difference (`letterSpacing: layer.tracking * 0.6` in
`textLayerStyle` at `SlideCanvas.tsx:47` vs. raw `charSpacing: layer.tracking` in `render-pptx.ts:172`) is a
documented unit conversion (CSS px vs. PPTX pt tracking), not an unaccounted-for computation, and is
outside this audit's finding criteria (nothing computed outside `planSlide`).

---

## Summary

- P1: 1 (A2-04 — process/stats/table ignore audience `minPt` floor)
- P2: 3 (A2-01 — deck-index badge sites list; A2-02 — deck-index leak onto title/bullets fallback decor;
  A2-03 — 6/11 layout types share one generic look across all 10 themes)
- P3: 1 (A2-05 — generous card sizing vs. thin content on process/answers slides)
- Informational (no severity, no owner): 2 (A2-06 — accentInk contrast, no violation found; A2-07 —
  PPTX/viewer parity, clean)
