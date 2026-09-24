# AUDIT-25 P6 review: pro-slide in `deliveredCount` (A3-03)

Commit: `24c44ca` (branch `worktree-agent-a685c700ab7f4e26b`)
Reviewer: independent, read-only
Test run (one, `heavy2.sh -m 2G`): `tests/delivered.test.mts`: 9/9 pass

## Verdict: APPROVE

The claim holds. On the base, `deliveredCount` (`lib/generation/delivered.ts:283`) only had `case "slide"`. `pro-slide` fell through to `default: return undefined`. `lib/generation/index.ts:530-547` builds both tools through the same engine and sets `file.delivered = deliveredCount(meta, slideDoc)`. `lib/server/worker.ts:608` only refunds when `file.delivered` is set, so a short pro-slide deck was always charged in full. The fix is minimal and correct. Nothing in it blocks the merge. The notes below are follow-ups.

## Verification

1. **`want` is the right promise.** `lib/generation/meta.ts:158-161` clamps pro-slide `slideCount` with `clampInt(values.slideCount, PRO_SLIDE_MIN=4, PRO_SLIDE_MAX=30, PRO_SLIDE_DEFAULT=12)`. `meta.ts:224` then stores it in `targetPages` for both `slide` and `pro-slide`. `priceFor` (`lib/tools.ts:1477-1482`) uses the same clamp on the same input: `n * PRO_SLIDE_PER_SLIDE`. So `meta.targetPages` is the count that was paid for. The price and the refund can't drift apart. `wantSlides` (`lib/generation/slide-write.ts:487-491`) caps at `SLIDE_MAX`, which equals `PRO_SLIDE_MAX` (30, `slide-params.ts:50`). The engine therefore aims for the same number: no silent cut to 20, no permanent false shortfall.
2. **The refund ratio is exact for pro-slide.** Worker path: `shortfallRatio` → `refundRatio` (`delivered.ts:117-125`; `refundShare` is unset for `unit: "slayd"`, so share = 1) → `(1 − got/want)`. `refundPartial` (`lib/server/credits.ts:167-175`) applies that to the charge row actually booked. The price is linear (`n × 2000`), so `(want−got)/want × price` = `(want−got) × 2000`. Example: 8 of 10 slides → ratio 0.2 → 0.2 × 20 000 = **4 000 coins**, exactly the price of the 2 missing slides. That's correct. (For plain `slide` the same ratio is only approximate, because its price is flat up to 20 slides. That was already the case and is out of scope.)
3. **Over-delivery.** `delivered.ts:316`: `got >= want` gives `byCount = undefined`. The test checks 12/10 → `undefined`. `refundRatio:120` also returns `null` for `got >= want`. No refund.
4. **Images.** Widening the gate (`delivered.ts:318`) sends pro-slide through `imagesDelivered`. `meta.premiumVisuals` is hard-coded to `false` (`meta.ts:245`), so a partial image shortfall gets `refundShare: 0`: no money, but a `warn` log (`worker.ts:620-624`). When images are completely missing (`got 0`), `refundRatio:121` returns 1 and the full price comes back. This matches `slide` exactly. See the recommendation below.
5. **The tests fail without the fix.** From the diff:
   - Removing `case "pro-slide"` → `default` returns `undefined` → test 1's `deepEqual(…, {got:8,want:10})` goes red. Test 2's `zero` is `undefined` → its `deepEqual` goes red.
   - Adding the case but keeping the old gate (`!== "slide"`) → image test: `byCount` is `undefined` (10/10) and gets returned before `imagesDelivered` → red. So the gate change is locked too.
   - The regression test (`slide`) stays green under both mutations, which is what we want.
   - No existing test locks `undefined` for pro-slide: `grep pro-slide tests/` near deliver/refund/shortfall finds nothing. The only pro-slide hit in `document.test.mts:600-619` is about topic legends.
6. **No other tool is missing from the switch.** The tool ids that promise a count or images (`lib/tools.ts`) are all handled elsewhere:
   - `image`: `packImages`
   - `infographic`: `infographicDelivered` inside its engine
   - `crossword` / `flashcards`: `gameDelivered`
   - `glossary` / `keys` / `texnologik-xarita` / `test`: `teacherDelivered`, plus the legacy switch
   - The rest (`coursework`, `referat`, `essay`, `article`, `thesis`, `resume`, `translation`, `mustaqil-ish`, `lesson-plan`, `sorting`, `listening`, `podcast`, `greeting`): their price isn't tied to a delivered item count that this module measures. The page and volume gates are elsewhere.

   `pro-slide` was the only gap.

## Non-blocking notes (optional follow-ups, not CHANGES)

- N1. `tests/delivered.test.mts` (new pro-slide block): it would help to add `assert.equal(refundRatio(deliveredCount(meta, proDeck(8))), 0.2)`. That locks the money figure (4 000 of 20 000) and not just the `Delivered` shape, the same way `document.test.mts:1074` does for `slide`.

## Recommendation on (4): the pro-slide image share (money decision, needs owner approval)

- **Partial loss currently refunds nothing.** For plain `slide` that's justified: the images are free stock and the label doesn't mention them. For pro-slide the promise *is* images: the description says "Har slaydda AI chizgan rasm" (`tools.ts:377`), and the price is 2 000 per slide against about 150–500 per slide for plain `slide`. If 3 of 8 AI images fail, the user loses a paid part of the product and gets nothing back.
  - **Recommendation:** add a separate share for pro-slide, derived from prices the way `IMAGE_PRICE_SHARE` is. For example: `IMAGE_PRICE_SHARE_PRO = (PRO_SLIDE_PER_SLIDE − SLIDE_EXTRA_PRICE) / PRO_SLIDE_PER_SLIDE = 0.75` as the upper bound. A conservative 0.5 is also reasonable, because the pro premium also pays for the richer brief. Select it at `delivered.ts:96` by `meta.toolId === "pro-slide"`.
  - Example with 0.5: 10 slides, 8 image slots, 20 000 coins → each missing image refunds 1 250.
- **Total loss (`got 0`) currently refunds everything.** For a 30-slide deck that's 60 000 coins, while the text deck is still delivered.
  - This is defensible. The headline feature failed completely, and the missing images are almost always provider-side: `blocked` means a locked account or key, `failed`, or `skipped` (timeout) (`slide-images.ts`). So it's not a lever the user can pull.
  - But it isn't proportional. With a pro share in place, it would be more consistent to refund `share` (0.5–0.75) on total image loss for pro-slide and keep the full refund for plain `slide`. That means an exception in `refundRatio:121` for units that carry an explicit share, or moving the `got <= 0 → 1` rule behind a per-tool flag.
- Both changes change how money is refunded, so the owner must approve them first ("Agree before decisions"). They shouldn't go into P6. P6 is correct and safe as it stands: it only makes pro-slide refunds behave like `slide`.
