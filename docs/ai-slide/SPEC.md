# AI slide: every slide drawn as one picture (spec, 2026-11-12)

Owner request 2026-11-12: a new slide kind where the user enters the usual deck data, and every slide comes back as
one 16:9 picture with exact text, automatic extra info, illustrations and formulas, crisp. Price = 2× the provider cost,
growing with every extra slide. Image model chosen by the user, price follows the model. Placed under the slide kind
whose price it matches.

## Findings

Live spike 2026-11-12 (one chemistry table slide, Uzbek Latin with ʻ, subscripts, 2K, 16:9), all three models drew
every character exactly:

| Model (API id) | Time | Output tokens | Cost per slide (USD, measured) |
|---|---|---|---|
| `gemini-nano-banana-2.1`, thinking minimal | 36 s | 2 222 | ≈ 0.067 |
| `gemini-nano-banana-2.1`, thinking default | 103 s | 2 227 + 1 632 thought | ≈ 0.116 |
| `gemini-3-pro-image` | 29 s | 1 528 + 189 thought | ≈ 0.21 |
| `gemini-3.1-flash-image` (deprecated 2026-10-06) | 29 s | 2 018 | ≈ 0.12 |

Prices: https://ai.google.dev/gemini-api/docs/pricing (2.1: $30 / 1M output, 2K = 1 680 image tokens; Pro: $120 / 1M,
2K = 1 120 image tokens). Thought tokens are counted as output. Uzbek is not on Google's tested-language list: the
spike is the evidence.

## Placement and price

| Kind | Price, 12 slides | Per slide |
|---|---|---|
| Slayd | 3 000 | flat up to 20 |
| Pro slayd | 24 000 | 2 000 |
| AI slayd, Nano Banana 2.1 | ≈ 31 300 | ≈ 2 540 |
| AI slayd, Nano Banana Pro | ≈ 86 100 | ≈ 7 100 |

(at 12 700 so'm / $ and markup 2). It is a per-slide product like Pro slayd, so it lives on the Pro slayd page as a second
kind: a switch «Pro slayd · AI slayd» on top of both forms. Its own tool id (`image-slide`, slug `ai-slayd`, unlisted)
keeps price, budget, refunds, editing and the admin price row apart from Pro slayd.

Price (`imageSlidePrice`, one function for server and form):

    so'm = roundUp100( (TEXT_USD + slides × model.usdPerSlide) × media.markup × finance.soum_per_usd )

`TEXT_USD` = 0.03 (the writer call), `usdPerSlide` = the measured cost per delivered slide including proofreading and
redraws (2.1: 0.10, measured 0.090–0.093; Pro: 0.28). The admin «Narxlar» % applies on top, as for every tool.

## Engine (`lib/generation/image-slide/`)

1. **Text.** One writer call returns the deck as JSON: per slide a kind (title, agenda, content, table, formula, diagram,
   quote, summary, closing), title, short points, an optional table or formulas, a visual description (English) and
   speaker notes. Text budget per slide is small (title ≤ 70 chars, ≤ 5 points ≤ 90 chars, table ≤ 5 × 4), because
   long paragraphs are where image models fail. Formulas pass `prettyFormula`. The count is clamped to the order.
2. **Prompt.** Built in code, no second LLM: one design block for the whole deck (the chosen style: palette, type,
   layout grammar), the exact text block («render character for character, keep ʻ ʼ»), the visual, `n / N`.
3. **Draw.** Slide 1 first (at most 200 s); the others in parallel (10 lanes) with slide 1 as a style reference image,
   so the deck looks like one deck. One retry per slide on a failed call (never on a blocked key). 2K, 16:9, JPEG;
   stored as 1920 px JPEG q86. Draws stop 45 s before the job deadline (PPTX, assets and commit need it).
4. **Proofread.** The text model reads each drawn slide against its text items and lists wrong words and extra text
   (the second live deck drew «Slide 1 of 12», «16:9» and «Print-ready» badges). One redraw with the exact spelling;
   the picture with fewer issues is kept.
5. **Assemble.** `SlideModel.fullImage` with the picture in `image` (one full-bleed image layer), title and notes kept
   for search and accessibility. A slide whose picture failed falls back to its text layout and is refunded.

## Money

Charged up front by the formula. A slide without its picture is refunded proportionally (`delivered`: unit «slayd»,
«AI slayd», want = ordered slides, got = drawn slides). Real spend goes to `cost_json` from the usage tokens of each call.

## Viewer, files, editing

Slides viewer and thumbnails unchanged (a `fullImage` slide is one image layer; no 1024 px screen copy, it would blur
the text). PPTX: one picture per slide plus
speaker notes; PDF and PNG downloads work as for any deck. No text editing: the text is inside the picture (the tool
has no edit adapter).

## Switch

`image_slide.enabled` (default on). The tool needs the Gemini key (`features.images`).
