# AUDIT-25 P14 review — final live fixes (prose floor, column count, `clipped-text`, title rule)

Reviewer: independent (read-only). Commits `28e9238` and follow-up `e169260` on `slides-3` (base `b31af04`).
Contract: `docs/AUDIT-25.md` §4 (P8 headroom ≤ 0.85 × writer clip, prompt ≡ writer clip, P11 NO_IMAGE writer clip,
D1 "text wins over image"), agenda = plan-slide titles (decision 2).

## Verdict: CHANGES (1 × P1 + 2 × P2 required; 1 × P2 owner sign-off; the rest optional)

(a) and (b) are right and match what the commit message says. `clipped-text` is the right idea and uses the
same limits the writer clips at. The problem is the repair it triggers: it can **delete or rewrite text that was
fine** (C1), and it contradicts itself in two places (C2, C3). `tests/slide-quality.test.mts` passes 44/44 at
`e169260` (one gated run).

## Verified

- **(a) `fitWords` `>`** (`slide-quality.ts@28e9238:365`): at exactly 5 with-image words, prose fields now take the
  no-image box. The P8 invariant still holds: the P8 (a) test is unchanged and still checks every
  audience × volume × visual against `0.85 × clipLimit(…, NO_IMAGE)` / `bulletClipLimit(maxBullets)`.
- **(b) `maxColItems`** (`:419`): `maxCount(…, PROSE_MIN_WORDS+1, …, PROMPT_HEADROOM)` means a count above 2
  always has a with-image box above 5 words. So (a) falls back to the no-image box only at the floor (2). The new
  P11 (c) loop checks both halves: the chosen count carries more than 5 words, and n+1 does not. It is
  spec-level and not a copy of the implementation (the only shared piece is the one-line words formula).
- **Callers of `maxColItems`/`layoutWordTargets`**: `slide-write.ts:152-164 counts()` (writer column cap),
  `coerceLayout` (twoCol from a pool), `mergeRepair` twoCol, `brief.ts:20,50`, `wordTargetLines`. All read the
  same number, so the prompt, writer and repair stay in step. `slide-images.ts` reads only `imageYieldField`.
  `scripts/slide-audit.mts` reads `thinSlides` (see C9).
- **Mirrored caps**: at repair time no images are attached yet, and the writer clips everything with
  `NO_IMAGE`. `clippedText` uses the same functions (`bulletClipLimit`, `clipLimit(…, NO_IMAGE)`) with the
  slide's actual count, per side for columns. That is exactly what `normalizeSlide`'s `col()` and
  `bulletItems()` do (`slide-write.ts:242-245, 414-418`). Identical, with one exception in `mergeRepair` (C5).
- **Editor/commit guard**: `lib/server/slide-commit.ts`, `lib/server/edit-adapters.ts` and
  `lib/generation/slide-edit.ts` do not import `thinReasons`/`thinSlides`/`layoutWordTargets`. `edit-adapters`
  uses only `imageOverflowRatio`/`imageYieldText`, and neither commit touches them. No effect.
- **Agenda (e169260)**: `repairedTitle` (`@e169260:704-708`) and `clippedFields` (`:542`) both check
  `isPlanSlide`. `syncAgenda` → `planHeads` (`slide-write.ts:629-638`) reads only `plan === i` slides (a section
  head carries `plan`). So no repair can change an agenda item, and the `syncAgenda` re-run at
  `slide-write.ts:976` is a no-op for titles.
- **`qaytaring` JSON (e169260 `:902`)**: when `FIELDS[layout]` is undefined and the title is clipped →
  `{"index":i,"title":""}`. When the title is not clipped → `{"index":i,<FIELDS>}`. With both →
  `…,"title":""`. Valid in all cases. A slide can enter `thin` with undefined `FIELDS` only through a clipped
  title.
- **Tests**:
  - The changed tests keep their invariants. P8 CHANGES 1 still catches "`mergeRepair` clips at `bulletChars`",
    because `raw = upTo(100) = bulletChars` would then be accepted unclipped. P8 (4) moved to the only case that
    still has with-image < no-image at `maxColItems`.
  - The new tests are not tautologies. There is one exception: `assert.equal(TITLE_CHARS, floor(0.85*72))`
    restates the definition (C8).

## Image-count magnitude (D1 accepted — numbers for the owner)

Probe over lecture+lesson × 15 audiences × 3 volumes × 17 visuals = 1 530 combos, comparing the old and new
rules. Same `fitChars`/`fieldCap` inputs:

- **Column count lowered in 1 017 / 1 530 (66 %).** Per template (765): 4→3 in 384, 4→2 in 45, 3→2 in 78,
  unchanged in 258.
- **twoCol/compare slides whose target now exceeds the with-image box** (so the image yields): 81 combos, up
  from 18 (+63, ≈4 %). Concentrated in `circle`, `dashboard`, `split` and `story`.
- **`bullets` (the most common layout): 17 lecture combos** where the with-image target was exactly 5 words and
  is now 9–11 words, taken from the no-image box. Examples: `school_1_4/kop/{classic,hero-split,timeline,
  magazine,dense,bold,rail}`, `school_5_7/kop/{lab,academic,bold,rail}`, `school_8_9/kop/lab`, with 61 chars
  with image vs 104 without. In those decks almost every bullets slide will lose its image. → C4.
- `stepText`: no change (no combo lands at exactly 5 with an image; 501 already yielded under P11).

## CHANGES

**C1 (P1, 28e9238 — still present at e169260) — a `clipped-text` repair can silently drop or rewrite good items.**
The reason text says "FAQAT shu bandlarni … QISQARTIRING; qolgan bandlar so‘zma-so‘z qolsin"
(`@28e9238:784-791`). But `mergeBody` replaces the **whole list** with whatever the model returns
(`@e169260:712-716` bullets, `:740-758` columns, process), and nothing checks count or identity:
- **Block slides** (goals/homework, no `plan`) return early in `thinReasons`. If the model reads "FAQAT shu
  bandlarni" as "return only the fixed bullet", the result is `bullets:[<1 item>]`. That passes
  `!thinReasons(merged).length` and **the other goals are deleted**.
- **Plan slides**: 5 → 3 bullets passes whenever `minBullets ≤ 3`. twoCol 3+3 → 2+2 passes `short-columns`.
- e169260 makes this worse. A block bullets slide whose **only** clipped field is the title is asked for
  `"bullets":[""],"title":""`, so its good bullets get re-generated as well.

Fix: when a slide's reasons are only `clipped-text`, merge by position, the way the quiz path does:
- require the returned list length to equal the original's, and reject otherwise;
- keep every item that was not clipped byte-for-byte;
- accept a replacement only for items that were clipped, with a `samePrefix`-style check (a lower share such as
  0.4 is fine, because shortening changes the tail);
- request only the clipped fields (drop `FIELDS[layout]` when only the title is clipped).

Tests:
- the model returns only the shortened bullet → the original is kept;
- the model returns all items but rewrites a non-clipped one → the non-clipped item is unchanged, or the repair
  is rejected;
- a title-only block slide → the bullets are not requested and not changed.

**C2 (P2, e169260) — the cover (`layout:"title"`) is flagged whenever the user's topic is longer than 72 chars,
and the repaired title is then thrown away.**
- The base prompt tells the model to put the user's topic in the title slide. `normalizeSlide` clips every
  title at `SLIDE_LIMITS.title`, and the cover has no `plan`, so `clippedFields` (`:542`) flags it.
- After repair, `slide-write.ts:991-997` overwrites `slides[0].title = meta.topic`. The shortened cover title is
  discarded.
- Cost: a `REPAIR_MAX_SLIDES` slot is wasted. On an otherwise clean deck with a long academic topic, it also
  triggers an **entire extra LLM call** (up to 45 s of the stage budget, plus tokens) for nothing.

Fix: skip `layout === "title"` in both `clippedFields` and `repairedTitle`. Add a test: a cover with a clipped
topic → no reasons.

**C3 (P2, e169260; the 28e9238 half is optional) — the repair system prompt contradicts the new requests.**
- `@e169260:887` still says "layout va title O‘ZGARMAYDI" while the same call asks for a shortened `title`. A
  compliant model echoes the old title back. `repairedTitle` then returns `undefined`, the merge is `null`, and
  the repair is rejected.
- The same line says "Mavjud fikrni chuqurlashtiring — ta’rif, sabab, misol, oqibat". For clipped-only slides
  that pushes the model to write *longer* text, which is then clipped and rejected.

Fix: "layout O‘ZGARMAYDI; title faqat «title» so‘ralgan slaydda qisqartiriladi". Limit the deepening sentence
to thin reasons (for example, emit it only when some slide in `thin` has a non-`clipped-text` reason). Add a
prompt assertion to the new title test.

**C4 (P2, owner sign-off, 28e9238) — image loss on young-audience `kop` decks through `bullets`.**
- (a) was motivated by column and step slack. It also applies to `bullets` (the `PROSE_FIELDS` membership). The
  17 lecture combos above go from a 5-word target with an image to 9–11 words without one, on most slides of
  the deck.
- This is within D1, but it is a visible change for grades 1–9 with "ko‘p" volume.

Fix, if the owner prefers to keep the images: keep the `≥` rule for `bullets`. Remove the zero slack in the
detector instead: use `bullet.min ≤ max − 1` when `max === PROSE_MIN_WORDS`. Otherwise, record the owner's
acceptance in `docs/AUDIT-25.md` (D1 row).

**C5 (P2, 28e9238) — twoCol/compare repair clips both sides at the larger count, and the detector checks per side.**
- `mergeRepair` uses `n = max(left, right)` for both sides (`@28e9238:709`, `@e169260:749`). The writer
  (`slide-write.ts:242-245`) and `clippedText` both use each side's own count.
- When the sides differ, the shorter side is clipped at the tighter `cap(n)`, but checked against `cap(n−1)`.
  `clipTo` output can be as short as ⌈0.6·(cap(n)−1)⌉, which is below the threshold ⌈0.6·(cap(n−1)−1)⌉. The
  result is **"…" accepted**, which is the defect this commit targets. The probe finds 12 combos where this
  always happens (for example `school_1_4/*/{circle,dashboard}`: 2 items → 60, 1 item → 110) and occasional
  misses wherever cap(n) < cap(n−1).
- For plan slides, `short-columns` forces at least 2 items per side, so the 2-vs-1 case reaches only block
  slides.

Fix: clip each side with `clipLimit("colItem", …, side.length, …, NO_IMAGE)`, as the writer's `col()` does. That
also restores writer ≡ repair. Add a test: left 2 / right 1, right over its cap → rejected, or accepted without
"…".

**C6 (P2, 28e9238) — the acceptance rule did change for thin repairs; the commit says it did not.**
- Before: a thin slide whose repair overshot the box was accepted, with clipped items.
- Now `thinReasons(merged)` includes `clipped-text`, so the whole repair is rejected and the slide stays thin.
  The P8 CHANGES 1 test was flipped to lock this in (`tests/slide-quality.test.mts@28e9238:822-829`).
- This is a defensible trade (thin beats "…"?), but it is undocumented and its rate is unmeasured.

Fix:
- On rejection, log `thinReasons(merged)`, not just the `accepted/total` count (`:894`).
- Report the acceptance rate in the next live run.
- Note the decision in `docs/AUDIT-25.md`.

**C7 (P3) — edges of `clippedAt`.**
- False negative: `clipTo` strips trailing `[\s,;:.!?–—-]+` before adding "…" (`slide-limits.ts:507-509`). A cut
  at `"so‘z —"` loses two characters, so the output can be ⌈0.6·(n−1)⌉−1 long, one below the threshold.
- False positive: a sentence with a rhetorical trailing "…" of at least 0.6·cap is treated as clipped. This is
  harmless apart from one repair slot, since a reply that still contains "…" is rejected.

Fix: lower the threshold by 2, and/or add "«…» bilan tugatmang" to the brief.

**C8 (P3, e169260) — the title word bound breaks the P8 rule, and its test is a tautology.**
- `TITLE_WORDS.max = 7` gives 7 × `CHARS_PER_WORD` = 63, which is above `TITLE_CHARS` (61 = 0.85 × 72).
- The test checks against 72 (`tests/…@e169260:873-883`) and then restates `TITLE_CHARS`'s own definition.
- The char cap in the prompt mitigates this.

Fix: `max: 6`, or assert `TITLE_WORDS.max * CHARS_PER_WORD <= TITLE_CHARS` (red at 7 — decide which), and drop
the definitional assertion.

**C9 (P3) — `scripts/slide-audit.mts` counts the same clipped field twice.**
- `pushTrunc` reports it as `truncated` (`:329`), and `thinIssues` reports it again as `thin-clipped-text`.
- The live summary's `thin` count (`:473`) now includes clipped text.

Fix: filter out `clipped-text` in `thinIssues` (`:181`), since truncation already has its own counter.

**C10 (P3) — the `REPAIR_MAX_SLIDES` cap (8) is shared in deck order.**
- `clipped-text` candidates now share that cap with real thin slides (`@e169260:873`).
- Clipped block/references slides early in the deck can push out thin plan slides later in it.

Fix: sort `thin` by priority (plan-slide thin reasons first, `clipped-text`-only last) before the `slice`.
