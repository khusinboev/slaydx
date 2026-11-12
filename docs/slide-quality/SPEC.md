# Slide quality — plain «Slayd» (design variety, on-topic pictures, student voice)

Date: 2026-11-12. Branch: `feat/slide-quality`. Scope: the plain `slide` tool (~70 % of usage). User complaints:
(1) every deck looks the same; (2) pictures are off-topic and few; (3) the text sounds like a teacher's methodical
document, not a student. Owner: raise quality even if the provider cost per deck rises. Prices are unchanged.

## Baseline (live, 3 decks, untouched form defaults, 10 slides)

All three decks: `lecture` content, `academic` design, `atlas` palette. Layouts: title, agenda, section×3, bullets×2,
twoCol, process, closing. Pictures 5–6 of 10 (3–4 of 7 content slides), all stock first hits: the same Amir Temur
statue on 5 history slides, «colour-grading graphs» / «lockers» / «Chongqing skyline» on the AI-economics deck.
Speaker notes opened «Assalomu alaykum, hurmatli talabalar. Bugungi ma'ruzamizda…». Cost $0.013–0.014 per deck.

## Scope

Design/palette auto, the design seed and the hybrid pictures apply to the plain tool only (`toolId === "slide"`).
Pro slayd (and AI slayd) resolve template/theme exactly as on main (composer default `atlas`, no «Avtomatik» dot,
`auto`/absent → `atlas` in `extractMeta`); their pictures, cost and the 50 % no-picture refund are unchanged. The
student-voice prompt and the officialese repair are shared by both tools.

## A. Design variety (`lib/generation/slide-design.ts`)

* The CONTENT template (beats, roles, audience) is resolved exactly as before (user → purpose → `inferSlideTemplate`).
* «Avtomatik» design: the visual is drawn from `DESIGN_POOL[content template]` (lecture: academic, grid, story, rail,
  split, conference, dashboard — only designs with a picture slot on `bullets` and on the cover), weighted by a scored
  subject match (`SUBJECT_AREAS`, 12 areas, topic ×2 + subject/wish ×1) and a per-generation seed.
* Palette: new form value `slideTheme: "auto"` (form default, also the server default when the field is absent).
  Drawn from `VISUAL_PALETTES[visual]` (curated per design) by subject affinity + the same seed. An explicit palette
  always wins; picking a template still sets its default palette (explicit).
* Persistence: `buildSlideAcademicDoc` derives `meta.slideSeed` from the generation id (`mediaContext().generationId`,
  so a worker retry and the live preview get the same design; a random seed only without an id — scripts/tests); the doc pins `slideTemplate`, `slideVisual`,
  `slideTheme`; `buildSlideDeck` reads the pinned values, so a rebuild/PATCH never re-rolls (test
  `tests/slide-design.test.mts`). No seed (old docs, probes, previews) = legacy choice (template's own visual).
* Form: «Rang» row has an «Avtomatik» dot (checked by default); drafts saved before v3 with the old untouched
  `atlas` + auto template restore to auto — including a v2 draft where the user had picked «atlas» on purpose (the
  two cannot be told apart; a palette picked together with a template, or any other palette, stays). The gallery's «auto» tile text («Mavzuga qarab eng mos dizayn va rang
  tanlanadi») is now true.
* Palette check: one real deck rendered in all 57 (design, palette) pairs and inspected as contact sheets
  (scratchpad `pairs/sheet-*.png`); all listed pairs read well; `chalk` was never listed.
* Layout mix: unchanged. A 10-slide default deck is 3 sections + 4 content slides because of the AUDIT-25 rule
  «plan item = section + content»; this is the dominant layout (30 %) — changing it is a contract change, not done.

## B. Pictures — hybrid stock + AI (`lib/generation/slide-stock.ts`)

Generation path only (`attachSlideImages(..., { hybrid })`); without the option the legacy chain runs unchanged.

1. One LLM call (`writeStockPlans`) → per slot `query` (2–4 English nouns), `altQuery`, `scene`; the old
   `searchQueryFor` is the per-slot fallback.
2. Pexels and Pixabay both searched (4 hits each, interleaved, deduplicated across the deck); broader query when < 3.
3. One multimodal Gemini call per group of 4 slots (groups in parallel, through the Gemini circuit breaker +
   limiter + failure reporting, 35 s, low media resolution, JSON schema) sees the providers' small previews
   (downloaded in parallel, 4 s each) and returns the best index or −1. A group the judge cannot answer (open
   breaker, timeout, garbage, slot missing from the answer) is «not judged»: AI fallback or no picture, never the
   unseen first hit. Only a box with no Gemini key at all keeps the legacy first-candidate rule.
   Candidates are deduplicated once across the deck after all slots are gathered, so no photo appears twice.
   Every step is capped by the picture-stage deadline (query call, previews, judge, persist, AI); slots that run
   out of time get no picture (declined) — the stage never overruns into assembly.
4. Slots with no fitting stock photo → Gemini picture through the Pro slayd provider (`pickProvider` for
   `pro-slide`: same limiter, media core purpose, `recordImage` cost), photo style, content slides first.

Settings (`lib/server/settings.ts`, admin tabs): `slide.image_ai_fallback` (bool, default on, «Funksiyalar»),
`slide.image_ai_max` (0–30, default 4, «Navbat va generatsiya»; 0 = no AI) — 4 × $0.034 ≈ $0.14 stays under the
plain deck price (3 000 so'm). Cost attribution: every call is recorded in the job's cost meter (`trackJobCost`
→ `generations.cost_json` and an `ai_usage` row keyed by the generation and its `tool_id = slide`), so the admin cost
report puts the spend on «Slayd»; only the media-core `media_jobs.purpose` label reads `proslide.illustration`.

### Plain-slide picture promise

«A relevant picture on every slide whose design has a picture slot and whose text leaves room for it (D1)».
`SlideImageReport.want` = planned slots − `declined`. Declined (no picture, not promised, never refunded): stock
answered but nothing fitted / not judged / zero hits, and AI was off, capped, failed, blocked or out of time; or the
stage ran out of time. Only a genuine stock OUTAGE (both providers failed) whose AI draw also fails counts as a
failure. Refund rules are unchanged: a plain partial shortfall is noted with 0 % refund; the old «nothing delivered»
path (got = 0 < want → `refundRatio` 1, i.e. a full refund of the deck) is reached only by a real stock + AI outage,
exactly as before this branch (before: a stock outage alone).
Report fields `stock`, `ai`, `declined` added.

## C. Voice (`lib/generation/slide-voice.ts`)

* Writer prompt role by resolved audience: students/pupils/course/general/auto → «a’lochi talaba presenting in own
  words» (short active sentences, concrete examples and numbers, Uzbekistan context where natural, terms explained,
  titles as statements/questions, banned officialese list, one bad/good example, no slang/jokes/invented facts);
  educators/management/employees → professional businesslike register. Speaker notes get the same voice.
* Section subtitles (student voice): one concrete hook sentence or question; «Ushbu/Mazkur/Bu bo‘limda» openers and
  «yoritib beriladi / ko‘rib chiqiladi / muhokama qilinadi / …tahlili» closers are banned in the prompt and score as
  strong markers; section, cover and closing subtitles flag at 2 points and are rewritten by the same repair call.
* Deterministic officialese score (uz/ru/en markers, strong ×2 / weak ×1, threshold 3 per slide) adds rewritable
  slides to the EXISTING single `repairThinSlides` call (thin slides keep priority); a rewrite is accepted only if it
  is no longer officialese. Text limits unchanged. Applies to pro-slide too (shared prompt/repair).
* Temperature left at the default: design variety now comes from the seed; no evidence that a higher temperature
  helps and it risks JSON breakage (`docs/llm/SLIDE-BAD-JSON.md`).

## Time budget and progress

Wall clock of a default 10-slide deck (live logs): before 33.5–34.8 s; after 57–64 s (bio 58 s, econ 59 s,
hist 57 s; one run 81 s with a judge timeout). `budget.ts`: plain base +75 s (`SLIDE_PICTURE_STAGE_MS`), so a
10-slide deck's budget (305 s) covers a 90 s writer chunk + 45 s repair + `PLAIN_PICTURE_WORST_MS` (154 s) + 12 s
assembly; 30 slides stay under the 660 s job timeout. Progress shows «Rasmlar izlanmoqda / tanlanmoqda /
chizilmoqda» sub-steps (`slide-progress.ts` `ImagePhase`).

## Measured after (live, same 3 topics)

| deck | design / palette | pictures (content) | stock / AI | cost |
|---|---|---|---|---|
| bio | lecture / grid / clinic | 6/10 (4/7) | 6 / 0 | $0.041 (judge at full res, before the low-res fix) |
| econ | lecture / grid / summit | 6/10 (4/7) | 3 / 3 | $0.139 |
| hist | lecture / rail / atlas | 8/10 (6/7) | 8 / 0 | $0.019 |
| hist (after review fixes) | lecture / rail / forge | 8/10 (6/7) | 6 / 2 | $0.092 |

slide-audit: all OK (plan 3/3, thin 0, leaks 0, trunc 0). Officialese markers in notes: 17 → 1 across the three
decks; section subtitles of the last history deck carry no methodical opener/closer. Expected cost per deck:
text $0.013 + queries ≈ $0.003 + judge ≈ $0.001–0.004 + $0.034 per AI picture (0–4 by default) → ≈ $0.02–0.16.
