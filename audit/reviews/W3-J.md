# W3-J review: C12 (BEA-01 + ABUSE-03), `priceFor` via the engine normalisers

- **Reviewer:** independent, read-only.
- **Branch:** `worktree-agent-a645a085397bf8a0d` (`3864cc4`, `d62346c`, `b3da704`, `005780e`).
- **Base:** `audit/production-readiness` @ `8a41ac0`. The merge-base is `774557d`, and none of the touched files, `budget.ts` or `meta.ts` changed between the two.

## Verdict: **CHANGES REQUESTED** (one small, contained change; everything else is approvable)

The owner's hard constraint holds: **0 canonical prices changed.** Every malformed and near-miss value now prices exactly what the engine builds, except one row of the triage table: `referat` / `mustaqil-ish` with `pages` **omitted or `null`**. That row still charges 3 000 while the engine writes a 20–25 page document (list price 5 000). The fix keeps this gap on purpose, and its new snapshot test locks it in as "canonical".

## 1. Canonical invariance

- **Method:** a script (`scratchpad/w3j-compare.mts`) imports `lib/tools.ts` from both the base checkout and the fix worktree and runs `priceFor` on every input the forms can send.
- **Result: 365 inputs compared, 0 changed.**

| tool | inputs enumerated (what the form or its price labels send) | n | changed |
|---|---|---|---|
| coursework | 3 kinds × 7 tiers × (`{workKind,pages}`, `{pages}` label call) + form initial state per kind + `{}` | 46 | 0 |
| referat | 4 kinds × 4 tiers × 2 + initial state ×4 + `{}` | 37 | 0 |
| mustaqil-ish | 1 kind × 4 tiers × 2 + initial + `{}` | 10 | 0 |
| essay | 3 contexts × pages 1..5 × (`{essayContext,pages:"n"}`, `{pages:"n"}` label, `{pages:n}`) + per context + `{}` | 49 | 0 |
| glossary | 4 types × terms [10,20,40] × (number as the form sends, string, label call `{termCount:n}`) + type default + `{}` | 41 | 0 |
| article / thesis | every `ARTICLE_TYPES` × its pages (+ thesis 1-2/3-5) | 28 / 30 | 0 |
| slide / pro-slide | slideCount 1..40 + `{}` | 41 / 41 | 0 |
| image | imageCount 1–4 + `{}` | 5 | 0 |
| translation | sourceChars 0…200 000 + `{}` | 8 | 0 |
| lesson-plan, texnologik-xarita, keys, test | every registry type + `{}` | 6/3/5/7 | 0 |
| resume, crossword, flashcards, infographic, sorting, listening, podcast, greeting | `{}` (these tools' `priceFor` branches are untouched by the diff and are flat `basePrice`) | 8 | 0 |
| **total** | | **365** | **0** |

The diff only touches the essay, work and glossary branches. The other branches are byte-identical.

## 2. Malformed inputs: fix price vs. what the engine builds

The engine value comes from the engines' own functions: `normalizeWorkPages` (the call `work/input.ts:296` makes), `essayInputFromValues().pages`, and `teacherInputFromValues(...,"glossary").termCount`.

| input | base | fix | engine builds | ok? |
|---|---|---|---|---|
| coursework `"40-45 "` / `"\t25-30"` | 12 000 / 12 000 | 24 000 / 18 000 | 40-45 / 25-30 | yes |
| coursework `"zzz"`, `43`, `"43"`, `"999"`, `" "`, `""`, `"10–15"` (en dash) | 12 000 | 16 000 | 20-25 | yes |
| coursework `{}` / `null` | 16 000 | 16 000 | 20-25 | yes (default already 20-25) |
| referat / MI `"25-30 "`, `"zzz"`, `""`, `" "`, `"43"`, `"30-35"` | 3 000 | 6 000 / 5 000 | 25-30 / 20-25 | yes |
| **referat / MI `{}` and `{pages:null}`** | 3 000 | **3 000** | **20-25 (5 000)** | **NO: residual underpay of 2 000** |
| essay `"5 "`, `" 5"`, `"4.6"`, `"99"`, `"1e1"` | 2 000 | 4 000 | 5 | yes |
| essay `""`, `" "`, `"abc"`, `Infinity` | 2 000 | 2 500 | 2 | yes (engine writes 2 pages) |
| essay `"0"`, `"-3"` / `"4.4"` / `2.5` / `"0x3"` | 2 000 / 2 000 / 2 000 / 2 000 | 2 000 / 3 500 / 3 000 / 3 000 | 1 / 4 / 3 / 3 | yes |
| glossary `"39"`, `"40 "`, `21`, `"999"` | 6 000 | 15 000 | 39 / 40 / 21 / 40 | yes (ceil to the 40 tier) |
| glossary `"11"`; type `zzz` + `"15"` | 6 000 | 9 000 | 11 / 15 | yes |
| glossary `imtihon-atamalari`, termCount omitted | 6 000 | 9 000 | 20 (type default) | yes |
| glossary `""`, `null`, `"0"`, `"5"`, `"abc"`, `"-50"`, `"10.4"` | 6 000 | 6 000 | 10 | yes |

**"Garbage → 20-25 tier" matches the engine.** `normalizeWorkPages` trims, then either returns the value when it is in `kind.pages` or falls back to `"20-25"`. Every work kind contains "20-25", and the tier lists are identical across kinds within a genre, so `workKind` never changes the result. `extractMeta` is not used for the engine's pages: `work/engine.ts` overrides meta with `input.pages`.

**Why `{}` differs.** `workPagesFor` fills a missing value with `values.pages ?? defaultPages(toolId)`, which is "10-15" for referat and mustaqil-ish, *before* normalising. The engine never does that fill. So `{}` and `{pages:null}` cost 3 000, while `{pages:""}` costs 5 000, even though the engine builds the same 20–25 page document for all three. The code comment says the form's standard is "10-15". That is true of the form's *initial UI state*, but `WorkComposer` always sends `pages` (`WorkComposer.tsx:195,288`). An omitted `pages` therefore only comes from a crafted request, which is non-canonical by the owner's definition, and the constraint allows its price to move to what the engine builds.

## 3. The two rewritten assertions in `tests/pricing.test.mts`

The rewrite is legitimate. Both assertions encoded an accident, not a product rule.

- **`"noma'lum hajm — standart narx, 0 emas"`** ("unknown volume: standard price, not 0"). It dates from `c153bc3` (2026-08-19), before `work/registry.ts` existed. The title and the sibling assertion (`> 0`) show the rule was "never free". `cw.basePrice` was simply what the exact-lookup fallback returned at the time. After AUDIT-19 the engine clamps unknown values to 20-25, so the assertion was pinning a price below what gets built.
- **`"noma'lum son → standart tarif, bepul emas"`** ("unknown number: standard tariff, not free"). It comes from `a573056` (AUDIT-20 R0). Again the message says the intent is "not free". The engine already clamped to 40 at that commit.
- No AUDIT doc states a rule that off-tier values bill the cheapest tier. The new values (16 000 and 15 000) are the engine tiers, and each assertion keeps a `notEqual(basePrice)` mutation guard.

## 4. Engine behaviour is unchanged

- `essay/input.ts`: `export` added only.
- `teacher/input.ts`: `glossaryTermCount(values)` computes `teacherTypeOf("glossary", teacherTypeIdOf("glossary", values))` and then the same `num(termCount, termsDefault, termsMin, 40)`. The inline code used `type = teacherTypeIdOf(kind, values)` with `kind === "glossary"`, so the result is identical. The non-glossary branch is untouched.
- There are no new import cycles. `essay/input`, `teacher/input`, `work/types` and `work/registry` do not import `lib/tools.ts`, and none of them import server-only code, so they are safe to pull into the client bundle through `lib/tools.ts`.

## 5. `budgetFor`

`budgetFor` is unchanged. It is consistent for every canonical input: `parsePages(tier)` equals `pagesMid(tier)` for all 7 tiers, which I verified for 10-15, 20-25 and 40-45 on every work tool. For malformed input it can under-budget:

| input | budget | engine needs |
|---|---|---|
| referat / MI `{}`, `null`, `""`, `" "`, `"zzz"` | 357 000 ms (`extractMeta` falls back to "10-15", 13 pp) | 447 000 ms (20-25) |
| any work tool, `"10–15"` (en dash) | 330 000 ms | 447 000 ms |
| `"999"` | 9 231 000 ms (clamped by `WORKER_JOB_TIMEOUT_MS`) | over-budget; pre-existing, only holds a slot |

- **Real jobs are not under-budgeted.** Every form-sent value budgets correctly.
- **New side effect of the fix.** `"zzz"`-style referat requests are now *charged* 5 000 but still budgeted for 13 pages, so they are more likely to hit the deadline or the volume gate and be refunded in full. That costs no money, but it is inconsistent.
- **Glossary:** `teacherSize` = `min(40, termCount || 10)` ignores the type default and `termsMin`. For example, `imtihon-atamalari` with termCount omitted budgets 10 terms while the engine writes 20. This only affects malformed input, and its effect is small.

## 6. Tests

- Pricing and param files: `tests/price-normalisation.test.mts`, `pricing.test.mts`, `work-params.test.mts` and `essay-params.test.mts` ran through `heavy2.sh`: **42/42 pass**.
- Other suites that reach the touched code: `teacher-params`, `teacher-input`, `work-registry` and `generation`: **90/90 pass**.
- Comparison script: 365 canonical inputs, 0 changed.

## Required changes

1. **R1: close the omitted-`pages` row.**
   - In `lib/tools.ts` `workPagesFor`, pass the raw value: `normalizeWorkPages(kind, values.pages)`. Drop the `?? defaultPages(toolId)` fill.
   - Effect: `{}` and `{pages:null}` for referat / mustaqil-ish price at 5 000 (20-25, what the engine builds). Coursework is unchanged because its default is already 20-25. No canonical input changes: the form always sends `pages`, and every UI price label passes an explicit tier.
   - Update the two snapshot rows `[referat, {}, 3000]` and `[mustaqil-ish, {}, 3000]` to 5000, or better, move them to the differential `CASES` table with `engineTier {pages:"20-25"}`. Also add `{pages:null}`.
   - **Alternative:** the owner decides the engine default should be "10-15", and the engine is changed instead (`normalizeWorkPages(kind, values.pages ?? defaultPages)` in `work/input.ts`). The triage flagged this as an OWNER DECISION. The price-side change is the one that fits this package's "only malformed inputs move, toward the engine" rule.
2. **R2 (same commit, so R1 jobs complete instead of refunding): budget work tools from the engine's value.**
   - In `lib/generation/budget.ts`, for coursework, referat and mustaqil-ish, use `workBudgetMs(pagesMid(normalizeWorkPages(workKindOf(genre, values.workKind ?? values.kind), values.pages)))` instead of `extractMeta().targetPages`. Canonical budgets stay identical.
   - Add the triage's assertion: `budgetFor(referat, {}) ≥ workBudgetMs(pagesMid("20-25"))`.

## Non-blocking follow-ups (outside C12)

- **Essay word sizing.** In word-sized contexts (academic, range 500–1 000), the price comes from `pages`, while the engine sizes from `wordTarget`, clamped only to the context range. For example, `{essayContext: academic, pages:"1", wordTarget:1000}` costs 2 000; the form would send `pages:"4"` for that input, which costs 3 500. This is the same class of bug. Price from `pagesForWords(wordTarget)` when `sizing === "words"`, or clamp `wordTarget` to `pages`.
- **Glossary `teacherSize`.** Use `glossaryTermCount(values)` so the budget follows the type default and `termsMin`.
- **Defence in depth** (triage fix notes): optionally have `preflightError` return 400 for off-tier `pages` / `termCount`, so no fallback is ever billed.

---

## Re-review: commit `1ef9480` (R1 and R2): **APPROVE**

**R1 is fixed.**
- `workPagesFor` now calls `normalizeWorkPages(kind, values.pages)`, with no `defaultPages` fill. This is exactly how `work/input.ts` reads the value.
- Referat and mustaqil-ish requests with `pages` omitted or `null` now price at 5 000 (20-25), the tier the engine builds. Coursework is unchanged.
- The snapshot rows moved into the differential `CASES` table, and `{pages:null}` was added.
- The `generation.test.mts` "standart hajm narx, dvigatel va formada bir xil" test ("default volume: price, engine and form agree") now compares against the engine default. That is the correct rule.

**R2 is fixed.**
- `budgetFor` sizes the three work tools with `workBudgetMs(pagesMid(normalizeWorkPages(workKindOf(genre, workKind ?? kind), pages)))`. This uses the same kind resolution as the engine.
- The new branch sits after the fixed, teacher, game, audio, infographic and translation branches and before the `extractMeta` fallback, so other tools are unaffected.
- There is no import cycle: `work/registry` and `work/types` do not import `budget.ts` or `tools.ts`.

**Re-run of the comparison script (base `8a41ac0` vs `1ef9480`):**

| check | compared | changed |
|---|---|---|
| `priceFor`, canonical inputs | 365 | 2: `referat {}` and `mustaqil-ish {}`, 3 000 → 5 000 |
| `budgetFor`, canonical inputs × caps {10 M, 600 k} | 730 | 4: the same two `{}` inputs × 2 caps, 357 000 → 447 000 |

The script's sweep included `{}` for every tool. For work tools, `{}` is **not** a form input:
- `ToolWorkspace` routes `custom === "work"` straight to `WorkComposer` (`ToolWorkspace.tsx:127`).
- `WorkComposer` always sends `pages` (`:195`, `:288`).
- Every price label passes an explicit tier (`:404`).
- No other caller of `priceFor` passes work values without `pages`.

So those two rows are the intended R1/R2 malformed-input fix. For the inputs the forms really send, the result is **363/363 prices and 726/726 budgets unchanged**.

**Malformed-input table re-run:**
- 0 MISM: every malformed work, essay and glossary input now prices at what the engine builds.
- 0 UNDER: no work input's budget is below the budget for the tier the engine builds, including `{}`, `null`, `""`, `"zzz"` and the en-dash `"10–15"`.

**Suites through `heavy2.sh`:**
- `price-normalisation`, `pricing`, `work-params`, `essay-params`: **44/44**.
- `teacher-params`, `teacher-input`, `work-registry`, `generation`, `slide-params`, `audio-params`: **117/117**.

**Not re-run here:** `tsc --noEmit` and eslint. The commit message says both are clean.

**Still open, non-blocking** (unchanged from above): the essay word-sizing gap, glossary `teacherSize`, and optional `preflightError` 400s for off-tier values.
