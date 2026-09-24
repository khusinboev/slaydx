# A4 — Live baseline ("before") evidence set

Auditor A4, AUDIT-25. Scope: **not** a code audit (see A1/A2 for that) — this is the "before" evidence
set requested for AUDIT-25: 6 decks generated through the *current* engine (`slides-3`, pre-fix, the code
the owner complained about), via `buildArtifact` directly (same pattern as `scripts/live-engine.mts`, but
driven from a throwaway scratchpad runner since this checkout is read-only). Confirms `docs/AUDIT-25.md`
§1 (S1–S4) with concrete slide/deck evidence and adds a few observations not in the original two-deck
diagnosis.

Artifacts: `eval-out/audit25-baseline/{name}.doc.json`, `{name}.pptx`, `{name}.pdf`, `{name}-NN.png`,
`{name}-sheet.png` (all gitignored). Runner: `/tmp/.../scratchpad/a4-probe.mts` (not committed, scratchpad
only) — calls `buildArtifact(tool, values, { deadline: Date.now()+240_000 })` directly, no server/queue.

**Headline: every one of the 6 decks reproduces S1 (plan items with no slide) and S2 (section number =
array index, unrelated to the plan) — this is not a two-deck fluke, it's the engine's default behavior.**
No wrong-language strings and no missing-promised-images were found in this sample; S3 (fabricated
skeleton numbers) did not trigger because the LLM never failed (no fallback path exercised). S4 (thin
text / truncation) reproduced in 2 forms beyond the already-known quiz-option case: `twoCol` bullets and
a `quote` attribution clipped mid-word with a bare `…`.

---

## Per-deck findings

### `lesson-10` — slide, lesson, 10 slides, plan 4 — $0.0139, 23.6 s

Agenda (`s1`, 4 bullets): 1) Fotosintez tushunchasi va xloroplastlar · 2) Yorug'lik va qorong'ulik
bosqichlari · 3) Fotosintezning umumiy kimyoviy tenglamasi · 4) Jarayonning biosferadagi global ahamiyati.

Body slides (title/agenda/closing excluded): `s2` bullets (dars maqsadlari — meta, not a plan item),
`s3` quote (hook, not tied to any item), `s4` **section "05"** *"Fotosintez mexanizmi va xloroplast
tuzilishi"* (≈ item 1), `s5` process (amaliy mashq — practice, not itemized), `s6` twoCol *"Yorug'lik va
qorong'ulik bosqichlari farqlari"* (= item 2, clean match), `s7` stats (C6H12O6, 6 CO2 — touches item 3
loosely), `s8` bullets (uyga vazifa, meta).

- **Plan coverage: 3/4.** Item 4 ("Jarayonning biosferadagi global ahamiyati") has **no slide at all** —
  nothing in the body discusses biosphere-level significance; the closest text is the pre-content hook
  quote, which is generic and precedes any section marker.
- **Section number:** `s4` shows a large **"05"**. That is the slide's position (5th of 10 — 1-based
  index including title), not "1" (the plan item it covers). Confirms S2.
- **Thin slides:** none clearly blank; `s7` stats card is short (32 words across 3 stat tiles) but legible.
- **Truncation:** none found.
- **Images:** 6/10 slides carry an image (two Pexels fetches logged `[pexels] fetch failed` during this
  run but did not leave any slide without a fallback image — no missing-image defect observed).
- **Language:** clean uz throughout (checked every string field, not just bullets).

### `lecture-12` — slide, lecture, 12 slides, plan 5 — $0.0253, 29.3 s

Agenda (`s1`, 5 bullets): 1) Bozor iqtisodiyoti tushunchasi va belgilari · 2) Xususiy mulk va tadbirkorlik
erkinligi · 3) Talab va taklif muvozanati · 4) Raqobat muhiti va uning vazifalari · 5) Davlatning
iqtisodiyotdagi tartibga solish roli.

Body: `s2` **section "03"** *"...fundamental tushunchalari va mohiyati"* (= item 1), `s3` bullets (meta),
`s4` twoCol *"...tarkibiy asoslari va erishiladigan natijalar"* (touches item 2 loosely), `s5` **section
"06"** *"...amaliy harakatlantiruvchi kuchlari"* (vague, doesn't map cleanly to any single item), `s6`
process *"Talab va taklif orqali muvozanat narxining shakllanishi"* (= item 3, clean), `s7` quote
(generic Adam Smith epigraph), `s8` bullets (recap, meta), `s9` table (compares rejali/bozor/aralash
systems — touches item 5 as one row), `s10` references.

- **Plan coverage: 2/5 clean (items 1, 3).** Item 4 ("Raqobat muhiti va uning vazifalari") **never gets a
  slide** — grepped the whole doc: "raqobat" only appears as a table *row label* on `s9` and once each in
  two generic recap bullet lists (`s3`, `s8`); it is never the subject of a slide. Item 2 and item 5 are
  each touched tangentially (one paragraph / one table row) but have no dedicated slide either.
- **Section numbers:** "03" and "06" are the slide indices (3rd and 6th of 12); "03" happens to align
  with plan item 1 by content, but the number shown is the position, not "1" — and "06" doesn't align
  with any single plan item at all (S2 confirmed twice in one deck).
- **Truncation (new, beyond the already-known quiz-option case):**
  - `s4` twoCol, `left[0..2]` and `right[1..2]` — 5 of 6 bullet strings end mid-word with a bare `…`, e.g.
    `left[0]`: `"...nligi har bir subyektga o'z mulkini erkin tasarruf etish imkonini ber…"` (cut before
    "beradi"). This is the `left`/`right` column list, not a quiz option — confirms the clip problem in
    `docs/AUDIT-25.md` S4 is not limited to `QUIZ_OPTION_MAX`.
  - `s7` quote, `quoteBy`: `"Adam Smit — Shotlandiyalik faylasuf va iqtisodchi olim, zam…"` — attribution
    line clipped mid-word.
- **Thin slides:** none egregious; `s9` table (41 words across 4×3 grid) and `s10` references (3 sources
  with titles+publishers) are legitimately populated, not blank.
- **Images:** 7/12 with image. **Language:** clean uz.

### `open-lesson-pro-12` — pro-slide, open_lesson, 12 slides, plan 4 — $0.1490, 31.9 s

Agenda (`s1`, 4 bullets): 1) Suvning bug'lanish jarayoni · 2) Bulutlar hosil bo'lishi · 3) Yog'inlar
turlari va tushishi · 4) Kichik va katta doiralar.

Body: `s3` bullets (dars maqsadlari), `s4` process *"Suv aylanishi doirasini bosqichma-bosqich chizish..."*
— **3 process steps (Bug'lanish / Kondensatsiya / Yog'inlar) collapse plan items 1–3 into ONE slide**
instead of each item getting its own content slide, `s5` **section "06"** *"Katta va kichik suv aylanishi
tizimlari"* (= item 4, clean content match but wrong number), `s6`–`s8` quiz (3 one-question slides),
`s9` answers, `s10` bullets (mustaqil ish), closing.

- **Plan coverage: 4/4 "touched somewhere," but only 2 of 4 have a slide of their own** — items 1–3 share
  a single 3-step process card rather than getting individual content slides; only item 4 gets a
  dedicated (mis-numbered) section slide. This is the softer variant of S1: the invariant "≥1 content
  slide per plan item" is nominally met, but 3 items are compressed into one card, which is exactly the
  "reja — bezak" pattern AUDIT-25.md describes, just less extreme than `min-4` below.
- **Section number:** `s5` shows **"06"** (6th of 12 slides) for what is actually plan item **4**.
- **Thin slides:**
  - `s9` "answers" (**Test javoblari**) is a *full slide* holding only `"1 — A"`, `"2 — B"`, `"3 — B"` (9
    words total) — visually mostly empty background (confirmed on the contact sheet: three short cards on
    an otherwise blank slide).
  - `s6`/`s7` quiz slides are 8 words each (question + 4 short options) — inherently sparse by design
    (one question per slide), noted but not scored as a defect on its own.
- **Truncation:** none found in this deck.
- **Images:** only 4/12 slides carry an image, the lowest ratio of the 6 decks (pro-slide is supposed to
  put an AI image on "har mos slaydga" per CLAUDE.md) — worth a follow-up look at which layouts are being
  skipped, though this run did not show any *broken* image reference, just fewer than the other two
  pro-slide-style decks.
- **Language:** clean uz. **Cost:** by far the most expensive deck in the set (image generation + Gemini
  grounding research, even with `internetSearch: false` — note `slideResearch` was empty as expected for
  this case; the pro-slide image pipeline dominates cost here, not text).

### `report-8` — slide, report, 8 slides, plan 3 — $0.0109, 17.4 s

Agenda (`s1`, 3 bullets): 1) Akademik ko'rsatkichlar va yillik tahlil · 2) O'quv dasturlari samaradorligi
qiyosi · 3) Kelgusi davr uchun ustuvor vazifalar.

Body: `s2` **stats** (values "2", "4", "12" — Semestr yakunlari / Baho turlari tizimi / Yangi amaliy
modul; touches item 1 loosely), `s3` table (Aniq fanlar/Gumanitar/Muhandislik o'zlashtirish — item 1),
`s4` stats (88%/76%/92% — item 1 again), `s5` **section "06"** *"O'quv jarayonining asosiy topilmalari va
natijalari"* (generic filler, doesn't map to any of the 3 items specifically), `s6` bullets (xulosalar),
closing *"Kelgusi o'quv yili uchun ustuvor strategik rejalar"* (= item 3, clean, but only because
`closing` naturally echoes the last topic).

- **Plan coverage: ≈2/3.** Item 1 is over-covered (3 different slides — `s2`, `s3`, `s4` — all circle back
  to the same "akademik ko'rsatkichlar" topic). Item 2 ("O'quv dasturlari samaradorligi qiyosi") is **never
  clearly addressed** — the closest is `s3`'s subject-comparison table, but that compares *subjects*
  (fan turlari), not *dasturlar* (curricula), so it's a stretch at best. Item 3 is only covered by the
  closing slide, which is structurally forced to exist regardless of plan content.
- **Section number:** `s5` shows **"06"** — the 6th of 8 slides, unconnected to the 3-item plan.
  Also a **stray-number pattern**: the same deck plants unlabelled small numbers "2", "4", "12" on `s2`
  with no visible unit context beyond a short caption (readable, but exactly the kind of bare-digit
  presentation the owner's original complaint singled out — "ba'zida shunchaki '3' raqami turadi").
- **Thin slides:** `s2` stats (11 words for 3 tiles) and `s4` stats (9 words for 3 tiles) are both close
  to bare numbers + a 2–3 word label, no supporting sentence — genuinely thin by the density standard
  AUDIT-25.md wants (`thinSlides` detector target).
- **Truncation:** none found. **Images:** 6/8. **Language:** clean uz.

### `defense-14` — pro-slide, defense, 14 slides, plan 5, internetSearch=true — $0.2563, 72.9 s

Agenda (`s1`, 5 bullets): 1) Tadqiqot savoli va dolzarblik · 2) Baholashdagi ilmiy bo'shliqlar tahlili ·
3) Avtomatlashtirilgan baholash metodologiyasi · 4) Amaliy natijalar va statistik ko'rsatkichlar ·
5) Tizimning qiyosiy xususiyatlari va cheklovlari.

Body: `s2` **section "03"** *"Tadqiqot savoli va muammoning qo'yilishi"* (= item 1, clean content match),
`s3` bullets *"Mavjud baholash tizimlari holati va aniqlangan bo'shliqlar"* (= item 2, clean, near-verbatim
title match), `s4` process + `s5` stats (both = item 3, no section marker though), `s6` table + `s7`
twoCol + `s8` bullets + `s9` twoCol + `s10` table (items 4/5, diffused across 5 slides with no per-item
boundary), `s12` references, closing.

- **Plan coverage: this is the best-covered deck in the sample** — every plan item is addressed by at
  least one slide, and items 1–2 map crisply onto dedicated, correctly-titled slides. But **only item 1
  gets a numbered "section" slide, and the number shown ("03") is the slide's position, not "1"** — the
  single clearest illustration in the whole sample of S2: the displayed digit and the plan item it
  actually represents are two different numbers (3 ≠ 1). Items 3–5 have no section marker at all, so a
  viewer has no way to tell where one plan item ends and the next begins.
- **Truncation:** closing slide (`s13`) `subtitle`: `"...ni oshirish imkonini to'liq isbotladi hamda
  amaliyotga joriy etish ta…"` — cut mid-word on the very last slide of the deck.
- **Thin slides:** none — this deck has the highest average body-word-count per content slide (25–69
  words) of the sample, consistent with `students_master` audience rules requiring more substantiation.
- **Note (adjacent to scope but worth flagging):** `internetSearch: true` and the deck cites concrete
  percentages (67%, 55%, 95%) and named sources (Mordor Intelligence, Duolingo, ETS) on `s6`; `research`
  in the checks list would need to confirm these came from `slideResearch.sources` rather than the model
  inventing figures — not verified here (out of A4's plan/numbering scope), flagging for whoever owns the
  research-grounding check.
- **Images:** 6/14. **Language:** clean uz. **Cost/time:** most expensive and slowest deck (12 LLM calls,
  images + grounding), as expected for the richest brief in the set.

### `min-4` — slide, general, 4 slides, plan 6 — $0.0052, 15.0 s

Agenda (`s1`, **6 bullets**): 1) Kasr tushunchasi va uning kelib chiqishi · 2) Oddiy kasrlar va ularning
turlari · 3) Kasrning asosiy xossasi va qisqartirish · 4) Oddiy kasrlar ustida arifmetik amallar ·
5) O'nli kasrlar va ularni o'zgartirish · 6) Amaliy masalalarni yechishda kasrlar.

Body: `s2` **section "03"** *"Kasr tushunchasi va uning mohiyati"* (= item 1) — and that's it. The deck is
title → agenda → one section slide → closing. **4 slides total, 1 content slide.**

- **Plan coverage: 1/6 — the starkest example in the sample.** Items 2–6 (5 of the 6 promised topics:
  kasr turlari, asosiy xossa/qisqartirish, arifmetik amallar, o'nli kasrlar, amaliy masalalar) have
  **zero** slides and are never mentioned again after the agenda. This is `docs/AUDIT-25.md` S1
  ("reja — bezak") in its purest form: the form let the user ask for 6 plan items with only 4 total
  slides (no `planCapacity` clamp existed pre-fix), the agenda dutifully promised all 6, and the engine
  had room to deliver exactly 1.
  - Root visibility: this reproduces from the **form**, not just the engine — `slideCount: 4` +
    `planItems: 6` is an input combination the current UI does not block. Confirms AUDIT-25.md §2 decision
    3 (`planCapacity`) is aimed at the right layer.
- **Section number:** `s2` shows **"03"** (3rd of 4 slides) for plan item **1**. Same S2 pattern as every
  other deck — even in the smallest, simplest case, the number is the index, not the item.
- **Thin slides / truncation:** none (too few slides to have padding room; the one content slide is
  reasonably filled at 19 words + subtitle).
- **Images:** 2/4. **Language:** clean uz.

---

## Summary table

| deck | slides | plan items | plan items with a slide | thin slides | leaks (stray/mismatched numbers) | other |
|---|---:|---:|---:|---:|---|---|
| lesson-10 | 10 | 4 | 3/4 (item 4 missing entirely) | 0 clear | "05" section = index, covers item 1 | — |
| lecture-12 | 12 | 5 | 2/5 clean (1, 3); 2, 4, 5 only tangential/table-row mentions | 0 clear | "03" & "06" = index; "06" maps to no single item | 5 mid-word `…` truncations in a `twoCol` list + 1 in `quote.quoteBy` |
| open-lesson-pro-12 | 12 | 4 | 4/4 touched, but items 1–3 share ONE process slide (only 2 of 4 get their own slide) | 1 (answers slide, 9 words on a full slide) | "06" section = index, covers item 4 | lowest image ratio (4/12) of the sample |
| report-8 | 8 | 3 | ≈2/3 (item 2 unaddressed; item 1 over-covered 3×) | 2 (two stats slides, 9–11 words each) | "06" section = index, matches no item; bare digits "2/4/12" on s2 | — |
| defense-14 | 14 | 5 | 5/5 touched; only 2/5 get a numbered section (1, 2) | 0 | "03" section = index, covers item 1 (clearest number≠item mismatch) | 1 mid-word `…` truncation in closing subtitle; unverified research-grounding of cited stats (out of scope, flagged) |
| min-4 | 4 | 6 | **1/6** (items 2–6 have zero slides) | 0 (deck too short) | "03" section = index, covers item 1 | reproduces from form (slideCount 4 + planItems 6 allowed pre-`planCapacity`) |

**Total spend: $0.4604** (lesson-10 $0.0139 + lecture-12 $0.0253 + open-lesson-pro-12 $0.1490 +
report-8 $0.0109 + defense-14 $0.2563 + min-4 $0.0052), well inside the ≤$0.5–1 budget. Wall time
23.6 + 29.3 + 31.9 + 17.4 + 72.9 + 15.0 = 190.1 s for the LLM/image calls; rasterization (LibreOffice +
pdftoppm) added a few more minutes on top, all via `heavy2.sh`.

## Five worst concrete defects

1. **`min-4`, whole deck** — 6 plan items requested, `slideCount: 4`; only **1 of 6** plan items gets any
   slide at all (items 2–6 vanish after the agenda). The rawest reproduction of S1 in the sample, and it
   traces to a form-level gap (no `planCapacity` clamp), not just the engine.
2. **`defense-14`, slide `s2`** — big display number **"03"** on the section slide that covers plan
   **item 1**. The single cleanest number≠item mismatch: a reader has no way to know "03" doesn't mean
   "the 3rd point of the plan."
3. **`lecture-12`, slide `s4`** — 5 of 6 `twoCol` bullet strings truncated mid-word with a bare `…`
   (e.g. `"...imkonini ber…"`), plus the `quote` attribution on `s7` cut the same way. Confirms S4's clip
   problem is not confined to quiz options (`QUIZ_OPTION_MAX`) as `docs/AUDIT-25.md` implies — it's a
   general `fitSize`/clip gap.
4. **`lecture-12`, plan item 4 ("Raqobat muhiti va uning vazifalari")** — never becomes the subject of any
   slide; "raqobat" only appears once as a comparison-table row label and twice in generic recap bullets.
   The agenda promises it, the deck never delivers it — the exact owner complaint ("ba'zilari rejaga amal
   qilmayapti").
5. **`open-lesson-pro-12`, slide `s4`** — plan items 1–3 (bug'lanish / bulutlar / yog'inlar) are folded
   into a single 3-step process card instead of getting their own content slides, while plan item 4 gets a
   dedicated (mis-numbered "06") section slide — an uneven, undocumented compression that a viewer/teacher
   cannot predict or explain.
