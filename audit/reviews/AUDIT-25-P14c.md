# AUDIT-25 P14c review — follow-up to the P14 review (C1–C3, C5–C9)

Reviewer: independent (read-only). Commits `97aa266..18873f4` on `slides-3`:
`09b57db`/`7e6c389` (P14c-C, C9), `1e317e1`/`a104b06` (P14c-A, C1 C2 C3 C5 C6), `9bd6c09`/`18873f4` (P14c-B, detector
slack, C7 C8, cover guard). Previous review: `audit/reviews/AUDIT-25-P14.md`. C4 (image count) and C10 (repair-cap
priority) were deferred to the owner and are not re-reviewed here.

## Verdict: CHANGES (1 × P2 must-fix; 1 × P2 recommended; the rest are P3)

The P14 findings are fixed, with one partial (C6: the decision is not written down). The A+B merge fits together:
both sides use the same `clippedAt`, the same caps, and the same `layout === "title"` guard. B's `range()` change
leaves every prompt **max** unchanged, so the P8 invariant still holds, and on every reachable count the detector
threshold stays ≤ the prompt min.

There is one new problem. The system-prompt wording that fixed C3 for clipped slides now contradicts the requests
for genuinely **thin** slides (N1). This is the same class of bug as C3, and the fix is cheap. The detector slack
also goes further than the live evidence supports on the smallest boxes (N2).

`tests/slide-quality.test.mts`: 60/60 pass at `18873f4` (one gated run).

## Per-finding status

| # | Sev | Status | Evidence |
|---|-----|--------|----------|
| C1 | P1 | **fixed** | `mergeRepair` → `clippedOnly(reasons)` → `mergeClipped`/`byPosition` (`slide-quality.ts:760-767, 849-902`). Count lock (`raw.length !== orig.length` → null). Non-clipped items kept byte-for-byte. Title handled separately from the body. `requestFields` (`:1054`) asks only for the clipped lists, and a title-only block slide gets `{"index":i,"title":""}`. Tests: 1-item reply rejected, rewritten non-clipped item ignored, twoCol one side only, process, title-only. Residual risk: N5. |
| C2 | P2 | **fixed** | `clippedFields` (`:602`) and `titleClipped` (`:785`) both skip `layout === "title"`. B's test checks that the cover has no reasons, and A's test checks that the cover alone causes no LLM call. The `repairThinSlides` filter (`:1095`) is now unreachable (N6). |
| C3 | P2 | **fixed for clipped slides**; new contradiction for thin slides → N1 | «title O‘ZGARMAYDI» is gone. «chuqurlashtiring» is emitted only when a non-clipped reason exists (`:1117-1119`), with prompt assertions in the title test. |
| C5 | P2 | **fixed** | Thin path: `mergeBody` clips each side at its own count (`:960`). Clipped path: `mergeClipped` clips at `clipLimit(…, list.length, …, NO_IMAGE)` per side. This matches the writer's `col()` and `clippedFields`. Tests: bold 3+2 thin reply; 1–4 circle 2+1 block. |
| C6 | P2 | **partially** | A per-slide `console.warn` gives the index, the layout, and the remaining reasons or "javob yaroqsiz"/"javobda yo‘q" (`:1164-1178`). Test C6 covers all three kinds. Missing: `docs/AUDIT-25.md:89` says "rad sabablari logda" but does not record the **decision** that a thin repair which overshoots the box is now rejected rather than accepted with "…". The acceptance rate is still unmeasured, which needs a live run (owner). |
| C7 | P3 | **fixed** | `clippedAt` threshold is `⌈0.6·(cap−1)⌉ − CLIP_TAIL_SLACK(2)` (`:573-576`). `clipTo` strips `[\s,;:.!?–—-]+` and adds 1 "…", so it covers up to 3 stripped chars (for example "so‘z, —"). The test pins the " —" case at `k−1`. The brief does not add "«…» bilan tugatmang", which was optional. |
| C8 | P3 | **fixed** | `TITLE_WORDS.max = ⌊TITLE_CHARS / 9⌋ = 6` (`:101`). The test asserts `max × 9 ≤ TITLE_CHARS` and fails if `max` is set to 7. `agendaWordsCap ≤ ⌊0.85·72/9⌋ = 6`, so the claim that the agenda cap is narrower still holds. One hard-coded "3–7" was missed: N3. |
| C9 | P3 | **fixed** | `thinIssues` drops `clipped-text` (`scripts/slide-audit.mts:191`), so the summary `thin=` no longer counts clipped text. Two tests. Coverage gap: N7. |

## Probes (1 530 combos: 15 audiences × 3 volumes × lecture/lesson × 17 visuals, gated `tsx`)

- **P8 max invariant:** `colItem.max`, `stepTextBy[n].max`, `quote.max`, `sectionSubtitle.max` and `bullet.max`
  are all identical before and after. B changed only the lower bounds. The P8 (a) test still checks
  `≤ 0.85 × writer clip`.
- **Detector ≤ prompt min on every reachable count:** 0 violations. This covers colItem for every
  `n ∈ [2, maxColItems]`, not just `maxColItems`, and stepText for every `n ≤ stepsMax` that has a prompt range.
  The `detFloor` term in `range()` is what guarantees this: a text that follows the prompt range is never flagged.
  **The deviation is sound.**
- **How far the detector dropped (reachable counts only):**
  - bullet.min fell by 1–4 words in about 800 combos. For example 15→11 at cap 15, 13→9 at cap 13, and 9→6 at
    cap 9.
  - **119 audience/volume/visual combos now have bullet.min ≤ 4.** `school_1_4/qisqa/*` (all 17 visuals) and
    `auto/{standart,kop}/editorial` go to **3–5**; `auto/qisqa/*` goes to 4–6.
  - `rail` stepText (n = 3) for young audiences goes from 5 to **3**. `school_1_4/*/{circle,dashboard}` colItem
    (n = 2) goes from 5 to **3**. → N2.
- **Quote side effect:** all 180 `magazine`/`bold` combos changed, from «10»→«7–10», «9»→«6–9» and «11»→«8–11».
  120 of them are now below `QUOTE_MIN_WORDS` (8). Section and closing subtitles are unchanged today; the risk
  there is latent. → N4.

## New findings

**N1 (P2, must-fix, `a104b06`) — the repair prompt now tells thin slides to keep their item count and wording.**
- The system prompt always emits `Tegilmagan (kesilmagan) bandlarni so‘zma-so‘z, o‘sha son va tartibda qaytaring.`
  (`slide-quality.ts:1121`). The line applies to *all* non-clipped items. It is emitted even when every candidate
  is a thin slide with no clipped text.
- A `few-bullets` slide gets two conflicting instructions: the per-slide "band kam — 3–5 ta band yozing" and the
  system-wide "o‘sha son … so‘zma-so‘z".
- A mixed slide (`["clipped-text","few-bullets"|"short-bullets"]`) gets the conflict **in its own reason line**.
  `REASON_TEXT["clipped-text"]` (`:1026`) says "bandlar SONI va TARTIBI o‘zgarmasin, kesilmagan bandlarni
  so‘zma-so‘z qaytaring". The neighbouring reason asks for more or rewritten items, and `mergeBody` then takes the
  whole list anyway.
- A model that obeys the count lock returns the same few or short items, and `thinReasons(merged)` rejects them.
  This is C3 again, now hitting the main use case (really thin plan slides).
- The test "yupqa + kesilgan slayd — butun ro'yxat modelniki" checks only the merge, not the prompt.

Fix:
- Emit `:1120-1121` only when `thin.some(({reasons}) => clippedOnly(reasons))`, and reword them to «FAQAT kesilgan
  slaydda …».
- Give the `clipped-text` reason access to the slide's reasons (pass `reasons` into `REASON_TEXT`, or compute
  `clippedOnly(thinReasons(s, …))`). Drop the "SONI va TARTIBI … so‘zma-so‘z" clause when the slide also has a thin
  reason, and say instead «kesilgan bandni ham qutiga sig‘adigan qilib yozing».
- Tests:
  - all-thin deck → system prompt has no `o‘sha son`;
  - mixed slide → its reason line has no `SONI va TARTIBI`;
  - clipped-only slide → both are still present.

**N2 (P2, recommended, `9bd6c09`) — `slackMin` rounds down, so the smallest boxes get 40 % slack and 3-word items
pass.**
- `slackMin = min(floor, max(1, ⌊0.75·cap⌋))` (`:125-127`) gives cap 5 → 3 (−40 %), cap 6 → 4 (−33 %) and
  cap 8 → 6 (−25 %).
- The live evidence (cap 8: 7-word bullets fit) supports 1–2 words of slack. It does not support letting grade 1–4
  "qisqa" decks average 3-word bullets. The prompt now also **asks** those decks for «3–5 so‘z», where it asked
  for «5» before.
- Same effect on `rail` steps and 1–4 circle/dashboard 2-item columns (5 → 3).

Fix:
- Use `Math.round(cap * DETECTOR_SHARE)`, which gives 5 → 4, 6 → 5, 7 → 5, 8 → 6, 9 → 7, 12 → 9 and 3 → 2. This
  keeps the live case at 6 (7-word bullets are still accepted), keeps every range open for max ≥ 3 (B's property
  test still applies), and raises the young-audience floor to 4.
- Alternatively, put a floor on it: `max(⌊0.75·cap⌋, min(cap − 1, 4))`.
- The existing `slackMin` unit examples give the same values under round. Add an assertion that
  `school_1_4/qisqa` bullets are «4–5».

**N3 (P3, C8 residual) — `structure.ts:117` still hard-codes «3–7 so‘z» for plan-item names when there is no
agenda.**
- 7 × 9 = 63 > `TITLE_CHARS` (61). This is exactly what C8 removed from `TITLE_WORDS`.
- These are plan-slide titles, and `clippedFields` never repairs them. A 7-word title clipped with "…" stays
  clipped.

Fix: `fmtRange({ min: 3, max: TITLE_WORDS.max })` (→ «3–6»). Add a prompt assertion.

**N4 (P3, `9bd6c09`) — the slack rule also applies to fields with no detector (quote, closing) and to section with
the wrong floor.**
- `range()`'s default `detFloor = floor` means every caller gets slack, not just the detector fields.
- The slack exists because of prompt-vs-detector zero slack. `quote` has no detector, so it only loses its
  documented prompt floor: `QUOTE_MIN_WORDS` = "Iqtibos uchun PROMPT poli", yet 120 combos are now «6–9»/«7–10».
- `sectionSubtitle` has a detector (6) but passes `detFloor = 12`. If any box ever gives cap ≤ 7, the prompt min
  becomes ⌊0.75·7⌋ = 5 < 6, and prompt-compliant subtitles get flagged `empty-subtitle`. That is latent today (no
  combo changed), but nothing guards it.

Fix:
- Make `detFloor` optional and apply the slack only when it is passed:
  `lo = detFloor === undefined ? floor : max(slackMin(floor, max), slackMin(detFloor, cap))`.
- Pass `SECTION_SUBTITLE_MIN_WORDS` for section. Quote and closing keep their old ranges («10»/«9»/«11»).
- Add a property assertion: `quote.min ≥ min(QUOTE_MIN_WORDS, quote.max)` and `sectionSubtitle.min ≥ 6`.

**N5 (P3, `a104b06`) — `byPosition` accepts any non-empty replacement for a clipped item (`:857`).**
- The count lock protects the *other* items. The clipped item itself can come back as «Ha.» or an unrelated
  sentence.
- On plan slides, `short-bullets` sometimes catches this. On block slides (goals/homework) nothing does.
- Dropping `samePrefix` is justified (shortening rephrases). Dropping its length floor is not.

Fix: require `words(next) ≥ min(words(orig) − 1, ⌈0.5 × target.max⌉)` or `next.length ≥ 0.4·cap`. Add a test where
a 1-word reply for a clipped goal is rejected.

**N6 (P3) — duplicate and dead code from the A+B merge.**
- The filter `out[index].layout === "title" && clippedOnly(reasons)` (`:1095`) can never match: a `title`-layout
  slide has no reasons at all, because `clippedFields` excludes it and no other rule applies. So A's C2 test passes
  whether the filter is there or not. Delete it, or keep it with a comment that says it is a defensive duplicate.
- `clippedFields` (`:600`) and `clippedBodyKeys` (`:813`) implement the same per-layout clip test twice. The caps
  and filters are identical today: bullets filtered, process unfiltered, columns per side filtered. The inline
  title test also repeats `titleClipped`.
- Build `clippedFields` from `clippedBodyKeys` + `titleClipped`, so the two cannot drift.

**N7 (P3, C9 side effect) — some clipped fields are now reported nowhere.**
- `pushTrunc` matches `TRUNCATED_RE = /\p{L}(…|\.\.\.)\s*$/u` (`slide-audit.mts:106`), which needs a *letter*
  before "…".
- `clipTo` can end on a digit, "»", ")" or "³", for example "… 1960…" or "… km³…". `clippedAt` catches those, but
  since `clipped-text` is now filtered they drop out of the audit entirely.

Fix: widen the regex to `[\p{L}\p{N}\p{Pe}\p{Pf}\p{No}]`, or drop `clipped-text` only for slides where `pushTrunc`
reported something. Optional: `clipped-option` is still counted twice, the same way C9 was.

**N8 (P3) — tests.**
- `assert.equal(DETECTOR_SHARE, 0.75)` (`tests/slide-quality.test.mts:1182`) and
  `TITLE_CHARS <= PROMPT_HEADROOM * SLIDE_LIMITS.title` (`:883`) only restate definitions, which is the pattern C8
  asked to remove. Drop both; the `slackMin(8,8) === 6` example and `max × 9 ≤ TITLE_CHARS` already fail under
  mutation.
- The P14c-B property test checks colItem only at `maxColItems` (`:1211`). Loop `n ∈ [2, maxColItems]`, since that
  is where a smaller count raises the detector. The probe shows it passes today, so this only guards against
  regressions.

## Consumers checked (grep over `lib/`, `scripts/`)

- `TITLE_WORDS`: `slide-prompt/base.ts:19` shows «4–6, ≤ 61», which is consistent. `structure.ts:106` is
  consistent (agenda cap ≤ 6). `structure.ts:117` is not → N3.
- `layoutWordTargets(...).bullet`: `brief.ts:20,42` prints `${min}–${max}` raw, not `fmtRange`. Since
  `slackMin < cap` for cap ≥ 2, it never prints "N–N". `thinReasons` reads the same `bullet.min`.
- `bulletMinWords` / `COL_MIN_WORDS` / `STEP_MIN_WORDS`: no reader outside `slide-quality.ts`. `slide-write.ts`
  reads only `layoutWordTargets` counts (`maxColItems`, `maxSteps`, …), whose maxes are unchanged. `slide-audit.mts`
  reads `thinSlides`, which is consistent after C9.
- `colMinWords`, `stepMinWords`, `slackMin`, `DETECTOR_SHARE`, `CLIP_TAIL_SLACK`: used only in `slide-quality.ts`
  and its tests.
