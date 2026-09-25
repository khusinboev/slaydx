# AUDIT-25 — Integration review (seams between packages, merged tree)

- **Branch / HEAD:** `slides-3` @ `7d4525c` (README-only since `e268937`, which is the tree reviewed).
- **Scope:** only what the per-package reviews (`AUDIT-25-P1…P7`, P8/P9 sections) could not see — the joins between packages in the MERGED code.
- **P9 (layout badge) and P11 (limits follow the deck visual) are still in worktrees, not merged.** Where their planned change alters a finding, it says so.
- **Heavy commands (3 of 3 used, all through `heavy2.sh -m 3G -t 900`):**
  1. `scratchpad/int25/probe.mts`:
     - Part A/A2: prompt vs `normalizeSlide` vs repair counts;
     - Part B: 3 094 normalized slides drawn at 17 visuals × 7 audiences × 2 volumes;
     - Part C: `buildSlideAcademicDoc` end to end for 12 form sets, with `fetch` stubbed (writer, repair, image prompts, Gemini `/interactions`);
     - Part D: editor limits vs the with-image box.
  2. `scratchpad/int25/probe2.mts`: follow-ups F1–F7.
  3. Tests: `client-bundle-guard`, `slide-live`, `slide-plan`, `delivered`, `slide-images` — **70/70 pass**.
- **Isolation:** no network, no real LLM, no `.env*` read. The probe deletes `PEXELS/PIXABAY/FAL/XAI` keys and sets `GEMINI_API_KEY=test-key`, the same pattern as `tests/slide-live.test.mts`.
- **Overflow model:** "overflow" = the layout's own measure (`LAYOUT_KIT.listRows` / `inkHeight`, bold layers at `CHAR_EM_BOLD`, 1 pt tolerance). This is exactly `slide-quality.ts layerFits`.
- **Raw output:** `scratchpad/int25/probe.out`, `probe2.out`, `tests.out`.

## Summary

| # | Sev | Seam | One line |
|---|---|---|---|
| INT-01 | **P1** | P1 `syncAgenda` × `visuals/dashboard.ts` | The `report` deck agenda shows only 4 of 5–6 plan items (every audience). |
| INT-02 | **P2** | P1 `syncAgenda` × P2 agenda planners | Agenda = plan titles clipped at `bulletChars`, not at the agenda box; school audiences overflow 102–159 %. |
| INT-03 | **P2** | W7 editor × P8 «matn rasmdan ustun» | The text guard exists only on the upload route. Editing text on an image-bearing slide, and `imageRestore` / PATCH `image`, bypass it; the editor allows up to 4.6× the with-image box. |
| INT-04 | **P2** | P3 prompt targets × P8 clip basis | School process steps are prompted at **3 words** (the with-image box), while normalize keeps 45 characters and the no-image box holds 85–121. S4 ("process matni qisqa") persists for grades 1–9. |
| INT-05 | **P2** | P8 `bulletClipLimit` × real word wrap | Bullets that pass normalize still overflow at 101–149 % in 10 audience × visual cases (zero margin at the measured capacity). |
| INT-06 | **P2 (money, owner)** | P6 pro in `deliveredCount` × P8 yield × dead `premiumVisuals` | pro-slide image refund is a cliff: 1 of N images gives 0 %, 0 of N gives 100 % of the whole deck. P8 shrinks `want`, which makes the 0-of-N case likelier. |
| INT-07 | P3 | P3 targets × P1 normalize × P3 repair | Counts: normalize keeps what the prompt forbids (steps, stats, cols); repair keeps 4 column items where normalize keeps 2. |
| INT-08 | P3 | `extensions.ts` × `plannedBlocks` | The prompt says «NAZORAT TESTI: 10 ta savol» while the plan has 1–6 quiz slides; it can promise a «Javoblar» slide that was dropped. |
| INT-09 | P3 | `brief.ts` × `structure.ts` | «agenda'da 3–1» vs «AYNAN 1 ta band»; «5–6» vs «AYNAN 6». |
| INT-10 | P3 | normalize static `quote` 280 × layout | The quote box in `magazine`/`rail` holds 129/135 characters, so quotes overflow 103–107 %. The yield predicate cannot help, because the image does not shrink that box. |
| INT-11 | P3 | `coerceLayout` × clip limits | bullets→twoCol and bullets→closing pass unclipped text into narrower boxes: 9 and 31 overflows out of 238 each. |
| INT-12 | P3 | P2 plan-number column × section title | The section title overflows (known P2 debt); the plan column makes `dashboard` worse (142 % with a plan number vs none without). |
| INT-13 | P3 | P4 form × `extractMeta` | With `slideCount` absent, the form computes capacity at 10 slides and the pro engine at 12. |
| INT-14 | P3 | `writeSlidesWithLlm` fix-ups | `title-fix` / `end-fix` ids are never renumbered (pre-existing; only when the model drops the slide). |

---

### INT-01 — `report` (dashboard) agenda shows only 4 of the plan's 5–6 items

- **Severity:** P1
- **Location:** `lib/generation/visuals/dashboard.ts:252`, `const items = (s.bullets ?? []).slice(0, Math.min(4, ctx.bodyType.agendaMax));`
  - The line was already in `main`. AUDIT-25 turned it into a contract break: `syncAgenda` (`slide-write.ts:609`) now writes exactly `planN` items, and every item has its own slide (P9 will number it «05»/«06»).
- **Evidence:**
  - Probe C, set 4 (`pro 16 report management planItems 6`): `ISSUES: … AGENDA shows 4/6 items on dashboard`.
  - Probe C, set 12 (`pro 18 report school_1_4`): the same.
  - F3: `hidden dashboard:4` for **every** audience × N ∈ {5, 6} × item length.
- **Reach:** `report` is the `purposeDefaults("report")` template. `defaultPlanItems(14) = 5` and `defaultPlanItems(18) = 6`, so any report deck of 14 or more slides with default settings shows a plan that omits the last bands. That is exactly the owner's S1 complaint.
- **Why unseen:** P1's tests check `agenda.bullets` (the model), and P2/P9 render tests use ≤ 4 agenda items on `dashboard`.
- **Fix (P2/P9 owner, `visuals/dashboard.ts`):**
  - Lay out `agendaMax` (≤ 6) tiles, for example two rows of 3, or one row with narrower tiles and `bodyFit`.
  - Add a render test: agenda with 6 bullets on all 17 visuals, where the number of distinct `src.i` equals 6.
  - Do **not** cap `planCapacity` by visual: the capacity must stay visual-independent (the form does not know the visual).

### INT-02 — Agenda items are clipped at `bulletChars`, not at the agenda box; school decks overflow

- **Severity:** P2
- **Location:** `slide-write.ts:609-616` (`syncAgenda` → `clipTo(stripOrdinal(title), rules.bulletChars)`); the agenda planners in `slide-layout.ts:1673` and `visuals/*.ts planAgenda`.
- **Evidence (F3):** agenda = N plan titles of L characters. Titles are ≤ 72 (`SLIDE_LIMITS.title`); the prompt asks for 3–7-word band names, about 25–63 characters.

  | Audience | N | L | Overflow (ink/box) and font below `minPt` |
  |---|---|---|---|
  | school_1_4 | 6 | 40 | split 106 % |
  | school_1_4 | 5–6 | 56 | split 133–159 %, dashboard 102 %, story/bold drop to 23 pt (< 24) |
  | school_1_4 | 6 | 72 | **all 17 visuals** overflow, 112–159 % |
  | school_5_7 | 6 | 56 | split 145 % |
  | school_5_7 | 6 | 72 | 10 visuals, 102–145 % |
  | school_8_9 | 6 | 72 | split 131 %; circle/formal/story/editorial at 19 pt (< 20) |
  | bachelor / management / educators | any | any | clean |

- **Why unseen:** before AUDIT-25 the model wrote short agenda items. Now they are slide titles, clipped at a limit sized for the bullets layout.
- **Fix:**
  - **P1:** clip at an agenda-box limit — add a `fitChars("agenda", rules, visual, n)` probe in `slide-quality.ts` and pass `tpl.visual` into `syncAgenda`.
  - **P3:** give the prompt a title target for plan slides («≤ N so‘z» from that box).
  - **P2:** optionally widen the `split` agenda.
- **P11 note:** P11's "limits follow the deck visual" does not touch `syncAgenda` unless it is explicitly added there.

### INT-03 — The text-vs-image guard exists only on upload; the editor and restore paths put overflowing text beside an image

- **Severity:** P2
- **Location:**
  - `lib/server/slide-image.ts:57-62` (`assertTextFitsImage`, upload only);
  - `lib/generation/slide-edit.ts:937-970`: `image` op (any asset URL of this generation) and `imageRestore`, both without the check. The comment at `:951-957` («PATCH dagi satr URL faqat undo dan keladi») is not enforced: `parseDocOps` (`:1320-1324`) accepts `image` / `imageRestore` from any client PATCH;
  - `writeSlideField` / `listCap` (`:169-184`): text limits are `limitsFor` (no-image, tightest visual) or static `SLIDE_LIMITS.colItem` 110, **whether or not the slide has an image**.
- **Evidence (Probe D):** the most the editor accepts vs the with-image box (characters):

  | Audience / visual | Field | Editor accepts | With-image box |
  |---|---|---|---|
  | school_8_9 / circle | colItem×3 | 110 | **24** |
  | school_8_9 / circle | tableCell×3 | 45 | 24 |
  | school_8_9 / dashboard | statLabel×3 | 65 | 36 |
  | school_8_9 / rail | stepText×4 | 30 | **4** |
  | bachelor / rail | stepText×4 | 55 | **4** |
  | bachelor / circle | colItem×3 | 110 | 60 |
  | management / dashboard | statLabel×3 | 95 | 60 |
  | management / dashboard | colItem×3 | 110 | 53 |

  - 17 of 18 audience × visual rows exceed the box in at least one field.
  - twoCol uses `fitLines`, so it overflows. process/stats/table use `bodyFit` and drop below the audience floor, down to the old 10–12 pt design floor.
- **Reachable flows** (no undo needed):
  1. Type into an existing AI-image slide.
  2. Delete the image, lengthen the text, then press «Rasmni qaytarish» (`imageRestore`).
  3. PATCH `{op:"image", url:<earlier upload asset>}`.
- **Quantified gap:** the upload guard covers 1 of the 4 ways text and an image meet.
- **Fix (W7/P8 owner):**
  - Move the check server-side into `commitDocOps` (`lib/server/slide-commit.ts`): after `applyDocOps`, for each touched slide with `image`, run `imageYieldField(slide, deck.bodyType, deck.visual)`. Then either refuse with 400 `text_too_long`, or drop the image to `imageOrig`.
  - That covers `text`, `list`, `image`, `imageRestore`, `set`, `insert` and `layout` in one place. `slide-edit.ts` stays isomorphic.
- **P11 note:** if P11 makes `limitsFor` visual-aware with images counted, the editor side of this closes, but `image` / `imageRestore` still need the server check.

### INT-04 — School process steps are prompted at 3 words: S4 persists

- **Severity:** P2
- **Location:** `slide-quality.ts:554-556` (`fitWords` uses `fitChars(…)` default `images: "both"`, i.e. the with-image box); `:602` (`stepRange`); the clip in `slide-write.ts:286-287` (`NO_IMAGE`).
- **Evidence (Probe A2, school_8_9):**

  | Visual | Prompt «process text» | Normalize clip at 3 steps | No-image box |
  |---|---|---|---|
  | circle | **3 words** | 45 ch (`limitsFor` 20 pt) | 121 ch |
  | dashboard | **3 words** | 45 ch | 121 ch |
  | rail | **3 words** | 45 ch | 85 ch |

  - The detector threshold becomes `min(STEP_MIN_WORDS=6, fitWords) = 3`, so `thinSlides` can never flag it.
  - The same pattern holds for school_1_4 / 5_7 (tighter still).
  - For comparison, bachelor gets 8 words at 3 steps and 5 at 4.
- **Seam:**
  - P8 moved the clip to the no-image box («matn rasmdan ustun»), but the prompt and detector still size text for the with-image box.
  - The `limitsFor` table (tightest visual × 0.88) caps the clip at 45 anyway.
  - The live symptom («process kartalarida 3–4 so'zli matn», AUDIT-25 §1 S4) is therefore still produced by design for grades 1–9, on every visual that has an image strip.
- **Fix (P3 + P11):**
  - Compute the prompt and detector targets from the no-image box (`images: "none"`), since the image yields anyway.
  - P11 must lift `limitsFor` to the deck visual so the clip does not stay at 45.
  - Add a test: school_8_9 × circle with process `stepText.max ≥ 6`.
- **P11 note:** P11 alone raises the clip but not the prompt (3 words), so the finding stays open unless `fitWords` changes too.

### INT-05 — Bullets that passed normalize still overflow (zero margin at measured capacity)

- **Severity:** P2
- **Location:** `slide-quality.ts:416-418` (`bulletClipLimit` = measured capacity, no margin), measured with a single repeated probe sentence (`probeText`).
- **Evidence (F4):** real text, word-boundary clip, different word order:

  | Audience / volume | Visual | Ink / box | Clip | Text length |
  |---|---|---|---|---|
  | school_10_11 / kop | **lab** | **149 %** | 152 | 149 |
  | bachelor / kop | story | 111 % | 185 | 181 |
  | educators / kop | story | 111 % | 185 | 181 |
  | school_5_7 / kop | notebook | 126 % | 121 | 120 |
  | school_8_9 | dashboard | 104 % | 85 | 85 |
  | management / kop | circle, split | 103 % | 173 | 171 |
  | school_5_7 | circle | 101 % | 85 | 81 |

  Probe B: 7 bullet overflows in 238 audience × volume × visual cases.
- **Cause:** `listRows` wraps per word. A different word sequence of the same length can need one more line, so capacity is not monotone in length, and a clip of exactly `fitChars` has no margin.
- **Fix (P8/P3 owner):**
  - Clip at `floor(0.9 × fitChars)`, or measure `fitChars` as the minimum over 3–4 word rotations of the probe sentence.
  - Lock it with the F4 case: `school_10_11/kop/lab`.

### INT-06 — pro-slide image refund is a cliff (0 % or 100 %); P8 makes 100 % likelier

- **Severity:** P2 (money; needs an owner decision before deploy, per the project rule)
- **Location:**
  - `delivered.ts:89-97` (`imagesDelivered`): `refundShare: meta.premiumVisuals ? 0.25 : 0`, and `extractMeta` hard-sets `premiumVisuals: false` (`meta.ts:279`, a dead field);
  - `delivered.ts:117-121` (`refundRatio`): `if (got <= 0) return 1`;
  - `delivered.ts:285-318`: pro-slide is now routed here (P6).
- **Behaviour on pro-slide (2 000 tanga per slide):**
  - 14 of 15 images delivered: refund **0**, because the share is 0.
  - 0 of 15 delivered (for example Gemini 403): refund **100 % of the deck**, text included.
  - P8 removes yielded slides from `want` first. Probe C, set 3: `want 3` out of 8 eligible (5 yielded). Set 12: `want 4` out of 11. With a small `want`, a couple of image failures reach `got = 0`, which refunds the whole deck.
- **Invariant check (as the brief asked):** in all 12 sets `got ≤ want` and `deliveredCount → null` when images succeed, including sets with 1–18 yielded slides. D1 works as specified.
- **Fix:** owner decision (already listed as debt «Pro-slayd rasm ulushi bo'yicha qaytarish»).
  - Proposal: for `pro-slide` use a fixed share (P6 review: 0.5–0.75) regardless of `premiumVisuals`.
  - Cap the "nothing delivered" rule at the image share: text was delivered.
  - Remove or rewire `premiumVisuals` for pro.

### INT-07 — Prompt counts ≠ normalize counts ≠ repair counts

- **Severity:** P3
- **Location:** `slide-write.ts:162,234,267,285` (`limitsFor(rules)` = audience counts); `slide-quality.ts:597-601` (prompt `maxSteps` / `maxStats` / `maxTableCols` / `maxColItems` = audience ∩ visual capacity); `slide-quality.ts:851-854` (repair twoCol keeps `SLIDE_LIMITS.colItems` = 4); `slide-write.ts:220` (normalize keeps `min(4, maxColItems)`).
- **Evidence (Probe A, prompt | normalize | repair):**

  | Case | Field | Prompt | Normalize | Repair |
  |---|---|---|---|---|
  | school_1_4, 12 visuals | stats | 2 | 3 | – |
  | school_1_4, 12 visuals | table cols | 2 | 3 | – |
  | bachelor / management, all visuals | table cols | 3 | 4 | – |
  | bachelor / management / rail | steps | 3 | 4 | 3 |
  | bachelor / dashboard | stats | 3 | 4 | – |
  | circle / dashboard / split / story (kids, 8–9, adults) | colItems | 2–3 | 2–3 | **4** |

  - F5: `repairThinSlides` accepted 4+4 column items for school_8_9/circle, where normalize would keep 2+2. The items are clipped to 42 characters (the 24-character floor region), so the repaired slide is shallower than the normalized one would be.
  - No overflow resulted, because `bodyFit` shrinks the font.
- **Fix:**
  - P1: normalize takes counts from `layoutWordTargets(rules, visual)` (the same source as the prompt and repair).
  - P3: repair twoCol uses `maxColItems`.
- **P11 note:** P11 plans exactly this direction for limits. Include the counts in P11, or the table above remains.

### INT-08 — Quiz count in the prompt contradicts the plan

- **Severity:** P3
- **Location:** `slide-prompt/extensions.ts:19-25` reads `meta.quizCount`, not `plannedBlocks().quizBeats` / `answers`.
- **Evidence (Probe C):**

  | Set | Prompt says | Plan has |
  |---|---|---|
  | 2 | 3 questions | 1 quiz slide |
  | 4 | 5 | 4 |
  | 6 | 10 | 6 |
  | 11 | 10 | 1 |

  The roles meanwhile say «jami 6 ta savol». When `answers` is dropped, line 24 still promises a «Javoblar» slide.
- **Fix (P1, `extensions.ts`):** use `plannedBlocks(meta, bodyWantOf(…))`, the same as `structure.ts`, or drop the count (the roles carry it).

### INT-09 — Agenda item range in `brief.ts` contradicts «AYNAN planN»

- **Severity:** P3
- **Location:** `slide-prompt/brief.ts:26`: `agenda'da ${max(3, agendaMax−1)}–${agendaMax}`, with `agendaMax = planItems`.
- **Evidence:**
  - planN 1 (a 4-slide deck with `reja`): «agenda'da 3–1» next to «AYNAN 1 ta band».
  - planN 6: «5–6» vs «AYNAN 6».
  - `syncAgenda` overwrites the agenda, so the only cost is a noisier prompt.
- **Fix:** drop the parenthesis. `structure.ts` owns the agenda count.

### INT-10 — Quote clip (static 280) exceeds the `magazine`/`rail` quote box

- **Severity:** P3
- **Location:** `slide-write.ts:226` (`clipTo(…, SLIDE_LIMITS.quote)`); `slide-limits.ts:124-129`. The comment says «eng tor quti (magazine) ~383»; the current measure is 129.
- **Evidence (F2):**
  - `fitChars("quote")`: magazine 129, rail 135 (with and without an image).
  - A 280-character quote overflows at 103 % (magazine) and 104 % (rail) for every audience.
  - A 200-character quote with an image on rail overflows at 107 %. `imageYieldField` returns `null` (correctly: the image does not shrink that box), so nothing prevents the overflow.
  - Probe B: 28 of 238 quote cases overflow. Probe C set 9 (bold): `#1quote+img:quote` overflow.
- **Fix (P3/P1):** clip the quote at `clipLimit("quote", rules, visual, …, NO_IMAGE)`, the same as the other fields, and refresh the stale comment.

### INT-11 — `coerceLayout` carries unclipped text into narrower boxes

- **Severity:** P3
- **Location:** `slide-write.ts:445-457`:
  - bullets→twoCol: `left: pool.slice(0, mid)`, with no `colItem` clip and no `maxColItems`;
  - →closing/section/title: `subtitle: s.subtitle || pool[0]`, with no subtitle clip.
- **Evidence (Probe B):** from a normalized bullets slide:
  - coerce→twoCol: 9 overflows and 45 font drops below the floor out of 238 cases;
  - coerce→closing: 31 overflows (for example school_8_9/kop/classic).
  - It happens only when the model ignores the beat layout. Plan slides hit it most often (the twoCol/process plan beats).
- **Fix (P1):** clip with the same `clipLimit` / `SLIDE_LIMITS.subtitleClosing` calls as `normalizeSlide`, and truncate columns to `maxColItems`.

### INT-12 — Section title overflow; the plan column makes `dashboard` worse

- **Severity:** P3 (known P2 debt, «circle/editorial bo'lim sarlavhasi»)
- **Location:** `visuals/*.ts` section planners; `academic.ts:136-139` (the plan column narrows the title to 8.05″).
- **Evidence (F1):**
  - circle overflows at 26 characters (200 %, box 7.05×0.69″).
  - At 56 characters, `dashboard` overflows at 142 % **only with a plan number** (none without).
  - At 72 characters, 12–13 visuals overflow either way. `SLIDE_LIMITS.title` = 72 was measured without the plan column.
  - Probe C set 1 (academic): `#5section:title #7section:title`.
- **Fix (P2/P9):** measure the `title` probe with `plan: 2` present. P9 adds a badge to content slides as well, so re-run F1 after P9 merges.

### INT-13 — Form capacity and engine capacity disagree when `slideCount` is absent (pro)

- **Severity:** P3
- **Location:** `components/forms/slide-fields.tsx:193-205` passes the raw `values.slideCount`, so `bodyWantOf` defaults to 10. `meta.ts:158-161` defaults pro to 12.
- **Evidence (F7):** the pro form reports capacity 7; the engine uses 12 slides (capacity 9). This matters only when `slideCount` is missing from values (profile defaults normally set it).
- **Fix (P4):** pass `slidePagesOf(values, tool)` into `capacityFor`.

### INT-14 — `title-fix` / `end-fix` ids escape `renumberSlides`

- **Severity:** P3 (pre-existing)
- **Location:** `slide-write.ts:929-955`. The unshift and push happen after `renumberSlides`.
- **Effect:** ids are unique but not `s<i>`. `slide-images` keys prompts by `id`, so there is no collision. Cosmetic.
- **Fix:** call `renumberSlides` once more at the end.

---

## Seams checked and OK (evidence)

- **Chunking and plan indices** (> 10 slides):
  - Probe C sets 5 (30 slides, 4 writer calls), 7 (20 slides, 3 calls) and 8 (25 slides, 4 calls): every `plan` 1..planN has a slide, and live `slide` events carry `plan` for every plan beat (`liveMissPlan = 0`).
  - The `plan` skeleton event has the same length and `plan` tags as `deck`.
  - Ids are `s0…s(n−1)`.
- **Length:** `slides.length === meta.targetPages` in all 12 sets, including `titleSlide: false` (set 7) and 4 slides + test (set 2).
- **Prompt ↔ beats:** `structureLines` planN (via `bodyWantOf`) equals the maximum `plan` in `deckBeats` for all sets, and `TUZILMA BLOKLARI` equals `plannedBlocks.kept`.
- **Agenda sync:** `agenda.bullets` equals the plan-head titles (section preferred), ordinals are stripped (the stub prefixed «1. » on every third title), and no ordinal leaks into titles. `syncAgenda` runs before the floor and again after repair. `finalizeQuiz` runs after both.
- **Repair seam:** the same `bulletClipLimit` / `clipLimit(…, NO_IMAGE)` as normalize for bullets, process, section and quiz. The exception is twoCol (INT-07). Repair was called once per deck, and only when thin slides existed.
- **Images (P8 × P6):** `plannedImageSlots(…, rules)` excludes yielded slides before `want`, and `got ≤ want` in every pro set (yielded 1–7 per deck, 18 on set 8 without a stock key). `deliveredCount` returned `null` for all 12 sets: no refund from yields.
- **Old docs:**
  - `deckBeats` and `buildSlideAcademicDoc` are called only from `lib/generation/index.ts:531` (new generation). `rebuild` (`rebuildFile` → `buildSlideDeck`), doc PATCH, restore, polish (no slide polisher), `outline` and the image route never re-plan a deck.
  - `buildSlideDeck` → `bodyRules(doc.meta)` now spreads `countRules`. Layout reads only `agendaMax`, not the counts; counts affect only editor add-limits. The editor keeps existing text (`editLimit`), and `sanitizeSlideModel` uses static caps.
  - `planNumber` returns `null` on old slides, so no number is drawn (decision 4).
- **Client bundle:** `tests/client-bundle-guard.test.mts` passes. `slide-fields.tsx` → `slide-params` / `slide-blocks` → `slide-templates` / `slide-purpose` pull in no `node:*`, `server-only` or `llm.ts`. `slide-edit.ts` does not import `slide-quality.ts`; the only importer of it outside generation is `lib/server/slide-image.ts` (server-only).
- **Pricing:** `git diff main..HEAD -- lib/tools.ts` is a one-line description change only. `priceFor` / `slidePrice` / `PRO_SLIDE_PER_SLIDE` are untouched.

## Non-slide files touched (`git diff main..HEAD --stat`, excluding `lib/generation/slide-*`, `visuals/*`, slide tests, docs, audit)

| File | Why | Risk to other tools |
|---|---|---|
| `lib/generation/meta.ts` | `extractMeta`: `quizCount` / `agendaSlide` tri-state, `planItems` via `effectivePlanItems(planCapacity(…))` | Runs for **every** tool, but the three fields are read only by slide code (`grep` outside `slide-*`: only `lib/viewers/from-html.ts` sets literals). Non-slide `planItems` changes 5 → 3 (unused). None. |
| `lib/generation/types.ts` | `DocMeta.agendaSlide?` / `quizCount?` optional; comments | Type only. None. |
| `lib/generation/delivered.ts` | `pro-slide` joins the `slide` branch (P6) | Other tools unchanged; money seam in INT-06. |
| `lib/tools.ts` | pro-slide description «Har mos slaydga …» (D1) | Text only; `priceFor` unchanged. |
| `components/forms/compact.tsx` | `Segmented` options gain optional `disabled` (P4) | Shared by all forms; additive (default enabled). |
| `components/forms/SlideComposer.tsx` | slide form (P4) | Slide only. |
| `lib/server/slide-image.ts` | upload guard `assertTextFitsImage` (P8) | Slide only. |
| `package.json` | `"slide-audit"` script | None. |
| `scripts/live-engine.mts`, `scripts/slide-audit.mts` | P5 live cases and auditor | Dev tooling. |
| `tests/delivered.test.mts` | P6 tests | – |
| `README.md` (since `e268937`) | user-facing note | – |
