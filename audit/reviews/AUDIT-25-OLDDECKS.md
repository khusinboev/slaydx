# AUDIT-25 — Old-deck compatibility probe (OLD engine `doc_json` → NEW layout/editor/render)

Read-only probe (branch `slides-3`, HEAD `e268937`+). Material: 6 real decks
generated live by the OLD engine (`main e89c7c1`) —
`eval-out/audit25-baseline/{defense-14,lecture-12,lesson-10,min-4,open-lesson-pro-12,report-8}.doc.json`
(+ their old `.pptx`/`.pdf`/`-NN.png`/`-sheet.png`, rendered by the old code).

Question: when these existing `doc_json` are re-rendered by the **new**
layout code and edited through the **new** editor, does anything change
beyond the documented, intentional AUDIT-25 P2 change ("section/kicker
numbers come from `SlideModel.plan` only; old `doc_json` has no `plan` →
no number is drawn")? Does CLAUDE.md's "ko'rdim = oldim" still hold?

## Method

- Probe script: `/tmp/.../scratchpad/audit25-olddecks-probe.mts` (tsx,
  absolute imports into the repo, no network/LLM calls — all deck images
  are `data:` URIs, decoded locally).
- Run via `heavy2.sh` (1 of 3 heavy calls): `buildSlideDeck` → `planSlide`
  per slide for all 6 decks; geometry/overflow/bare-number scan; 4
  `applyDocOps` edits + `inverseOps` round trip per deck; `deliveredCount`
  per deck. Output: `eval-out/audit25-olddecks/probe-report.json`.
- Render: `renderPptx(doc, name+".pptx", {})` (same function
  `lib/server/slide-commit.ts rebuildFile` → adapter → `render-pptx.ts`
  uses for a live re-render) → `eval-out/audit25-olddecks/*.pptx`.
- Raster (2nd of 3 heavy calls, one `heavy2.sh bash` call): `soffice
  --headless --convert-to pdf` + `pdftoppm -r 50` (same pattern as
  `scripts/visual-shots.mts`) → `eval-out/audit25-olddecks/*-NN.png` +
  contact sheets via the scratchpad's `decks/sheet.mjs` (copied to
  `scripts/.olddecks-sheet-tmp.mjs`, run, deleted).
- Visual diff: old (`eval-out/audit25-baseline/*-sheet.png` and `*-NN.png`,
  rendered by the OLD engine at generation time) vs new
  (`eval-out/audit25-olddecks/*-sheet.png` and `*-NN.png`, rendered just
  now by the code on this branch) — read side by side. Third heavy slot
  (reserved for a test file) was not needed; the pixel comparison was the
  decisive check, so it was left unused.

## Per-deck table

| deck | slides | text layers OOB | overflow (strict formula) | overflow visually confirmed | bare numbers | classification | editor ops (4 mutating) | set-same / undo round-trip | delivered |
|---|---|---|---|---|---|---|---|---|---|
| defense-14 (formal) | 14 | 0 | 4 flagged | **0** — spot-checked all 14 slides full-deck, pixel-identical except §A | 13 | all legit (agenda row badges 01-05, `steps[i].n` 1-4, refs row badges 01-04) | OK, untouched slides byte-identical | fails deepEqual — §B only | `undefined` → no refund |
| lecture-12 (academic) | 12 | 0 | 3 flagged | **0** — spot-checked s2 (section) | 12 | all legit (agenda 1-5, `steps[i].n` 1-4, refs 01-03) | OK | fails deepEqual — §B only | `undefined` → no refund |
| lesson-10 (circle) | 10 | 0 | 3 flagged | **0** new overflow; **1 pre-existing** unrelated defect — §C | 14 | all legit (agenda 1-4, card badges 1-3, `steps[i].n` 1-3, stat value "2") | OK | fails deepEqual — §B only | `undefined` → no refund |
| min-4 (academic) | 4 | 0 | 1 flagged | **0** — spot-checked s2 (section) | 6 | all legit (agenda 1-6) | OK (layout-convert step skipped: deck has no `layout:"bullets"` slide, only 4 slides total — not a bug) | fails deepEqual — §B only | `undefined` → no refund |
| open-lesson-pro-12 (circle) | 12 | 0 | 3 flagged | **0** — spot-checked s11 (closing) | 13 | all legit (agenda 1-4, card badges 1-3, `steps[i].n` 1-3) | OK | fails deepEqual — §B only | `undefined` → no refund |
| report-8 (dashboard) | 8 | 0 | 1 flagged | **0** — spot-checked s5 (section, the biggest flagged case) | 6 | all legit (agenda 01-03, stat values 2/4/12) | OK | fails deepEqual — §B only | `undefined` → no refund |

"editor ops (4 mutating)" = text edit on a bullet, layout `bullets`→`process`,
insert a slide, `set` with the same slide — each checked for: op succeeds,
array lengths don't shrink, and every **untouched** slide is byte-identical
before/after (`JSON.stringify` deep-equal) — the W7 guarantee
(`af45abb`/`fbd3fdb`). All 24 mutating-op checks (4 × 6 decks) passed. The
5th check per deck (undo round trip via `inverseOps`) is where §B shows up.

## §A — the one expected, documented difference

`SlideModel.plan?: number` (`lib/generation/slide-types.ts:69-75`) doesn't
exist in any of the 6 old `doc_json` files. `planNumber()`
(`lib/generation/slide-layout.ts:814-818`) returns `null` for all their
`section`/kicker-numbered slides, so the big "03"/"06" decorative number
disappears and the freed column is reclaimed by the title (each visual's
own `no ? … : …` branch — `visuals/academic.ts:135-141`,
`visuals/formal.ts:109`, `visuals/dashboard.ts:147`, `visuals/circle.ts:154`).
Confirmed pixel-for-pixel on defense-14's full 14-slide deck and spot
checks on the other 5 (`eval-out/audit25-baseline/*-NN.png` vs
`eval-out/audit25-olddecks/*-NN.png`, e.g. `defense-14-03.png`,
`min-4-03.png`, `report-8-06.png`). This is exactly the documented AUDIT-25
P2 decision (`docs/AUDIT-25.md`, commit `042b547`/`d05550e`). Nothing else
differs on any of the 6 decks' full-resolution renders that were checked.

**Bare 1-2 digit numbers** (`lib/generation/slide-layout.ts` `planNumber`-
style leaks are what this check hunts for): 54 total hits across the 6
decks, **all classified as legitimate content**, none are decorative
deck-index leaks:
- agenda-row ordinals (`visuals/*.ts planAgenda`, `String(i+1)` local
  index, e.g. `visuals/circle.ts:261` `pushBadge(...String(i+1)...)`) —
  card/row badges, not `s.plan`;
- `steps[i].n` — process-step numbers, real content data
  (`SlideModel.steps[].n`), independent of `s.plan`;
- `stats[i].value` — real numeric stat values (e.g. "2", "4", "12", "88%"
  rendered as content, not decoration).

## §B — editor round-trip: `footer`/`kicker`/`subtitle` empty-string key dropped by `sanitizeSlideModel`

**Not old-deck-specific — reproduces on any doc, old or new.** All 6 old
decks store `"footer": ""` on every slide (`deckFooter()` returns `""`
when `meta.author`/`position`/`organization` are all empty —
`lib/generation/slide-identity.ts:14-19` — and this same convention is
used for freshly-generated decks too, e.g. `slide-write.ts`
`beatToSlide`/`normalizeSlide` thread the same `footer: string` through).

`sanitizeSlideModel` (`lib/generation/slide-edit.ts:716`), which every
`"set"`/`"insert"` op (and the inverse of a `"set"`/`"insert"`) runs a
slide through, drops the key entirely when the string is empty:

```
lib/generation/slide-edit.ts:736   const kicker = str(o.kicker, SLIDE_LIMITS.kicker);
                                    if (kicker) out.kicker = kicker;
lib/generation/slide-edit.ts:738   const subtitle = str(o.subtitle, subtitleMax(layout));
                                    if (subtitle) out.subtitle = subtitle;
lib/generation/slide-edit.ts:740   const footer = str(o.footer, FOOTER_MAX);
                                    if (footer) out.footer = footer;
```

Reproduced directly: applying `{op:"set", index, slide: doc.slides[index]}`
(setting a slide to **itself**) on any of the 6 decks is not a no-op at the
JSON level — the untouched `footer: ""` key vanishes:

```
before: { "id":"s2", "layout":"agenda", ..., "footer": "", "bullets":[...] }
after:  { "id":"s2", "layout":"agenda", ...,               "bullets":[...] }   // "footer" key gone
```

This is why the 5th check (`inverseOps` round trip:
`apply(apply(doc,ops), inverse) === doc`) fails on all 6 decks — the
documented contract at `lib/generation/slide-edit.ts:1090` ("`apply(apply
(doc, ops), inverseOps(doc, ops))` = `doc`") is violated whenever a slide
carries an explicit empty-string `kicker`/`subtitle`/`footer`, because the
inverse of `"set"`/`"insert"` re-runs the same slide through
`sanitizeSlideModel`. `tests/slide-edit.test.mts`'s own round-trip tests
don't catch this because their hand-written fixtures never set these
fields to `""` (they leave them `undefined`).

**Severity: cosmetic, not a "ko'rdim = oldim" break.** Every consumer reads
these fields with `||`/truthiness (`pushFooter` —
`lib/generation/slide-layout.ts:302`: `text: s.footer || ""`), so
`footer: ""` and an absent `footer` key render **identically** in both
PPTX and the viewer. No pixel difference was found anywhere this
propagates. It's a genuine gap in the documented round-trip invariant
(worth a follow-up ticket + a `roundTrip` test case with an explicit
empty-string field), not an old-deck risk and not something this branch
changed — the same `sanitizeSlideModel` shape existed before AUDIT-25.

## §C — pre-existing (not AUDIT-25, unchanged) defect: `circle.ts` twoCol card header overlaps first bullet

`lesson-10` slide `s6` (`layout:"twoCol"`, visual `circle`): the card
header (`leftTitle`/`rightTitle`, two lines: e.g. "Yorug'lik bosqichi" /
"(Tilakoidda)") visually overlaps the first list item's text in **both**
the OLD render (`eval-out/audit25-baseline/lesson-10-07.png`) and the NEW
render (`eval-out/audit25-olddecks/lesson-10-07.png`) — same geometry,
same overlap, present identically before this branch. Confirmed
`visuals/circle.ts`'s twoCol card-header/list spacing wasn't touched by
any AUDIT-25 commit (`git log e89c7c1..HEAD -- lib/generation/visuals/circle.ts`
touches other functions only). Flagging for a separate ticket — **out of
scope for old-deck compatibility** since it's not something re-rendering
changed; the customer already saw this in their original deck.

## Overflow formula false positives (explained, not a risk)

The probe's strict `layerFits`-style check (mirroring
`lib/generation/slide-quality.ts:254-263`, which uses `CHAR_EM_BOLD` for
bold layers) flagged 15 "overflow" text layers across the 6 decks — all
15 are `bold:true` **title** layers in `section`/`bullets`/`closing`/
`twoCol` layouts. Spot-checked the largest offenders in every visual used
by the 6 decks (`defense-14-14.png` closing 40% over, `lecture-12-03.png`
section 49% over, `min-4-03.png` section 96% over, `open-lesson-pro-12-12.png`
closing 32% over, `report-8-06.png` section 96% over) against the actual
rasterized pixels: **zero visible overflow, clipping, or wrapping beyond
what the box was sized for** in any of them. Root cause: several visuals'
own box-sizing math (e.g. `visuals/academic.ts:141,144`
`inkHeight(s.title, tw, titleSize)`) calls `inkHeight` **without** the
`em` argument, defaulting to non-bold `CHAR_EM` (0.55) even though the
title layer renders `bold:true`, while `slide-quality.ts`'s own canonical
`layerFits` (used for generation-time budgets) is bold-aware
(`CHAR_EM_BOLD` = 0.60). This is an internal formula inconsistency
pre-existing on this branch, **not** something that differs between old
and new docs (same code path renders any title, old-engine or freshly
generated) — worth a follow-up ticket if the team wants the two formulas
reconciled, but it produced no observed defect on real decks.

## Delivered / refund

`deliveredCount(doc.meta, doc)` (`lib/generation/delivered.ts:261`)
returns `undefined` for all 6 decks — full delivery, `refundRatio` `null`
→ no refund triggered by a re-render. `doc.slideImages` (image-delivery
report) is present and unchanged in all 6 `doc_json`; nothing about
re-rendering touches `doc.meta`/`doc.slideImages`, so this is deterministic
and doesn't depend on the render path.

## Artifacts

- Probe report (raw): `eval-out/audit25-olddecks/probe-report.json`
- New PPTX (re-rendered by this branch's `renderPptx`):
  `eval-out/audit25-olddecks/{defense-14,lecture-12,lesson-10,min-4,open-lesson-pro-12,report-8}.pptx`
- New rasters + contact sheets: `eval-out/audit25-olddecks/*-NN.png`,
  `eval-out/audit25-olddecks/*-sheet.png`
- Old rasters + contact sheets (generation-time, OLD engine):
  `eval-out/audit25-baseline/*-NN.png`, `eval-out/audit25-baseline/*-sheet.png`

## Verdict

**SAFE.** Re-rendering the 6 real OLD-engine decks through the NEW layout
code changes exactly one thing — the documented, intentional removal of
the deck-index/plan number from section/kicker/KPI-card slides
(AUDIT-25 P2 decision 4) — confirmed pixel-for-pixel. No out-of-bounds
layers, no visually-confirmed overflow, no decorative-number leaks, no
refund triggered, and the 4 mutating editor ops (text edit, layout
convert, insert, set) never shrink or touch untouched slides on any of
the 6 decks. "Ko'rdim = oldim" holds for existing customer decks.

**Risks (verbatim, both low severity, neither old-deck-specific, neither blocking):**

1. `lib/generation/slide-edit.ts:736,738,740` (`sanitizeSlideModel`) drops
   the `kicker`/`subtitle`/`footer` key entirely when the value is an
   empty string, instead of preserving it as `""`. This breaks the
   documented `apply(apply(doc,ops), inverseOps(doc,ops)) = doc` contract
   (`lib/generation/slide-edit.ts:1090`) at the strict-JSON level whenever
   a slide has an explicit empty-string field — true of every one of the 6
   old decks (`footer: ""` throughout) and equally true of freshly
   generated decks (same `deckFooter()` convention). Cosmetically inert
   (`lib/generation/slide-layout.ts:302` `s.footer || ""` — every consumer
   already treats `""` and absent as the same), so no rendered pixel
   differs, but it's a real gap versus the documented invariant and
   `tests/slide-edit.test.mts`'s round-trip suite doesn't cover it because
   its fixtures never use an explicit `""` field. Recommend: either treat
   `""` as a meaningful value in `sanitizeSlideModel` (write `out.footer =
   footer` unconditionally when `o.footer` was a string) or add a
   `roundTrip` test case with `footer: ""` to lock the current (harmless)
   behavior intentionally.
2. `lib/generation/visuals/academic.ts:141,144` (and likely the analogous
   spots in `dashboard.ts`, `formal.ts`, `circle.ts`, `story.ts`,
   `editorial.ts`, `rail.ts`, `split.ts` — not individually re-checked)
   size a **bold** title's box via `inkHeight(s.title, tw, titleSize)`
   without passing `CHAR_EM_BOLD`, while `lib/generation/slide-quality.ts:254-263`'s
   canonical `layerFits` (the formula this probe mirrored) is bold-aware.
   On the 6 real decks this produced no visible defect (checked the
   largest flagged cases directly against the rasterized PNGs — all clean),
   but the two formulas disagreeing is a latent inconsistency worth
   reconciling in a follow-up, independent of old-deck compatibility.

Both risks apply equally to old and new decks and neither changes what a
customer sees when their existing deck is re-rendered — filed here
because the probe surfaced them, not because they threaten "ko'rdim =
oldim" for old decks specifically.
