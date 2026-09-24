# A1 — Prompt-to-persisted-slide audit (text path)

Auditor A1, AUDIT-25. Scope: `lib/generation/slide-prompt/*.ts`, `slide-write.ts`, `slide-limits.ts`,
`slide-quiz.ts`, `slide-research.ts`, `slide-audience.ts`, `slide-purpose.ts`, `json.ts` (`parseLlmJson`),
`i18n.ts` (`slideLabels`), plus `slide-blocks.ts`/`slide-templates.ts`/`slide-layout*.ts`/`visuals/*` as
needed for box-size cross-checks. Everything already recorded in `docs/AUDIT-25.md` §1 (S1–S4: plan-vs-body
invariant missing, section numbers from array index not plan, fabricated skeleton numbers, generic thin
content / no density detector) is **not** repeated here.

**Summary: 11 findings — 3 P1, 4 P2, 4 P3.**

---

### A1-01 — `process` step-text limit ignores the (common) two-row layout; text can overflow the card by ~2×

Severity: **P1**

Location: `lib/generation/slide-limits.ts:49` (`stepText: 160`), `lib/generation/slide-layout.ts:2183-2276`
(`planProcess`), `lib/generation/slide-layout.ts:130,142-144` (`STRIP_LAYOUTS`/`stripCut`).

Evidence: `STEP_TEXT_MAX = SLIDE_LIMITS.stepText = 160` was measured (per the comment in `slide-write.ts:210-232`)
against the **single-row, no-image** case: `dBox` w=2.47″, h=1.75″ → ~255 chars at the 11pt floor. But
`process` is in `STRIP_LAYOUTS` (line 130), so whenever the slide has an attached image (the normal case —
both `slide`/`pro-slide` attach an AI/stock image to most content-bearing layouts), `stripCut()` narrows the
zone and `maxPerRow` drops from 4 to 3 (`slide-layout.ts:2183`). Once the step count exceeds `maxPerRow`,
`twoRows` becomes true and `rowH` is roughly halved (`slide-layout.ts:2197`), collapsing `dBox.h` from 1.75″
to **0.5″** (`dBox: { …, h: rowH - 1.95 }`, line 2267). Concretely, with an image attached:
- 4 steps → `twoRows` true (maxPerRow=3) → `dBox` ≈ 3.80″×0.5″ → floor-font capacity ≈ **90 chars**.
- 5 steps (`SLIDE_LIMITS.stepsMax = 5`, the model's max) → `dBox` ≈ 2.30″×0.5″ → floor-font capacity ≈ **54 chars**.

`fitSize` (line 381-390) has no overflow guard: if no size in `(min, base]` fits, it silently returns `min`
and the text still overflows the card — there is no truncation at render time. A 140-160 char step text
(fully legal per `STEP_TEXT_MAX`) on a 4-5-step process slide with an image will visibly spill out of the card.

Reproduction: any deck with `slidePurpose` that maps to a `process` beat (e.g. `lecture`'s "Ketma-ketlik",
`timeline`'s "Asosiy bosqichlar", `defense`'s "Metod") where the slide gets an image and the model writes
4-5 steps with text near the 160-char cap.

Proposed fix: `STEP_TEXT_MAX` must depend on `stripCut(s)` and step count (or `normalizeSlide`/`clip` needs a
second, tighter cap for the two-row case), owned by **P3 (zichlik/limits)** since it's `slide-limits.ts` +
`slide-layout.ts` box math; alternatively P2 (maket) if the fix is purely in the layout's font floor.

Effort: **M**.

---

### A1-02 — Grounded sources silently vanish when the model doesn't populate `refs` on the `references` beat

Severity: **P1**

Location: `lib/generation/slide-write.ts:90-97` (`applyResearchRefs`), `lib/generation/slide-write.ts:334-337`
(`coerceLayout`, `want === "references"` branch), `lib/generation/slide-blocks.ts:244` (`internetSearch` force-adds
the `adabiyotlar` block specifically so research doesn't go unseen).

Evidence: `internetSearch: true` auto-enables the `adabiyotlar` block (`orderedBlocks`, `slide-blocks.ts:244`)
precisely because, per the comment there, ungrounded research "foydalanuvchiga umuman ko'rinmaydi". But the
recovery path is one-way: `coerceLayout(s, "references")` only switches the slide to the `references` layout
**if `s.refs?.length` is already non-empty** (`slide-write.ts:336`). If the model returns that beat as plain
`bullets` (e.g., an empty/omitted `refs` array — a very plausible LLM failure mode given `refs` is one field
among a dozen in a large JSON schema), the slide stays `bullets` and is never coerced. `applyResearchRefs`
(line 90-97) only overwrites slides where `sl.layout === "references"` — it never creates one. Net effect:
a deck built with `internetSearch: true` and a successful grounding call (`ctx.research.sources` has up to
6 real citations) can ship with **zero visible trace of the research** — no references slide, no sources —
even though the user paid for/asked for internet search.

Reproduction: force the LLM (or a test stub) to return the `adabiyotlar` beat as `{layout:"bullets", bullets:[...]}`
with no `refs` field; `ctx.research.sources` will have entries but no slide in the final deck will ever
receive them.

Proposed fix: P1 (dvigatel) package — `applyResearchRefs` should force-create/convert the last "yielding"
bullets slide (or a dedicated inserted slide) to `references` when `ctx.research.sources.length > 0` and no
`references`-layout slide exists in the final deck, not just patch an existing one.

Effort: **S**.

---

### A1-03 — `coerceLayout` "process from bullets" fallback duplicates content when the bullet has no separator

Severity: **P1**

Location: `lib/generation/slide-write.ts:338-352` (`coerceLayout`, `want === "process"` branch).

Evidence:
```ts
steps: pool.slice(0, 4).map((b, i) => {
  const [head, ...rest] = b.split(/\s+[—–:-]\s+/);
  return { n: String(i + 1), title: clip(head, 40), text: clip(rest.join(" — ") || b, 90) };
}),
```
When a bullet contains no ` — `/` – `/` - `/`:` separator (very common — audience rules ask for short, plain
sentences, e.g. `students_bachelor` bullets are full sentences with no dash), `split()` returns a single
element: `head` = the *whole bullet*, `rest` = `[]`. Then `title = clip(head, 40)` (the bullet, truncated to
40 chars) **and** `text = clip(rest.join(" — ") || b, 90)` falls back to `b` — the *same original bullet*,
truncated to 90 chars. The step card ends up showing the same sentence twice (once cut at 40 chars as the
bold title, once cut at 90 chars as the body) — exactly the "2-bullet slide forced into `process` → 2 steps
with text = the bullet" failure mode. This fires whenever the model returns `bullets` for a beat whose
plan/template layout is `process` (a template/role mismatch that is not rare — 6 of 10 base templates use
`process` beats, and the model is free to ignore layout per beat since the JSON schema's `layout` field has
no relation enforced to the requested `seq`).

Reproduction: stub the LLM to return `{layout:"bullets", bullets:["Fotosintez yorug'lik energiyasini kimyoviy energiyaga aylantiradi", "Bu jarayon xlorofil yordamida amalga oshadi"]}` for a beat planned as `process` → resulting step cards both show duplicated title+text.

Proposed fix: P1 package. Either (a) require ≥2 bullets **and** a separator to attempt the split, falling
back to `s` unchanged (no coercion) otherwise — consistent with how `stats`/`table`/`quiz`/`references`
already refuse rather than fabricate; or (b) split on the bullet's natural clause boundary / first N words
as title, remainder as text, so title ≠ text verbatim.

Effort: **S**.

---

### A1-04 — `agendaSlide` toggle is a no-op for `slidePurpose: "training"` and `"pitch"` (2 of 9 presets)

Severity: **P2**

Location: `lib/generation/slide-purpose.ts:50,52` (`PURPOSE_DEFAULTS.training.blocks`, `.pitch.blocks` — neither
contains `"reja"`), `lib/generation/slide-prompt/structure.ts:34` (`const agenda = has("reja") && meta.agendaSlide !== false`),
`lib/generation/slide-blocks.ts:441` (`blocksToBeats` `keepAgenda` — same condition), `lib/generation/meta.ts:172-175`
(`blocks` defaults from `purposeDefaults(slidePurpose).blocks` whenever the form doesn't send `blocks` — true
for the plain `slide` tool, since `blocks` is a `pro-slide`-only field per `slide-params.ts:107`).

Evidence: `agendaSlide` is a registered, user-facing param on **both** `slide` and `pro-slide`
(`slide-params.ts:112`, `impacts: ["beats"]`) — the differential probe (`probeA:true`/`probeB:false`) checks
it changes `beats`, but only under the *default* `slidePurpose` ("general"), which does include `"reja"`. For
`training` (`Trening / master-klass`, `blocks:["maqsadlar","motivatsiya","amaliyot","test"]`) and `pitch`
(`Taklif / marketing`, `blocks:["motivatsiya","diagramma"]`), `"reja"` is absent from the default block set. Since
`keepAgenda`/`agenda` both require `has("reja")` **in addition to** `agendaSlide !== false`, toggling
`agendaSlide` on a deck with `slidePurpose: "training"` or `"pitch"` (and no manual `blocks` override — true
for the plain `slide` tool, which has no `blocks` field at all) changes nothing: no agenda beat is ever
planned, and the prompt's agenda-count rule (`structure.ts:59`) never fires. This is the "every parameter
must work" guarantee (CLAUDE.md) silently broken for a specific purpose × tool combination that the
single-parameter differential probe cannot detect.

Proposed fix: P1 package — either always add `"reja"` as a candidate when `agendaSlide !== false` regardless
of `purposeDefaults`, or gate `agendaSlide`'s effective range in the form/registry so it's documented as
purpose-dependent (and covered by a probe that varies `slidePurpose` too, not just `agendaSlide`).

Effort: **S**.

---

### A1-05 — `coerceLayout` "twoCol/compare from bullets" drops column titles (blank headers)

Severity: **P2**

Location: `lib/generation/slide-write.ts:354-359`.

Evidence:
```ts
if (want === "twoCol" || want === "compare") {
  if (s.left?.length && s.right?.length) return { ...s, layout: want };
  if (pool.length < 2) return s;
  const mid = Math.ceil(pool.length / 2);
  return { ...s, layout: want, left: pool.slice(0, mid), right: pool.slice(mid) };
}
```
No `leftTitle`/`rightTitle` is set. A slide normalized as `bullets` (`normalizeSlide`, `slide-write.ts:304-306`)
never has those fields, so after this coercion the twoCol/compare layout renders with **empty column
headers** (`planTwoCol`, `slide-layout.ts:1571`, `fitSize(s.title, titleBox, …)` on an empty string returns
`base` size but draws nothing) — visually a blank bar above each column. Every other branch of `coerceLayout`
that invents structure (`process`, `quote`, `section`/`closing`/`title`) either derives a label from the
source data or accepts a visible default; this branch does neither.

Proposed fix: P1 package — default `leftTitle`/`rightTitle` to something derived from the beat role split
(e.g. "A"/"B", or the audience's `compare` defaults already used elsewhere: `slide-write.ts:436,438` uses
`"A"`/`"B"` for the skeleton) instead of leaving them undefined.

Effort: **S**.

---

### A1-06 — Beat `role` text (the model's per-slide content instruction) is hardcoded Uzbek and sent verbatim regardless of `meta.language`

Severity: **P2**

Location: `lib/generation/slide-templates.ts:194,197` (`"1. Tushuncha"`, `"2. Mexanizm"` — already flagged for
numbering in AUDIT-25 §1 S2, but the *language* dimension is separate), all `role`/`role()` strings in
`lib/generation/slide-blocks.ts:50-58` (e.g. `"Reja — aynan ${m.planItems} ta band"`, `"Nazorat testi — …"`),
`lib/generation/slide-blocks.ts:120` (`quizRole`), `lib/generation/slide-write.ts:535` (`seq` — the literal
block joined into the user prompt for every chunk), `lib/generation/i18n.ts:57-60` (`languageDirective`, the
only mitigation).

Evidence: for a `language: "ru"` or `"en"` deck, the per-slide instruction line sent to the model (`seq` in
`slide-write.ts:535`, reused unchanged in every `askRange` call, `slide-write.ts:588-593`) still reads e.g.
`"3) layout=section — 1. Tushuncha"` or `"7) layout=quiz — Nazorat testi (jami 5 ta savol) — 2-savol: AYNAN
bitta savol va 4 variant"`. The only safeguard against language bleed is the generic disclaimer in
`languageDirective` ("These instructions are written in Uzbek for convenience; do NOT let that change the
output language") — a blanket instruction, not a translation, and it says nothing about *quoting the literal
role text*. For a role that is itself a numbered content label ("1. Tushuncha"/"2. Mexanizm" — S2's fabricated
numbers), a model paraphrasing loosely is more likely to carry over the Uzbek fragment or the bare digit into
an otherwise-Russian/English title than for a purely descriptive role like "Ta'rif va ahamiyat".

Proposed fix: role strings should either be short language-neutral codes translated via `slideLabels`-style
tables, or the prompt should explicitly say "translate the following role description into the OUTPUT
LANGUAGE before using it" — owned by **P1 (dvigatel)** since it touches `slide-blocks.ts`/`slide-templates.ts`
role text, with `slide-prompt/structure.ts` gaining the explicit translate-the-role instruction.

Effort: **M** (touches every role string + prompt wording; can't be done file-locally in one place).

---

### A1-07 — `quiz` "cards" visual overflows for floor-font audiences (e.g. `school_1_4`)

Severity: **P2**

Location: `lib/generation/slide-layout-extra.ts:233-277` (`quizCards`, `textBox` at line 265),
`lib/generation/slide-audience.ts:74` (`school_1_4: { bodyPt: 28, minPt: 24, … }`),
`lib/generation/slide-limits.ts:67` (`quizOption: 60`).

Evidence: `quizCards`' option `textBox` is 5.34″×0.81″ (`cardW - 0.56` × `cardH - 0.94`, computed from
`cardW=(12.1-0.3)/2=5.9`, `cardH=(6.85-3.05-0.3)/2=1.75`). `fitSize` there uses `ctx.bodyType.bodyPt/minPt`
(the audience-driven floor), **not** a fixed 11-13pt floor like the other quiz visuals use in a couple of
cases. For `school_1_4` (`minPt: 24`, the youngest/largest-font audience — Slide Law explicitly sets a high
floor for readability), floor-font capacity is ≈ **29 characters** (1 row of ~29 chars at 24pt) — well under
half of `QUIZ_OPTION_MAX = 60`. A 55-character option (fully legal) will overflow the card at the audience's
own font floor. `school_5_7` (`minPt: 22`) is marginal (≈62 chars, just above the limit); `school_8_9` and
audiences with `minPt ≤ 20` are fine. Other quiz visuals (`quizClassic`, `quizDense`, `quizTimeline`,
`quizHero`, `quizMagazine`) were all checked and have enough margin even at `minPt: 24`.

Caveat on reachability: none of the current 10 `SLIDE_TEMPLATES` assign `visual: "cards"` (it's one of the 7
legacy visual families) — so this is currently only reachable via old `doc_json` re-renders, not new
generations. Still a real render bug for those legacy decks (`school_1_4` + old `cards`-visual template).

Proposed fix: P2 (maket) — give `quizCards`' `textBox` explicit min headroom (match the ~90-char floor the
other card-style quiz visuals get) rather than relying on `ctx.bodyType.minPt` alone.

Effort: **S**.

---

### A1-08 — Multi-chunk decks: a quiz group straddling the chunk boundary can get duplicate/overlapping questions

Severity: **P3**

Location: `lib/generation/slide-write.ts:549-557` (`CHUNK = 8`, `ranges`), `lib/generation/slide-write.ts:594-596`
(`done`/"ALLAQACHON YOZILGAN" — **titles only**), `lib/generation/slide-write.ts:716` (`written.push(sl.title)`),
`lib/generation/slide-blocks.ts` (`test` block anchored `"late"`, i.e. near the tail of the body — for decks
just over the >10-slide chunking threshold, "late" often lands right around slide index 8, the chunk seam).

Evidence: for decks with `plan.length > 10`, ranges are split into consecutive 8-slide chunks
(`slide-write.ts:549-557`) and asked **sequentially**, each given the full role `seq` (so it knows layouts)
plus a `done` list built purely from **`sl.title`** of previously-written slides (`slide-write.ts:594-596,716`).
A `quiz` slide's `title` is whatever short label the model gave it — **not** the question text (`s.quiz[0].q`).
If a multi-question `test` group (e.g. `quizCount: 5`, `QUIZ_PER_SLIDE = 1` → 5 `quiz` beats,
`slide-blocks.ts:75`) straddles the chunk-8 boundary (plausible for a 12-16 slide deck with the group
anchored "late"), the model writing the second chunk's quiz slides has no visibility into the *actual
questions* chunk 1 already wrote — only their titles, if the titles even mention the topic. `finalizeQuiz`
(`slide-quiz.ts:155-173`) has no duplicate-detection either; it only truncates/pads by position. Net effect:
plausible near-duplicate or overlapping quiz questions across the chunk seam in a >10-slide deck with a test
block.

Proposed fix: P1/P5 (verification) — either keep the `test` group inside a single chunk (chunk boundaries
should not fall inside a block's own beat run), or pass along each written quiz slide's `q` text (not just
`title`) in the `done` list when the block is `test`.

Effort: **M**.

---

### A1-09 — No enforcement that slide content reflects the grounded research facts

Severity: **P3**

Location: `lib/generation/slide-prompt/research.ts:16-29` (`researchLines` — facts injected as a block with a
soft instruction only), contrast with the article pipeline's verified `[W…]` citation system (`CLAUDE.md`,
Maqola 2 description) which has a judge/verifier step.

Evidence: the only guidance tying slide content to `ctx.research.facts` is `"Bu faktlarga tayanib yozing.
Faktda yo'q raqamni o'ylab topmang"` (`research.ts:28`) — an instruction, not a check. Nothing in
`normalizeSlide`/`finalizeQuiz`/`applyResearchRefs` verifies that any bullet/stat/quote actually traces back
to a fact in `research.facts` or a source in `research.sources`; there's no per-slide citation marker (unlike
the article pipeline's `[W…]`). A model can accept the research block, then still write ungrounded (or
contradicting) numbers on `stats`/`bullets` slides, and nothing downstream would catch it — the deck looks
identical to one with no research at all except for the (possibly-orphaned, see A1-02) references slide.

Proposed fix: out of scope for a quick fix given the architecture gap; flag for a future sprint decision
(the project owner explicitly said research grounding was "jonli tasdiqlangan" for the mechanism, not for
enforcement). At minimum, P3 (zichlik/limits) package's planned `thinSlides`/`slide-quality.ts` detector could
add a soft check: when research ran and facts contain numbers, warn if no slide's stats/bullets contain any
matching digit.

Effort: **L** (needs a design decision, not just a code fix).

---

### A1-10 — Fallback skeleton content (`beatToSlide`) is hardcoded Uzbek even for non-Uzbek decks

Severity: **P3**

Location: `lib/generation/slide-write.ts:427-458` (`beatToSlide`).

Evidence: `beatToSlide` correctly localizes labels via `slideLabels(meta.language)` for `title`/`closing`
(`L.presentation`, `L.conclusion`, `L.questions`, line 419-425), but the actual placeholder **content** is
hardcoded Uzbek regardless of language: agenda bullets `[`${t}: kirish`, "Asosiy qism", "Amaliyot", "Xulosa"]`
(line 428), process steps `"Boshlash"`/`"O'zgarish"`/`"Natija"` (line 446-448), stats
`{value:"3", label:"Asosiy nuqta"}` (line 453 — also the fabricated-"3" pattern S3 already flags, but note
the *label* half is unconditionally Uzbek too), and the generic bullets fallback `"Mavzuga bog'liq aniq
band."` (line 458). This skeleton is used in two places: (a) the `"plan"` live-progress event shown to the
user **before** real LLM content streams in (`buildSlideAcademicDoc`, `slide-write.ts:929-939`) — briefly
visible for ru/en decks too; (b) as the actual final deck when `llmEnabled()` is false (dev/test only,
`slide-write.ts:970`). Impact is low (transient UI flash, or dev-only path) but is a distinct bug from S3
(numbers) since it's about *language*, not fabrication.

Proposed fix: P1 package, low priority — route these fallback strings through `slideLabels`-style
per-language tables, or at minimum translate the half-dozen literals for the languages already covered by
`SLIDE_LABELS` (`i18n.ts`).

Effort: **S**.

---

### A1-11 — No prompt guidance for the `quote` layout (length, tone, whether to fill `quoteBy`)

Severity: **P3**

Location: `lib/generation/slide-prompt/structure.ts` (no `quote layout:` line — compare with the explicit
rules present for `section`/`closing`/`twoCol`/`compare`/`process`/`stats`/`table`/`agenda`/`quiz`/`answers`/
`references`, lines 41-95), `lib/generation/slide-limits.ts:35,37` (`quote: 220`, `quoteBy: 60` — fields exist
but are never explained to the model).

Evidence: `quote` appears in the base `beats` or `fillers` of 8 of the 10 templates (`lecture`, `story` ×3,
`compare`, `pitch`, `timeline`, `case` — see `slide-templates.ts`), and is also the layout for the
`motivatsiya` block (`slide-blocks.ts:52`, role: "mavzuga qiziqish uyg'otadigan savol yoki fakt" — itself
somewhat contradictory with "quote", since a *question* is not a *quotation*). Unlike every other
content-bearing layout, there is no rule in `structure.ts` telling the model how long a quote should be,
whether it must be an actual attributable quotation vs. a paraphrased key idea, or when to populate
`quoteBy`. In practice this likely means `quoteBy` is rarely filled (no instruction ever asks for it) and
`quote` slides vary wildly in register slide-to-slide.

Proposed fix: P3 (zichlik/limits or brief) package — add a one-line `quote layout:` rule alongside the
existing per-layout rules, analogous to the `twoCol`/`compare`/`process`/`table` lines already in
`structure.ts:43-50`.

Effort: **S**.

---

## Findings index

| ID | Title | Severity | Effort |
|---|---|---|---|
| A1-01 | `process` step-text limit overflows the two-row (imaged) card | P1 | M |
| A1-02 | Grounded sources vanish if model drops `refs` on the references beat | P1 | S |
| A1-03 | `coerceLayout` process-from-bullets duplicates title+text | P1 | S |
| A1-04 | `agendaSlide` is a no-op for `training`/`pitch` purposes | P2 | S |
| A1-05 | `coerceLayout` twoCol/compare-from-bullets drops column titles | P2 | S |
| A1-06 | Beat `role` text is hardcoded Uzbek, sent verbatim regardless of language | P2 | M |
| A1-07 | Quiz "cards" visual overflows at `school_1_4` floor font | P2 | S |
| A1-08 | Quiz group split across chunk boundary risks duplicate questions | P3 | M |
| A1-09 | No enforcement that slide content reflects grounded research | P3 | L |
| A1-10 | Fallback skeleton content hardcoded Uzbek regardless of language | P3 | S |
| A1-11 | No prompt guidance for `quote` layout | P3 | S |
