# R4 — Essay CEFR level (A1…C2) — research report

Read-only research. No product code changed, no DB, no dev server, no paid API. One scratch prototype of the
measurer: `scratchpad/mobile/r4/measure.mjs` (pure node, no deps; NOT product code).

Repo: `/home/adhambek/projects/pythons/slaydbot/slaydx` (all paths below relative to it).

---

## 1. Code map (how an essay param flows today)

Form -> values -> engine (the essay engine reads `values` directly; `extractMeta` is NOT involved for essay params
except `extra`/`sourceText`/`design`):

| Step | File:line | Notes |
|---|---|---|
| Form | `components/forms/EssayComposer.tsx` — `type Ui` :57, `emptyUi` :106, `toValues` :132, `uiFromValues` :164, card «Hajm va til» :307, row «Til» :355 | Normalisation round-trip `toValues -> essayInputFromValues -> uiFromValues` is the ONLY place rules live (context changes kind/language). Draft = `useFormDraft("essay")`, restored through `uiFromValues`. There is NO "repeat from history" feature for essay: only the server draft restore. |
| Registry | `lib/generation/essay-params.ts` `ESSAY_PARAMS` (12 params; each `{id, encode, probeA, probeB, impacts, probeWith?}`), `ESSAY_FORM_FIELDS` | impacts: `prompt, structure, review, language, layout, price`. Conditional params use `probeWith` (`workTitle`, `wordTarget`). |
| Probe test | `tests/essay-params.test.mts` — asserts `ESSAY_PARAMS.length === 12` (:97), differential probe of every declared impact A≠B (`probe()` builds prompts, runs `buildEssayDoc` with a stub LLM, `judge:false, polish:false`), "price only from pages" loop (every param without `price` impact must leave `priceFor` unchanged) | |
| UI coverage test | `tests/ui/essay-composer.test.mts` — every `ESSAY_PARAMS.id` must exist as `[data-field]` somewhere across school/academic/IELTS, and no unregistered `data-field` | |
| Input | `lib/generation/essay/input.ts` — `EssayInput` :36, `essayInputFromValues` :113 (server + probe), `encodeEssayValues` :144 (client) | Isomorphic. Unknown values silently normalise (kind -> first kind of context, etc.). |
| Keys | `lib/server/validate.ts sanitizeValues` | generic key regex `[a-zA-Z0-9_]{1,40}`, NO whitelist -> a new key `essayLevel` passes without server change. |
| Tool | `lib/tools.ts` essay entry (:464-496, `fields: []`, `custom:"essay"`), `CUSTOM_REQUIRED.essay` :82, `essayPricePages` :1455, `priceFor` essay branch :1488 | price = pages chip only (acad: from words). A new key cannot change price unless `priceFor` reads it. |
| Engine | `lib/generation/write-llm.ts` :896 -> `essay/engine.ts buildEssayDoc` :133 | stages: outline -> write (1 call, 2 for >1200 words) -> guard + ONE word-range retry (:167) -> `EssayModel` (:188) -> `reviewEssay` -> `runEssayPolish` (only if score < 90, >=70 s left) |
| Prompts | `essay/prompts.ts` — `essaySystemPrompt` :153 (used for outline, write, word-range retry AND rewrite/polish), `outlinePrompt` :201 (thesis "12–35 words" :209), `essayPrompt` :246, `wordRangePrompt` :281, `rewritePrompt` :303, `judgeHeader` :324, `roleOf` :182 | Instructions English, output language via `languageDirective`. |
| Registry of genre | `essay/registry.ts` — 3 contexts x 5 kinds. **Languages: school_dtm = uz only, academic = uz/ru/en, ielts_task2 = en only** (`EssayLang = "uz"|"ru"|"en"`). "Any language" for essay therefore = these three. | kind `guidance` strings demand things that fight low levels (figurative language "at least once per paragraph" in descriptive; hedging; thesis 12–35 words). |
| Gates/review | `essay/review.ts` — 12 rules (`ESSAY_RULE_IDS` :51), `isClaimSentence` :148 (thesis min 8 words :238, topic sentence min 5 :255), `sentencesOf` (naive split on `[.!?…]\s+`), judge prompts (:364, :394). Scores `essay/rubric.ts` (`essayScore`; rules = mean of green 1/yellow .5/red 0). | |
| Polish / «Tuzatish» | `essay/polish.ts` — `contextOf(doc)` :96 rebuilds ctx FROM THE SAVED `doc.essay` MODEL (person, words, workTitle…); `planEssayPolish` merges rule fixes + judge fixes into <=3 rewrite waves | => anything that must survive polish/«Tuzatish» MUST be stored in `EssayModel`. |
| Model | `essay/types.ts EssayModel` :99 (`person?:` :117 is the precedent for a form choice persisted in the model) | |
| Viewer | `components/files/ResultView.tsx` :376 reads `doc.essay.review` -> `ArticleReviewPanel` (`REVIEW_GROUPS`; unknown check id falls back to group "structure", `reviewGroupOf`) | essay shows NO meta chips today; nothing prints person/kind. |
| Price | Essay price 2 000–4 000 by pages; owner decision (AUDIT-19) "narx o'zgarmaydi" | |
| Existing similar knobs | `person` (1st/3rd), `extra` (free text), slide `slideAudience` (`slide-audience.ts`: per-audience prompt note AND measurable layout limit), resume `tone`. No CEFR/level anywhere (grep). | |
| Live | `scripts/live-engine.mts` cases `essay-dtm` :1252, `essay-academic` :1276, `essay-ielts` :1300; output `eval-out/live/<case>.doc.json`. No essay sample is stored in `eval-out` -> **no baseline of today's sentence length exists**. |

### What "today's implicit level" is
No level is stated anywhere. School: "an Uzbek teacher who writes model essays for graduating pupils" + DTM judge
rewards "richness of language, varied sentence structure, figurative means" -> pushes up. Academic: "formal academic
register, hedging, thesis 12–35 words". IELTS: "band 8 model answers". My estimate (UNMEASURED): school ~B2/C1,
academic C1, IELTS C1. Must be measured live before fixing the default (plan §6, step 0).

---

## 2. Findings / root causes (what will fight the level if we only add a prompt line)

1. **The judge pulls UP.** DTM `language` criterion ("varied vocabulary and sentence structure, figurative means") and
   IELTS `lr`/`gra` ("variety of complex structures") score an intentional A2 text low; their `fixes` then feed
   `planEssayPolish` -> `rewriteEssayFix`, which would rewrite the essay *upward*. The polish pass rebuilds ctx from the
   saved model, so the level must be stored in `EssayModel` and the judge must be told the target.
2. **Hard-coded sentence-length thresholds**: thesis must be >=8 words and topic sentence >=5 (`review.ts` :238/:255);
   outline asks a thesis of "12–35 words" (`prompts.ts` :209). At A1 (mean ~5) these produce false red/yellow and
   push the model to long sentences.
3. **Kind guidance conflicts** (descriptive: "figurative language at least once per paragraph", argumentative:
   "hedging", literary "analyse style features") -> need an explicit "LEVEL beats style wishes, structure rules stay".
4. **Free-text `extra` can contradict** (e.g. «uzun jumlalar bilan»). Rule: level wins on sentence/vocabulary complexity.
5. **Old documents have no level** -> `contextOf(doc)` must yield `level = null` (no block, no rule) so legacy
   «Tuzatish»/polish behaves exactly as before.
6. **Tooltip hints don't work on touch** (`Row hint` = `title=`): level descriptions must be visible text on phone.
7. CEFR is an L2-learner functional scale, not a text-complexity standard; for native uz/ru essays it works as a
   "complexity dial". Be honest in the UI hint and in `docs`.

---

## 3. Design

### 3.1 Parameter
- Form/registry id: **`essayLevel`**, values `"A1"|"A2"|"B1"|"B2"|"C1"|"C2"` (string; case-insensitive on input,
  normalised to upper case). Parsing: invalid/missing -> default for the context (see §3.5) via `essayInputFromValues`;
  `EssayInput.level: CefrLevel | null`.
- IELTS: **level not offered, `level = null`** (IELTS has its own band scale and "band 8 model answer" role; a CEFR
  override would fight `lr/gra` judge and `linking` rule). Owner question Q2.
- Persisted in `EssayModel.level?: CefrLevel` (like `person`), so polish/«Tuzatish»/judge read it from the doc.
- Registry entry (13th param):
  `{ id: "essayLevel", encode: "string", probeA: "A2", probeB: "C1", probeWith: {essayContext:"academic", essayKind:"argumentative"}, impacts: ["prompt","review","layout"] }`
  (`prompt` = level block; `review` = new `level` rule detail text and score differ; `layout` = `doc.essay.level` is in the
  JSON the probe serialises). NOT `price` -> the generic "price only from pages" loop in `essay-params.test.mts`
  automatically proves price is unchanged. (`probeWith` must be non-IELTS since IELTS ignores the param.)

### 3.2 One new pure module: `lib/generation/essay/level.ts` (isomorphic, no server imports)
Exports: `CEFR_LEVELS`, `CefrLevel`, `isCefrLevel`, `CEFR_UI` (id, short label, Uzbek name, Uzbek 1-line hint — used by the
form), `cefrSpec(level)`, `levelTargets(level, lang)`, `levelPromptBlock(level, lang)`, `levelReminder(level, lang)`,
`measureLevel(text, lang)`, `levelVerdict(measure, level, lang)`, `levelRepairInstruction(...)`,
`defaultEssayLevel(context)`, `thesisWordRange(level)`, `claimMinWords(level)`.

### 3.3 CEFR descriptors for the prompt (language-neutral, measurable)
Block placed in `essaySystemPrompt` (single place -> outline, write, word-range retry, rewrite, polish all inherit)
plus a 2-line reminder inside `essayPrompt` user prompt (user prompt is attended to more than the system prompt).
Numbers are rendered per output language (§3.4). Draft text (English instruction):

```
WRITING LEVEL — CEFR {L} ({name}). This is a hard constraint on style; the STRUCTURE rules above (thesis, topic
sentences, counter-argument, paragraph count, word budget) stay, but express them AT THIS LEVEL.
 • Sentences: average {mean} words, never longer than {cap}; {clauses}.
 • Vocabulary: {vocab}.
 • Connectors: {connectors-in-output-language}. Use no connector from a higher level.
 • Terminology: {terms}.
 • Style: {style}.
 The level OVERRIDES any request below for richer vocabulary, figurative language, hedging or longer thesis
 sentences, and overrides the author's "additional requirements" about sentence complexity. Do NOT write
 above or below this level; do not mention the level in the text.
```

Per level ({mean}/{cap} = English baseline; see 3.4 for uz/ru):

| Level | Sentences | Clauses | Vocabulary | Connectors (en / uz / ru) | Terminology | Style |
|---|---|---|---|---|---|---|
| **A1** | mean ~6, <=12 | 1 clause; no subordinate clauses; at most one "and/but/because" | ~500 most frequent everyday words; concrete nouns/verbs; no abstract nouns, no idioms | and, but, because, then / va, lekin, chunki, keyin / и, но, потому что, потом | none: replace any term with a plain word or short description | present (+ simple past); repetition of the same words is fine; no figurative language |
| **A2** | ~9, <=18 | 1–2 clauses; simple "when/if/because" | common everyday + very frequent topic words; no idioms | + so, first/then/finally, when, if / shuning uchun, agar, qachon, avval–keyin–oxirida / поэтому, если, когда, сначала–затем | <=1 term per paragraph, explained in the same sentence | one simple comparison at most; no passive chains |
| **B1** | ~13, <=24 | 2 clauses; relative clauses OK | familiar topic vocabulary; a few common collocations/idioms | + however, for example, although, as a result, also / biroq, masalan, garchi, natijada / однако, например, хотя, в результате | common terms, defined at first use | clear, plain; light figurative use |
| **B2** | ~17, <=32 | 2–3 clauses; varied openers, passives, conditionals | broad topic vocabulary, precise verbs, collocations | + moreover, on the other hand, in contrast, therefore, whereas, despite / bundan tashqari, aksincha, shu sababli, holbuki, …ga qaramay / кроме того, напротив, следовательно, в то время как, несмотря на | topic terminology used freely, uncommon ones explained | argued, well-organised; hedging "tends to" |
| **C1** | ~21, <=42 | 3+ clauses, nominalisation, participial/absolute constructions, rhythm varied (mix of long and short) | wide, precise, discipline-specific; low-frequency words where exact; idiom and implicit meaning | + nevertheless, consequently, furthermore, thus / shunga qaramay, binobarin, shu bilan birga, demak / тем не менее, вместе с тем, таким образом, более того | exact discipline terminology without explanation | fluent academic/literary register, nuanced hedging, implicit cohesion (not only connectors) |
| **C2** | ~25, no hard cap (soft 52) | free, rhetorical periodic sentences + deliberate short ones | full range, connotation, irony, stylistic choice, idioms/proverbs/rare words used naturally | subtle discourse markers (granted, that said, insofar as / gap shundaki, aytish joiz / впрочем, надо признать, постольку поскольку) | assumed shared; no definitions | mastery: rhetorical figures, voice, precise nuance |

Honest note: Uzbek/Russian connector lists are my drafts — have a native reviewer check; the table lives in
`level.ts` as data so it can be corrected without touching logic.

### 3.4 Deterministic measure + verdict (language-aware)
Metrics (pure, `measureLevel(text, lang)`):
1. `meanSentenceWords` (PRIMARY). 2. `overCapShare` = share of sentences longer than the level's `cap` (for A1/A2 any
sentence over cap counts). 3. `commasPerSentence` (clause proxy, INFORMATIONAL only). 4. `longWordShare` (en: words
>=7 letters, ru: >=9) — INFORMATIONAL, **not computed for uz** (agglutination: word length means nothing; sentence
length and clause count only).

Word token: `\p{L}[\p{L}\p{M}]*(['’‘ʻʼ`]\p{L}\p{M}*)*|\d+` (counts «o‘qiyman», «g‘urur» as one word; ignores « — » dashes
that the existing whitespace counter counts).

Sentence splitter (NOT the existing `sentencesOf`): split after `[.!?…]` + optional closing quote/bracket, only if the
next token starts with an uppercase letter/digit/opening quote; do not split after single-letter initials incl. with
apostrophe (`G‘.`, `O‘.`, `A.`), decimals (`3.5`), a SHORT abbreviation list (mas., kv., т.д., e.g.). Prototype run
(`r4/measure.mjs`): initials and decimals fine; known failure shown — a bare abbreviation list containing `m` ate
the real sentence end in «so‘m.», so keep the list minimal (initials + 5–6 entries). Expected splitter error few %;
covered by a table-driven test.

Thresholds — mean words/sentence band [lo–hi], `cap` (overCap share allowed <=10 % for B1+, 0 % for A1/A2).
English baseline from readability literature rules of thumb (NOT measured by us); uz = x0.75, ru = x0.9 (my estimate
from prototype: uz «Men maktabda o‘qiyman» = 3 words vs en 5; uz C1 sample 17.5 words vs en C1 ~21–40). **Calibrate in
the live run; keep every number in one table in `level.ts`.**

| Level | en mean (cap) | ru x0.9 (cap) | uz x0.75 (cap) | prompt target mean en/ru/uz |
|---|---|---|---|---|
| A1 | 4–8 (12) | 4–7 (11) | 3–6 (9) | 6 / 5 / 4.5 |
| A2 | 7–12 (18) | 6–11 (16) | 5–9 (14) | 9 / 8 / 7 |
| B1 | 11–16 (24) | 10–14 (22) | 8–12 (18) | 13 / 12 / 10 |
| B2 | 14–21 (32) | 13–19 (29) | 10–16 (24) | 17 / 15 / 13 |
| C1 | 17–26 (42) | 15–23 (38) | 13–20 (32) | 21 / 19 / 16 |
| C2 | 19–32 (52) | 17–29 (47) | 14–24 (39) | 25 / 22 / 19 |

Bands overlap on purpose (levels are a continuum); targets in the prompt are the mid-points, strictly increasing
(unit test asserts monotone means and >=20 % gaps between neighbours).

Verdict: green = mean in band AND overCap ok; yellow = mean outside band by <=25 % of the band edge or overCap <=25 %;
red = beyond. Asymmetric emphasis: for A1–B1 the dangerous side is "too complex" (upper bound), for C1–C2 "too simple"
(lower bound) — both are flagged, message says which. Informational metrics are printed in `detail`
(«B1: o'rtacha gap 13,2 so'z (kerak 10–14) · eng uzun 31 · vergul/gap 1,4»), never gate.

Derived level-scaled constants (so the old hard numbers stop fighting): thesis range in `outlinePrompt`
(A1 6–10, A2 8–14, B1 10–20, B2 12–28, C1/C2 14–35 words), `claimMinWords(level)` replaces the fixed 8/5 in
`review.ts` (thesis min = clamp(round(0.8 x targetMean), 4, 8); topic sentence min = clamp(…, 3, 5)).

### 3.5 Default
- Form default and server default for missing/invalid value: **B2** (single global default; recommended pending
  the baseline measurement — if live baseline of the CURRENT prompts shows school/academic ~C1, switch the default to C1).
- Legacy docs (no `doc.essay.level`): `level = null` everywhere -> prompts, judge and rule are byte-identical to today.
- `essayInputFromValues`: IELTS -> `level = null` regardless of what a stale draft carries.

### 3.6 Enforcement stack (cheap -> strong)
1. Prompt block (system) + reminder (user) — all calls inherit via `essaySystemPrompt(ctx)`.
2. **Level repair pass in the engine** (new, mirrors the existing word-range retry at `engine.ts` :167): after guard,
   `measureLevel` on the text; if verdict != green AND >25 s left, ONE `writer` call with `levelRepairPrompt`
   ("rewrite the whole essay at CEFR X: mean N, cap M…, keep structure, thesis, every USER FACT verbatim, same language,
   same word range"). Accept only if (a) distance-to-band strictly improved and (b) `wordRangeOk` not broken and
   (c) guard report not worse (no new unsourced numbers). Cost: one extra LLM call only on mismatch. Preferred over
   relying on polish because polish only starts at score < 90 and one yellow rule moves the score ~1.5 points.
3. Review rule **`level`** (13th rule, label «Til darajasi», `fix: rewrite("essay", levelRepairInstruction)`) so the
   panel shows the result and manual «Hammasini tuzatish» can fix it; skipped when `level == null`. Panel group
   falls back to "Tuzilma" with no change to `REVIEW_GROUPS` (tests pin its labels).
4. Judge calibration: `essayJudgeSystemPrompt(context, kindLabel, level?)` appends to `roleLine`
   «The essay is DELIBERATELY written at CEFR {L} ({descriptor}). Judge vocabulary/sentence-variety criteria against
   this target: do not penalise simplicity that matches the level, penalise errors, repetition, and mismatch in either
   direction. Never propose a fix that raises or lowers the level.» and `judgeHeader` gets `TARGET LEVEL: B1`.
   `judgeFromReview`/rubric math unchanged.

### 3.7 Interaction with other knobs
- **Word count / pages**: unchanged budgets; shorter sentences just mean more sentences per paragraph. Existing
  word-range retry still applies (watch: A1 may undershoot; `wordRangePrompt` already says "never padding").
- **Essay type/context**: structure rules stay; level overrides style wishes (see block). Academic + A1 is legal
  («simple academic essay for a school pupil»): hedging "may/often" is allowed at A2+, at A1 it is dropped.
- **Person / extra**: orthogonal; level wins over `extra` on complexity only.
- **Price**: none. **Language**: independent; output-language-specific numbers/connectors come from `levelTargets`.
- **In the document?** No. Level only shapes the text; it is not printed into the essay/titul. Shown in the review
  panel (rule detail) and in the form summary caption. No viewer meta chip (essay has none today) — optional later.
- **History repeat/draft**: `toValues`/`uiFromValues` carry `essayLevel`; unknown value -> default via the server
  function (same round-trip as every other field). Existing drafts without it get B2.

### 3.8 UI (phone-first)
- 6 options -> by rule #4 of `forms3-etalon.md` §5 (`<=6` Segmented, `>=7` SelectField) a **`Segmented`** is correct.
- Fits 360 px? Segmented is `inline-flex flex-wrap`, buttons `px-2.5 py-1 text-xs`. Labels `A1…C2` (2 chars, ~14 px
  text) -> ~34 px per button x 6 + gaps ~ 215 px; inner width in a Card at 360 px ~ 296 px -> **one row, fits**.
  Long labels («A1 — boshlang'ich») would wrap to 3 rows -> do NOT put names in the buttons.
  Caveat (global, for the mobile-UI package): Segmented height is ~26 px — below 44 px touch target; a larger
  `touch` variant belongs to R5/mobile sweep, not here.
- Place: card «Hajm va til», new `Row label="Til darajasi"` right after «Til» (hidden for IELTS), `Field id="essayLevel"`.
  Closed form grows by ~1 Row (+~50 px incl. caption) — checklist #14 requires re-measuring (<=1 200 px @1400).
- **Caption under the control** (live text of the chosen level, 11 px muted) because `Row hint` is a `title` tooltip =
  invisible on touch. This deviates from etalon rule #3 («izoh faqat tooltipda») on purpose; also keep the tooltip.
  Uzbek names + hints:

| Code | Name | Caption (selected) |
|---|---|---|
| A1 | Boshlang‘ich | Juda qisqa, sodda gaplar (5–9 so‘z), kundalik so‘zlar, atamasiz |
| A2 | Sodda | Qisqa gaplar, oddiy bog‘lovchilar (va, lekin, chunki), atama kam va izohli |
| B1 | O‘rta | Ravshan, o‘rtacha uzunlikdagi gaplar; atamalar birinchi uchraganda izohlanadi |
| B2 | O‘rta-yuqori | Murakkab gaplar, xilma-xil bog‘lovchilar, mavzu atamalari erkin |
| C1 | Ilg‘or | Uzun, tarkibli gaplar, aniq atamashunoslik, ravon akademik uslub |
| C2 | Mukammal | Boy leksika, nozik ottenkalar, ritorik vositalar |

  Tooltip/footnote line (all levels): «CEFR — matn murakkabligi darajasi; til har qanday bo‘lishi mumkin.» (the A1 «5–9
  so‘z» numbers in the caption must come from `levelTargets`, not hard-coded, so UI and prompt cannot diverge).
- Collapsed «Sozlamalar» summary unchanged (level is in the main card).

---

## 4. Files that change + tests required

| File | Change |
|---|---|
| `lib/generation/essay/level.ts` (NEW) | everything in §3.2–3.5 |
| `lib/generation/essay/types.ts` | `EssayModel.level?: CefrLevel` (type import only) |
| `lib/generation/essay/input.ts` | `EssayInput.level`, parse/default/IELTS-null, `encodeEssayValues` `essayLevel` |
| `lib/generation/essay-params.ts` | 13th param + header comment |
| `lib/generation/essay/prompts.ts` | `EssayCtx.level`, level block in `essaySystemPrompt`, `levelReminder` in `essayPrompt`/`rewritePrompt`, level-scaled thesis range in `outlinePrompt`, `levelRepairPrompt`, `judgeHeader` target line |
| `lib/generation/essay/engine.ts` | `model.level`, repair pass after word-range retry |
| `lib/generation/essay/review.ts` | `level` rule + `ESSAY_RULE_IDS`, `claimMinWords`, judge system prompt calibration param |
| `lib/generation/essay/polish.ts` | `contextOf`: `level: model.level ?? null`; pass level to judge in `reviewEssay` (via model) |
| `lib/generation/essay/index.ts` | export new API |
| `components/forms/EssayComposer.tsx` | `Ui.level`, `emptyUi`, `toValues`, `uiFromValues`, Row + caption, hide for IELTS |
| (optional) `lib/server/admin-pricing.ts` :842 | analytics select could add `essayLevel` — admin owner's file, skip |
| `lib/tools.ts`, `lib/generation/meta.ts`, `validate.ts`, viewer, price | **no change** (verified) |

Tests (all single-file via `scripts/heavy.sh npx tsx --conditions=react-server --test <file>`; UI: `--tsconfig tsconfig.viewer.json`; none need a DB):
1. `tests/essay-level.test.mts` (NEW): registry shape (6 ids, monotone means, >=20 % gaps, per-language bands, caps);
   splitter table (initials `G‘.`/`A.`, decimals, «…» quotes, ellipsis, dialogue dash, abbreviations, empty text);
   measure on hand-written fixtures per level x uz/ru/en (A1 fixture green at A1, red at C2 and v.v.; boundary
   +-25 %); informational metric absent for uz; prompt block contains numbers + connector list for each of uz/ru/en
   and the "OVERRIDES" sentence; `claimMinWords`/`thesisWordRange` monotone.
   *Mutations*: widen A1 band to 4–20 -> A1 fixture test red; drop uz multiplier -> uz table test red; make
   splitter split after `G‘.` -> table test red; remove "OVERRIDES" line -> prompt test red.
2. `tests/essay-params.test.mts`: length 12 -> 13; new param probed (A2 vs C1 differ in prompt/review/layout; price
   equal via existing loop). *Mutation*: stop injecting the block -> `prompt` probe red; stop storing `model.level`
   -> `layout` red; make the `level` rule ignore the level -> `review` red.
3. `tests/essay-input.test.mts`: parse `"b1"`, `" C2 "`, `"X9"`, `5`, missing -> B2; IELTS -> null; encode/decode round trip.
4. `tests/essay-engine.test.mts`: stub returns complex text for level A1 -> exactly ONE repair call (assert user prompt
   starts with the repair header) and result accepted when closer; rejected when it breaks the word range or is
   worse; NO extra call when green or `level=null`; `doc.essay.level` set. *Mutation*: remove the accept guard ->
   "rejected" case red; always repair -> "no extra call" red.
5. `tests/essay-review.test.mts`: `level` rule green/yellow/red + fix present; skipped for null; thesis check at A1
   accepts a 6-word thesis (old code: red) — mutation: restore fixed `8`; judge system prompt contains the calibration;
   `judgeUserPrompt` contains `TARGET LEVEL`.
6. `tests/essay-wiring.test.mts`: `contextOf(doc)` keeps `model.level`; `rewriteEssayFix` system prompt carries the
   block; legacy doc (no level) -> prompt identical to current (snapshot of `essaySystemPrompt` for a null-level ctx
   equals the pre-change string — guard against silent default injection).
7. `tests/ui/essay-composer.test.mts`: `data-field="essayLevel"` present for school + academic, absent for IELTS;
   6 radios `A1…C2`; default B2; click sends `essayLevel` in POST body; draft restore with `"junk"` -> B2; caption text
   follows the selection; context switch keeps level. (The generic coverage test enumerates `ESSAY_PARAMS`, so it
   fails automatically if the field is not rendered.)
8. Manual (etalon #18, no automated test): 360 px and 390 px Chromium screenshot of the card — one row, no overflow.
9. Do NOT run the whole suite; before commit, lead runs `npm run check` once.

---

## 5. `npm run live` plan for the lead (do NOT run now) — ~10–12 essays, cheap

Step 0 (BEFORE the change, on current `main`): run existing `essay-dtm essay-academic essay-ielts`; feed the saved
`eval-out/live/*.doc.json` to the new measurer -> baseline mean/p90/long-word share -> choose the default level.
(Needs only `level.ts` + a tiny `scripts/level-measure.mts` that reads doc.json files: no API cost, re-runnable.)

Step 1 (after): add cases to `scripts/live-engine.mts` (checks print measures, assert verdict green or yellow at worst):
- `essay-lvl-dtm-a1`, `essay-lvl-dtm-b1`, `essay-lvl-dtm-c1` — school_dtm, reflective, uz, same topic, 2 pages.
- `essay-lvl-acad-en-a2`, `-b2`, `-c2` — academic argumentative en, 700 words.
- `essay-lvl-acad-ru-b1`, `-c1`; `essay-lvl-acad-uz-a2` — to see ru/uz scaling.
- `essay-lvl-dtm-default` — no `essayLevel` (must equal B2 behaviour).
Pass criteria: (1) means strictly increasing across levels per language with >=20 % gaps; (2) verdict green for >=80 % of
cases without repair, 100 % after repair; (3) repair pass triggered <=30 % and always accepted when triggered;
(4) `wordRangeOk` and all old checks (`essayChecks`) still green; DTM score at A1 not < (default score - 10) — if it is,
the judge calibration is leaking; (5) A/B: default-level essays vs Step-0 baseline: review score within +-5.
Step 2 human read (Uzbek!): read A1 and C2 uz outputs — A1 must be natural, not telegraphic; C2 must not be padded
nonsense. LLM drift note: models drift UP in complexity, A1 uz is the likely weak spot; the repair pass is the safety net.

---

## 6. Work packages (non-overlapping files)

Order: WP-1 first (small, defines the API both others import) -> WP-2 and WP-3 in parallel -> WP-4. Max 2 heavy processes at once.

- **WP-1 core (opus or strong sonnet)** — `lib/generation/essay/level.ts` (new), `essay/types.ts`, `essay/input.ts`,
  `essay-params.ts`, tests `essay-level.test.mts` (new), `essay-input.test.mts`, `essay-params.test.mts`.
  Deliverable: stable exported API listed in §3.2 (lead freezes signatures first so WP-2/3 can start against stubs).
- **WP-2 engine wiring** — `essay/prompts.ts`, `essay/engine.ts`, `essay/review.ts`, `essay/polish.ts`, `essay/index.ts`;
  tests `essay-engine.test.mts`, `essay-review.test.mts`, `essay-wiring.test.mts`. Depends on WP-1 API.
- **WP-3 UI (sonnet)** — `components/forms/EssayComposer.tsx`, `tests/ui/essay-composer.test.mts`; plus the 360/390 px
  screenshot and closed-form height measurement. Depends only on `CEFR_UI`/`levelTargets` from WP-1.
- **WP-4 live harness (haiku/sonnet)** — `scripts/live-engine.mts` (cases), `scripts/level-measure.mts` (new). No runs.
- Lead: review, Uzbek/Russian connector table check by a native reader, run live (§5), commit per package.

---

## 7. OWNER questions (recommended first)

1. **Default level** when the user does not touch it: (a) **B2** [recommended, may change to C1 after baseline measure];
   (b) C1 (closest to today's likely behaviour); (c) different default per context (school B2, academic C1).
2. **IELTS Task 2**: (a) **no level control, fixed to band-style C1** [recommended: IELTS has its own scale];
   (b) allow only B2–C2; (c) allow all six (A1 IELTS essay would score band 4 by design).
3. **Show the level anywhere in the result?** (a) **No — only shapes text; shown in the report panel check** [recommended];
   (b) also a small chip in the result header; (c) print into the document/titul (not recommended).
4. **Level repair pass** (one extra LLM call only when the text misses the level): (a) **yes, automatic** [recommended]
   (b) only via the report «Tuzatish» button (no extra cost, lower adherence).
5. **UI captions on phone**: OK to show the selected level's one-line description under the control (deviates from
   etalon "hints only in tooltip", but tooltips don't exist on touch)? (a) **yes** (b) tooltip only.
6. Scope of "any language": the essay tool supports uz/ru/en only (IELTS en, school uz). OK, or add more essay
   languages later (the level tables then need a per-language row)?

## 8. Risks

- **Model adherence**: LLMs drift upward; A1/A2 in Uzbek is least reliable. Mitigation: measure + one repair pass +
  live matrix. Unmitigated residue: some A1 essays will land yellow.
- **Thresholds are heuristics** (English rule-of-thumb x language multipliers, NOT measured on our outputs) — must be
  calibrated in step 0/1; keep them in one data table. Splitter errors (abbreviations, dialogue) skew mean by a few %.
- **Judge/score interplay**: level-calibrated judge must not become lenient generally; test that mismatch still lowers
  the score; watch DTM score at A1/A2 vs default.
- **Default injection changes behaviour for everyone** (even users who ignore the control) — A/B vs baseline before
  merge; legacy docs deliberately unchanged (`level = null`).
- **Registry/test coupling**: 12 -> 13 literal in `essay-params.test.mts`; probe for `essayLevel` must use a non-IELTS
  `probeWith`, otherwise A/B identical (IELTS ignores it) and the differential test fails.
- **Word budget**: very short sentences at A1 may undershoot the word range (existing retry handles, costs a call).
- **Touch targets**: Segmented buttons ~26 px high — global mobile issue, not solved by this feature.
- **CEFR semantics**: not a standard of text complexity; keep UI wording «matn murakkabligi», avoid promising "real A2
  certification".
- **Extra free text** that contradicts the level (e.g. «uzun jumlalar») — level wins on complexity; document in hint.
