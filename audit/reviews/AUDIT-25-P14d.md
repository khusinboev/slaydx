# AUDIT-25 P14d review — follow-up to the P14c review (N1–N8)

Reviewer: independent (read-only). Commits `7b05381..1cebf93` on `slides-3`:
`49ad0de`/`fc6de83` (P14d-C, N7), `4644802`/`c99e080` (P14d-A, N1 N5 N6), `4d14a39`/`1cebf93` (P14d-B, N2 N3 N4 N8;
the test file is B's version with A's block appended). Previous review: `audit/reviews/AUDIT-25-P14c.md`.
HEAD at review time was `b1cc7e1`, which is a docs-only commit (`docs/AUDIT-25.md` row). No reviewed file changed
after `1cebf93`.

## Verdict: APPROVE (no P1/P2 left; 3 new P3 findings, all optional)

Both P2 findings are fixed.
- **N1:** the count lock now reaches only clipped-only slides, in both the system prompt and the per-slide reason
  line. Tests assert both directions.
- **N2:** `slackMin` now rounds. The live case stays at 6. Young-audience column and step floors go from 3 to 4.

The agents made two deviations. Both are justified (see below).

The merge is coherent:
- A's `REASON_TEXT` signature (`reasons` as the 5th argument) reads B's `clippedFields`, which this range left
  unchanged.
- `mergeClipped` gets its word target from the same `clippedFields` entry that the prompt prints (`f.words`).
- Nothing is defined twice.
- `slackMin` has four callers, all in `slide-quality.ts`: `bullet.min`, `range()`, `colMinWords` and
  `stepMinWords`. There is no consumer outside that file.

`tests/slide-quality.test.mts`: 69/69 pass at `1cebf93` code (one gated run, 6.7 s).

## Per-finding status

| # | Sev | Status | Evidence |
|---|-----|--------|----------|
| N1 | P2 | **fixed** | **System prompt:** the count-lock line is emitted only when `thin.some(clippedOnly)`, reworded to «FAQAT kesilgan slaydda …» (`slide-quality.ts:1174-1177`). **Reason line:** `REASON_TEXT["clipped-text"]` now takes the slide's full `reasons` (`:1070-1077`). A clipped-only slide keeps «SONI va TARTIBI … so‘zma-so‘z». A mixed slide gets «qayta yozishda kesilgan bandni ham qutiga sig‘adigan qilib yozing». **Tests:** mixed slide → no `SONI va TARTIBI` / `so‘zma-so‘z` / `o‘sha son`, and «chuqurlashtiring» is present; all-thin deck → no lock; clipped-only slide → lock in the system prompt and in the reason line, no «chuqurlashtiring»; mixed deck → split per slide block. This matches the P14c fix list exactly. |
| N2 | P2 | **fixed** (deviation justified) | `Math.round` (`:133-135`). New results: cap 5→4, 6→5, 8→6 (live case unchanged), 3→2. The only closed range is cap 2 («2–2»), which is documented. **Property test:** a box of ≥ 5 words never gets a floor < 4 from slack, checked for prompt and detector, every column count, every step count, 15 audiences × 3 volumes × 2 templates × all visuals. **Exact-number test:** 1–4 circle bullet/colItem and rail step×3 are all «4–5». **Deviation (1–4 «qisqa» bullets stay «3–5») is justified:** `bulletChars` = round(80 × 0.72) = 58, so `bulletMinWords` = ⌊58 × 0.55 / 8⌋ = ⌊3.99⌋ = 3. The pre-P14c formula `min(bulletMinWords, cap)` also gave «3–5». P14c's claim that this used to be «5» was wrong for bullets. The claim held only for rail/circle `range()`, and those now give 4. The floor of 3 is the audience setting, not slack. Owner question (optional): at 3.99 the floor sits right on the boundary. `THIN_BULLET_K` or rounding is a product decision. |
| N3 | P3 | **fixed** | `structure.ts:121`: `fmtRange({ min: 3, max: TITLE_WORDS.max })` → «3–6». Test parses the line and checks `hi × CHARS_PER_WORD ≤ TITLE_CHARS`. No other hard-coded «3–7» remains (grep over `slide-prompt/`, `slide-quality.ts`, `slide-write.ts`). |
| N4 | P3 | **fixed** | `range(…, detFloor?)`: slack applies only when `detFloor` is passed (`:449-451`). Only `colItem` (`COL_MIN_WORDS`) and `stepRange` (`STEP_MIN_WORDS`) pass it. Quote, section and closing are back to the old rule. `sectionSubtitle`: floor 12 with no slack gives `min ≥ min(6, max)`, so compliant text is never flagged `empty-subtitle` unless the box itself holds fewer than 6 words. No fix exists for that case. Property test covers quote ≥ `min(QUOTE_MIN_WORDS, max)` and section ≥ `min(6, max)` over all combos. Bachelor magazine/bold quote is back to «10»/«9». |
| N5 | P3 | **fixed** (deviation justified) | `fullEnough` (`:771-773`) requires `words(next) ≥ min(words(orig without …) − 1, ⌈0.5 · maxWords⌉)`, used by `byPosition` (bullets, column sides) and the process branch. **Deviation:** this is the *first* of the two formulas P14c proposed, not a departure from it. The agent's argument against the char rule is correct, and the test pins it: bachelor bullet box 165, prompt minimum 9 words is fewer than ⌈0.5 × 165⌉ chars, so the char rule would reject a compliant shortening. The word floor never exceeds any prompt minimum: round(0.6·m) ≥ ⌈0.5·m⌉ for all m, and `bullet.min/max` ≈ 0.73. **Tests** cover «Ha.» rejected, `need−1` rejected, `need` accepted, prompt-minimum accepted, process «Ha.» and twoCol «Yo‘q.» rejected. Residual: N9. |
| N6 | P3 | **partially** (accepted) | The dead cover filter is removed; a comment explains that C2 now rests on the `clippedFields` guard, and the N6 test checks the cover gives no reasons and triggers no call. The `clippedFields` ↔ `clippedBodyKeys` dedupe is **not done**. A `TODO(P14c sharhi N6)` is left at `:842-845`. The two are identical today, so this is fine as a tracked TODO. |
| N7 | P3 | **fixed** (small residual → N10) | `TRUNCATED_RE = /[\p{L}\p{N}\p{Pe}\p{Pf}\p{No}](…|\.\.\.)\s*$/u` (`slide-audit.mts:125`). Tests cover digit, «»», «)» and the intentional «1/2 + 1/4 = …» (not flagged). The optional `clipped-option` double count is not addressed; it was optional. |
| N8 | P3 | **fixed** | **Removed:** `DETECTOR_SHARE === 0.75`. **Replaced:** `TITLE_CHARS ≤ 0.85 × title` is now a behavioural check (a `TITLE_WORDS.max`-word title passes `clipTo` unchanged); `max × 9 ≤ TITLE_CHARS` still catches max = 7. **Loop:** the colItem property loop now runs `n ∈ [COL_MIN_ITEMS, maxColItems]` for both the prompt `le` and the detector behaviour. **Added:** `slackMin(8,5)=4`, `(8,6)=5` and `(12,12)=9`, which fail under `Math.floor`. |

## Invariants re-checked

- **P8 (prompt max ≤ 0.85 × writer clip):** N2 and N4 change only the lower bound, and every `max` expression is
  byte-identical. `slide-limits.ts` (`clipLimit`, `clipTo`, `fitChars`) is not touched in the range.
  `layoutWordTargets` range test now iterates **all** visuals (`LEGACY_VISUALS + DESIGN_VISUALS`), not five.
- **P11 (prompt clip ≡ writer clip):** `mergeClipped` still clips with `bulletClipLimit` and
  `clipLimit(…, NO_IMAGE)` at the slide's actual per-side count. `fullEnough` only adds a rejection and never
  changes a clip.
- **Detector ≤ prompt min:** holds on every reachable count. The property test now loops every column count, and
  N2's rounding is applied identically on both sides through `slackMin`.
- **Acceptance loop** (`:1231-1240`): a slide is accepted only if `merged !== null` and `thinReasons(merged)` is
  empty.
  - `thinReasons` re-runs `clippedFields`, which covers every layout except the cover.
  - Any reply longer than the writer cap goes through `clipTo`, gains «…» at length ≥ the `clippedAt` threshold,
    and so returns `clipped-text`. **A writer-clipped slide cannot be accepted.**
  - Thin plan slides are re-checked with the same `bullet.min` / `colMinWords` / `stepMinWords` the prompt
    uses. **A still-thin slide cannot be accepted.**
  - Caveat (pre-existing, not writer clipping): a model that *itself* ends a short replacement with «…» below the
    `clippedAt` length threshold is not flagged (see N11).

## New findings (all P3, optional)

**N9 (P3) — the clipped-item word floor is enforced but never stated in the prompt.**
- The clipped-only reason line gives the model only an upper bound: «≤ N so‘z va ≤ M belgi»
  (`slide-quality.ts:1071-1073`).
- `fullEnough` silently rejects anything under ⌈0.5·N⌉ words (`:771`). This is the same prompt-vs-acceptance gap
  class as C3 and N1. The consequence is small: a very terse shortening is logged as «javob yaroqsiz» and the
  original clip is kept.

Fix:
- Print the range in the reason line, e.g. `${fmtRange({ min: Math.ceil(0.5 * f.words), max: f.words })} so‘z`.
  Share one helper with `fullEnough` so the two cannot drift.
- Also, the header comment of the P14d-A test block (`tests/slide-quality.test.mts:1708`) still says
  «⌈0.5 · qopqoq⌉ belgili matn». Update it to the word rule.

**N10 (P3, N7 residual) — `TRUNCATED_RE` still misses clips that end on `%` (and other `Po`/`Sc`/`Sm`/`So`
characters).**
- `clipTo` cuts at a word boundary and strips only `[\s,;:.!?–—-]`.
- So «… o‘sish 50% ga yetdi» clipped after «50%» gives «50%…». `%` is `\p{Po}`, so the audit misses it, while
  `clippedAt` catches it and C9 filtered that engine reason out. Percentages are common on slides.
- Mid-word cuts can also end on «‘» (U+2018, `\p{Pi}`), as in «g‘» or «o‘».

Fix: define the class as the complement of `clipTo`'s strip set:
`/[^\s,;:.!?–—-](…|\.\.\.)\s*$/u`. That covers everything `clipTo` can leave before «…». It still excludes
«Tayyor!...» and «= …». Add a «50%…» test.

**N11 (P3, pre-existing, observation) — two small repair-prompt leftovers.**
- **Always-emitted system line.** `KESILGAN («…») maydonni FAQAT qisqartiring — … yangi fikr qo‘shmang` (`:1173`)
  is emitted even for decks with no clipped slide. For a mixed slide it sits beside «chuqurlashtiring». This is not
  a hard contradiction, because the mixed reason line now says «qayta yozishda … sig‘adigan qilib yozing».
  Emitting the line only when `thin.some(r => r.reasons.includes("clipped-text"))` would tidy it.
- **Model-authored «…».** A replacement that ends with a «…» the model wrote itself, and is shorter than the
  `clippedAt` threshold (⌈0.6·(cap−1)⌉ − 2), passes `thinReasons`. It is accepted even though the prompt says
  «…» yozmang.
- Fix: strip a trailing «…»/«...» from replies before `clipTo`, or reject them, in `byPosition`, `mergeBody` and
  `repairedTitle`.

## Consumers checked

- **`slackMin`:** `bullet.min`, `range()`, `colMinWords` and `stepMinWords` (`slide-quality.ts:451,489,518,523`). No
  other consumer in `lib/` or `scripts/`.
- **`DETECTOR_SHARE`:** its only remaining reader is `slackMin`. The test import was dropped cleanly.
- **`range()` with `detFloor`:** `colItem` (`:491`) and `stepRange` (`:484`). `sectionSubtitle`, `closingSubtitle`
  and `quote` (`:501-504`) call it without `detFloor`.
- **`REASON_TEXT`:** one call site (`:1195`), passing `reasons`.
- **`structureLines`:** the no-agenda title range is now `TITLE_WORDS.max`, consistent with `base.ts:19` and
  `structure.ts:106`.
