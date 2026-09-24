# AUDIT-25 P5 review: verification tooling

Reviewer: independent (read-only). Branch `worktree-agent-a837f869dce9869db`, commits `8820476`, `2ef84bc`
(diff vs `e89c7c1`). Files: `scripts/slide-audit.mts`, `scripts/live-engine.mts`, `package.json`,
`tests/slide-audit.test.mts`. Contract: `slides-3:docs/AUDIT-25.md` §1 (S1–S4), §2.1–2.7, §3.

## Verdict: CHANGES

The architecture is sound. `auditSlideDoc` is a pure function that both the CLI and `live-engine` import.
The parity cases keep every previous check, and the new case values are all valid registry ids.
Before this becomes the live gate, five things need fixing:

- the tool does not flag the real `…` cuts in the baseline decks (thin=0 on all 6),
- the ordinal-leak rule fires on legitimate titles,
- untagged old decks are reported as "coverage 0/N",
- directory mode can never pass on `eval-out/live`, and the engine does not write slide `doc.json` there,
- 4 of the 5 mutants I tried survive the tests.

## What I ran (one heavy command, `heavy2.sh -m 2G -t 600`)

| Step | Result |
|---|---|
| `tsx --test tests/slide-audit.test.mts` | 22/22 pass |
| Mutant m1: drop the "title first" rule (`slide-audit.mts:181`) | **survives** (22/22) |
| Mutant m2: drop the "closing last" rule (`:184`) | **survives** (22/22) |
| Mutant m3: drop `.toLowerCase()` in `normTitle` (`:79`) | **survives** (22/22) |
| Mutant m5: drop ordinal strip in `normTitle` (`:76`) | **survives** (22/22) |
| Mutant m4: drop the plan-order rule (`:105`) | killed (21/22) |
| CLI on `eval-out/audit25-baseline/` (6 real pre-fix decks, no `plan` tags) | exit 1. Each deck prints N separate `plan-coverage` lines and `plan=0/N`. **thin=0 on all 6**, but A4 found 6 mid-word `…` cuts in lecture-12 (`twoCol` ×5, `quoteBy`) and 1 in defense-14 (closing subtitle) |
| CLI on `eval-out/live/` | exit 1: every non-slide `*.doc.json` (article, crossword, …) is counted as a failure |
| CLI with no argument or a missing path | exit 2 (correct) |
| `tsc --noEmit -p <worktree>` | exit 0. `tsconfig.json` `include` has `**/*.mts`, so `scripts/` and `tests/` are type-checked. The claim holds. |
| Removed vs added lines in `live-engine.mts` | every removed line reappears verbatim (the parity cases were moved, not edited) |

Probes run on `auditSlideDoc` (all hand-built decks):

| Probe | Result | Correct? |
|---|---|---|
| Old deck: agenda with 3 bullets, no `plan` anywhere | 3 × `plan-coverage` | wrong: should be one "plan not tagged" |
| Title `1.5 million gektar yer qurigan` | `ordinal-leak` | **false positive** |
| Title `M. Ulug'bek merosi` / `D. Mendeleyev jadvali` | `ordinal-leak` | **false positive** |
| Motivation quote `Orol nega qurib qoldi?` (prompt says «savol yoki fakt») | `thin-quote` | false positive (not a §2.6(b) rule) |
| Goals bullets of 2–4 words (maqsadlar block) | `thin-bullets` | likely false positive for block slides |
| No agenda (`agendaSlide:false`), plan tags 1,3,2 (out of order) | OK | missed |
| Agenda with 1 bullet but a slide tagged `plan:2` | OK | missed (agenda/plan desync) |
| Honest skeleton `stats[{value:"—"}]` in the file (§2.5 says it must never reach the file) | not flagged | missed |
| `titleSlide:false` with agenda at #1, references before closing | OK | correct |
| Quiz slides between plan groups, `answers` slide, references before closing | OK | correct |
| Agenda `Birinchi  Bo'lim` vs title `birinchi bo'lim` | OK | correct |

## (1) Rules vs the contract

- **Plan coverage, order and title** (§2.1–2.2) are implemented correctly for tagged decks. The title
  check uses the `section` slide if the group has one, otherwise the first slide. That matches §2.1
  (section comes first, then content), but P1 has not landed yet (`agent-a685…` has no `plan`/`planCapacity`).
  Check the choice against P1's agenda sync at merge time.
- **Right behaviour for untagged or agenda-less decks** (my decision for the live gate):
  - agenda present and no slide has `plan` → emit one `plan-untagged` issue. It is still a FAIL, because in
    the live gate that means P1 regressed. The CLI prints `plan=untagged/N`, not `0/N`.
  - no agenda and no `plan` (old deck, `agendaSlide:false`) → the plan section passes silently. This is
    what happens today, and it is right.
  - no agenda but `plan` tags present (P1 tags plan slides even when `agendaSlide:false`, per §2.1) → still
    check that the tags run 1…max with no gaps and in order.
  - agenda present → `max(plan)` must equal `agenda.bullets.length`.
- **Ordinal leak.** The regex over-matches, as the probes show.
- **Stray numbers.** The rule only catches the old skeleton (`"3"` / «Asosiy nuqta»). It misses the §2.5
  honest skeleton (`"—"`, `["…"]`, step text equal to the role), which is exactly what §2.5 says must never
  reach a file.
- **Thin content.** The rule duplicates P3's `thinSlides` instead of calling it, even though the file
  documents this. It also adds rules that are not in §2.6(b) (`thin-quote`) and applies the bullet rule to
  block slides (goals, homework) that are short by design.
- **Truncation.** The rule only checks quiz options. Decision 7 lists «…» cuts as a check of their own, and
  the baseline shows them in other fields.
- **Block order.** Correct for `titleSlide:false`, quiz runs, `answers`, and references before closing.

## (2) `live-engine.mts`

- Every earlier check in `slide` and `pro-slide` is kept, and `slideAuditChecks` is appended. The case
  order in `CASES` is unchanged (they still come after `audioCases`).
- New cases use real ids and valid values:
  - `slideAudience`: school_5_7, school_8_9, students_bachelor, management
  - `slidePurpose`: lesson, lecture, open_lesson, report
  - `slideImageStyle`: minimal
  - `quizCount`: 3 (a value in `QUIZ_COUNTS`)
  - `textVolume`: qisqa, standart
  - `planItems` / `slideCount`: within range

  The only non-registry id is the old `quality: "standard"` in the `slide` case (`:753`). It was there
  before this branch, is not P5's, and does no harm.
- Budgets (220–380 s) are in line with the existing `pro-slide` (400 s) and `slide` (260 s) cases. Cost
  for the 7 slide cases is about 26 Gemini images (≈$0.9) plus text calls, well under the $4 cap. Run the
  gate by name. Running `npm run live` with no case names runs every tool.
- `pro-slide-min` is right in direction but wrong in detail. See CHANGE 6.

## (3) Test quality

The file header says each test checks that ONLY the injected defect fires (`tests/slide-audit.test.mts:9`),
but every test only asserts `includes(kind)`. As a result:

- the title-first test swaps title and agenda, so the agenda rule fires too and m1 survives;
- the closing test moves closing in front of the agenda, so the agenda rule fires too and m2 survives;
- nothing tests the case-, space- or ordinal-insensitive title match, so m3 and m5 survive.

Plan-order (m4) is properly covered.

## (4) CLI

Exit codes are 0 (all OK), 1 (any deck failed or unreadable) and 2 (usage error, bad path or no files).
These are fine. The `import.meta.url` guard correctly keeps `main()` from running when `live-engine`
imports the module.

## CHANGES (numbered, concrete)

1. **Untagged decks: report "plan not tagged", not "coverage 0/N".** At `scripts/slide-audit.mts:91-117`:
   - if `agenda && !slides.some(s => typeof s.plan === "number")`, push one issue
     `{slide: agendaIdx+1, kind: "plan-untagged", detail: "reja bandlari slaydlarga bog'lanmagan (plan maydoni yo'q — eski doc_json yoki P1 regressiyasi)"}`
     and skip the per-item loop. It stays a FAIL.
   - `planCoverage` (`:198-204`) and the summary line (`:267`) must print `plan=untagged/N` in that case.
   - Add a test for it, and one for "no agenda and no plan → no plan-* issue". That second case already
     works but only as a side effect.

2. **Check plan tags against each other, not only against the agenda.** At `:91-117`:
   - with agenda: any slide whose `plan` is outside `1..agenda.bullets.length` → `plan-extra`;
   - without agenda: collect the distinct `plan` values and require `1..max` contiguous and in order
     (reuse the same `lastGroupMaxIdx` logic) → `plan-coverage` or `plan-order`.

   §2.1 makes plan slides a contract whatever `agendaSlide` says, and §2.2 makes the agenda a derived copy,
   so any desync is a P1 bug.

3. **Ordinal-leak false positives.** At `:63`, `ORDINAL_LEAK_RE` matches `1.5 million…` and initials such as
   `M. Ulug'bek` or `D. Mendeleyev`. Replace it with
   `/^\s*(?:\d{1,2}[.)](?=\s)|(?:I{1,3}|IV|VI?)[.)](?=\s))\s*/`
   (plan ≤ `PLAN_ITEMS_MAX` = 6, so Roman I–VI is enough; C, D, L and M are always initials). Add tests
   showing that `1.5 million…` and `M. Ulug'bek merosi` do NOT fire, and that `3) Natija` does. Single
   `I.` and `V.` stay ambiguous with initials; say so in a comment.

4. **Truncation in every text field** (decision 7 «"…" kesiklar»; A4 baseline: lecture-12 `twoCol` ×5 +
   `quoteBy`, defense-14 closing `subtitle`, and the CLI printed thin=0). At `:166-170`:
   - make the `…`/`...` end check a general `truncated` kind;
   - apply it to `title`, `subtitle`, `bullets`, `left`, `right`, `quote`, `quoteBy`, `steps[].text`,
     `stats[].label`, table cells and quiz `q`/`options`;
   - require a letter before the ellipsis (`/\p{L}(…|\.\.\.)\s*$/u`) so a deliberate trailing «…» after
     punctuation is not flagged.

   Add `quoteBy?: string` and table fields to `SlideForAudit` (`:43-56`). Test: `twoCol.left[0]` ending in
   `ber…` → `truncated`.

5. **Catch the §2.5 honest skeleton if it leaks into the file.** At `:126-139`, add `skeleton-leak` for:
   - a `stats` value equal to `"—"`;
   - any `bullets`, `left` or `right` item equal to `"…"`;
   - any process step whose `text` is also used by 2 or more other slides/steps, which is how the role text
     shows up. If that is too fuzzy, drop this item and keep only the first two.

   Test with the `probe` deck `stats:[{value:"—"}]`.

6. **`pro-slide-min` expectation** (`scripts/live-engine.mts:928-955`).
   - (a) `planTotal > 0 && planTotal <= 6` (`:952`) also passes when there is NO clamp. Assert
     `planTotal >= 1 && planTotal < 6`. After P1 merges, assert `planTotal === planCapacity({...values})`
     (§2.3 names that function).
   - (b) `slidePurpose: "lecture"` brings the standard blocks `reja,maqsadlar,adabiyotlar`. `adabiyotlar` is
     not in `YIELDING_BLOCKS` (`slide-blocks.ts:116`), so at 4 slides (title + agenda + closing) the
     capacity is 0. That tests P1's undefined `[1, 0]` corner, not the clamp, and `slides.length === 4`
     (`:951`) can fail for a legitimate reason. Add `blocks: "reja"` (a pro-slide registry field) so the
     expected capacity is 1 and the case really tests "6 requested → clamped, 4 slides, full coverage".
     Alternatively keep lecture and write down what P1 decides for capacity 0.

7. **Directory mode and the `doc.json` source.** Directory mode needs a skip branch, and the engine needs to
   write slide `doc.json` files to `eval-out/live`:
   - (a) `scripts/slide-audit.mts:252-255`: in directory mode, SKIP files whose JSON has no `slides` array
     (print `· skip (slayd emas)`, don't count it) and fail only when an explicitly named single file isn't a
     slide doc. As it stands, the documented `npm run slide-audit -- eval-out/live` (`:27`) always exits 1,
     because that directory holds 20 non-slide doc.json files.
   - (b) `live-engine.mts` never writes a slide `doc.json` (only article/teacher/work/game/infographic,
     `:1541-1600`). The comment at `slide-audit.mts:246` («live-engine.mts shunday yozadi») is therefore
     false, and the CLI has nothing to audit after a live run. Add
     `if (file.doc.slides?.length) await writeFile(path.join(OUT, \`${c.name}.doc.json\`), JSON.stringify(file.doc, null, 2));`
     next to the other writers in `runCase`.

8. **Make the tests kill the mutants** (`tests/slide-audit.test.mts`). These are the minimum:
   - `:253` title-first: build `[bullets, agenda, title, …]` so the agenda stays at #2 and only the title
     rule can fire. Assert `issues.some(i => i.kind==="block-order" && i.slide===1)`.
   - `:262` closing-last: move closing to second-to-last, not in front of the agenda. Assert slide ===
     `slides.length`.
   - New test: agenda `BIRINCHI  bo'lim` against section `Birinchi bo'lim` → no `plan-title-mismatch`
     (kills m3).
   - New test: section title `1. Birinchi bo'lim` against agenda `Birinchi bo'lim` → `ordinal-leak` present
     and `plan-title-mismatch` absent (kills m5).
   - Replace `includes(kind)` with an exact set of distinct kinds (`deepEqual([...new Set(kinds)], [kind])`)
     wherever the fixture allows it, so the header claim at `:9` is actually tested.
   - Add regression tests for items 1–5.

9. **Thin rules and the live gate.** In `scripts/slide-audit.mts:141-175`:
   - remove `thin-quote` (`:171-174`). §2.6(b) has no quote rule, and the motivation prompt allows a short
     question.
   - apply `thin-bullets` only to plan content slides (`typeof s.plan === "number"`), not to block slides
     such as maqsadlar or uyga_vazifa, which are short by design. The probe with 2–4 word goals fails today,
     and the `slide` case uses `textVolume: "qisqa"`.
   - merge-time requirement: once P3 lands, replace the duplicate heuristic with P3's `thinSlides(slides,
     audienceRules)` from `slide-quality.ts` (single source of truth; the file's own comment at `:19-23`
     admits the two will drift). Keep only rules P3 lacks (truncation, skeleton). Do not use the live gate
     for sign-off until this is done.

## Non-blocking notes

- `--list` pads names to 18 characters. `pro-slide-open-lesson` (21) breaks the column. Cosmetic only.
- `slide-report` asserts both `stats` and `table` (`:912-913`). With 8 slides and a 3-item plan the budget
  fits exactly (title + agenda + 3 plan + diagramma + jadval + closing). `jadval` is a yielding block, so if
  P1 adds any beat the check can fail legitimately. Keep an eye on it after P1 merges.
- `slide` parity case: `quality: "standard"` (`:753`) is a leftover field from before Formalar 2. It was
  not introduced by this branch.
