# AUDIT-25 pre-deploy review: `slides-3` → `main` → prod

- **Reviewer:** independent and read-only. The only file written is this one. No server access, no network, no `.env*`.
- **Scope:** `git diff main...slides-3`.
  - `main` = `e89c7c1`.
  - `slides-3` = `7d4525c`: the reviewed code is at `e268937`, and the two later commits touch `README.md` only, which `.dockerignore` excludes from the image.
  - 69 files: +12 111 / −1 153 lines. The runtime code is 36 files in `lib/`, `components/forms/`, `scripts/` and `package.json`. The rest is tests and docs.
- **Commands run.** One heavy command, through `heavy2.sh -m 3G -t 900`:
  1. A rollout-overlap probe (`scratchpad/a25-predeploy/overlap-probe.mts`). It runs the NEW `extractMeta`/`deckBeats` and the OLD (`git archive main`) `extractMeta`/`deckBeats` over the same payloads: 72 cases, 2 tools × 9 purposes × 4 slide counts.
  2. `tests/client-bundle-guard.test.mts`, `tests/delivered.test.mts` and `tests/slide-params.test.mts`: **30/30 pass** on HEAD.

---

## BLOCKERS

All three are procedural. None of them is a code defect, and none needs a code change before the merge.

### B1 — No full gate has run on the commit being deployed
- The last full gate is `slides3-pre` @ `879f495`: typecheck, lint, unit, viewer, UI, `next build` and a fresh-Postgres smoke.
- Three merges landed after it:
  - W7 `fbd3fdb`
  - P10 `0db46d8`
  - P8 `fb5d0e8`
- Together they change 449 lines across 7 runtime files (`git diff --stat 879f495 slides-3 -- lib components app scripts`). Two of these changes matter for `next build`:
  - `lib/generation/slide-edit.ts` is **loaded in the browser** (it is in the viewer editor bundle). It gained `limitsFor` and new `EditRules` fields.
  - `lib/server/slide-image.ts` (web route `/api/generations/[id]/slides/[index]/image`) now imports `slide-quality.ts`. That pulls `llm.ts`, `job-cost` (`node:async_hooks`) and `slide-layout` into the web server bundle.
    - The route is `runtime = "nodejs"`, and the web already imports `llm` (outline), so I expect this to build.
    - `next build` has not proven it.
- `.claude/holat.md` says the later merges were checked with `tsc` plus the targeted tests only. The bundle guard passed in my run. That is a source scan, not a build.
- **Fix.** Run the full gate on the exact merge commit, one heavy process at a time:
  ```bash
  git checkout main && git merge --no-ff slides-3        # (or the merge commit you will push)
  scripts/heavy.sh -m 3G -t 900 npm run typecheck
  scripts/heavy.sh -m 3G -t 900 npm run lint
  scripts/heavy.sh -m 3G -t 900 npm test
  scripts/heavy.sh -m 3G -t 900 npm run test:viewer
  scripts/heavy.sh -m 3G -t 900 npm run test:ui
  scripts/heavy.sh -m 4G -t 900 npm run build
  ```
  - `npm test` has 2 known failures in `document.test.mts`: the dead fal chain, per project memory. Any other failure blocks the deploy.
  - The same set can be run as the planned `wave-gate.sh slides3-final`.

### B2 — Freeze the scope. The work in flight must not ride along unreviewed.
- **P9** (`audit25-p9-plan-badge`, WIP `2db3042`) is **not merged**. Its last review is **CHANGES 3**.
  - `docs/AUDIT-25.md` §4 «Nima o'zgardi (merge qilingan)» nevertheless lists P9 as merged. Fix the doc row, or merge P9 after its re-review.
  - Either way, **this deploy contains no «0N» badge**. On decks with no section slide, such as the plain 10-slide deck, plan slides therefore show **no plan number at all**. That is correct under decision 4, but do not promise the badge.
- **P11** ("limits from the deck's own visual", which also touches the editor) is in flight.
- The **INTEGRATION** and **OLDDECKS** reviews were commissioned and are not yet read.
- **Fix.** Deploy exactly `slides-3` @ `7d4525c`, or a later commit only after the INTEGRATION and OLDDECKS verdicts are in hand. If P9 or P11 merge first, re-run this review on their diff: they change the layout and the editor, which are the old-deck paths covered here.

### B3 — Money: the owner must acknowledge the P6 refund semantics (project rule «Agree before decisions»)
- P6 (`lib/generation/delivered.ts`) sends `pro-slide` through the refund path for the first time. Before this change, pro-slide was **never** refunded.
- After deploy:
  - **Fewer slides delivered** → proportional refund: `(want−got) × 2 000` coins. This is uncontroversial.
  - **Partial AI-image shortfall** → 0 coins back (`refundShare = IMAGE_PRICE_SHARE_STANDARD`), with only a log line.
  - **Total image loss** (`slideImages.got = 0`, `want > 0`) → **100 % refund of the pro-slide price, up to 60 000 coins**, even though the text deck is still delivered (`refundRatio`: got ≤ 0 → 1).
    - A Gemini image outage or key lock therefore makes **every pro-slide free** while it lasts.
    - Yielded slides (P8, D1) are excluded from `want`, so the D1 policy itself never triggers a refund.
- D1 was signed off. The pro image-share / total-loss policy is still listed as «egasi qarori kutilmoqda» in the §4 debt.
- **Fix.** Get a one-line owner acknowledgement before deploy: either «P6 as-is is OK», or hold P6. The code is correct either way; this is a policy gate, not a defect.

---

## RISKS (with checks)

### R1 — Rollout overlap: old form ↔ new worker (**acceptable, no guard required**)

**How long the overlap lasts.**
- `deploy.sh` runs `build && up -d`, so web and the 2 worker replicas are recreated seconds to about a minute apart.
- The overlap that really matters is longer than 2 minutes:
  - Jobs already `QUEUED` at deploy time are claimed by the new worker with their old `values_json`.
  - Jobs `IN_PROGRESS` are SIGTERM'd (worker `stop_grace_period: 30s`) and re-claimed by the new worker.
  - Browser tabs opened before the deploy keep the old form bundle until their next navigation. A POST to `/api/generations` still works from such a tab, so each stale tab can submit old-shaped values once.

**What the old form sends.** On both tools it always sends `blocks`, `planItems: 5`, `quizCount: 0` and `agendaSlide: true`.

**Old form → new worker.** Probe result, compared with what prod does today (old form on old worker):

| Tool / purpose | Today (prod) | Old form on NEW worker | New form on new worker |
|---|---|---|---|
| `slide` general/lesson/lecture/seminar/report/defense | 5 plan items, agenda, no test | same count; every plan item gets its own slide (the new engine) | adaptive plan count (10 slides → 3) |
| `slide` **open_lesson** | test with 1–3 questions | **no test** (explicit `quizCount: 0` now means «Testsiz») | test kept |
| `slide` **training** | test with 2–3 questions, no agenda | **no test + agenda slide added** (`agendaSlide: true` now adds `reja`) | test kept, no agenda |
| `slide` **pitch** | no agenda | **agenda slide added** | no agenda |
| `pro-slide` (all 9 purposes) | — | the chips win (`resolvePlanFlags`): `quizCount: 0` with the «Test» chip → default count, `agendaSlide: true` ignored. The only difference from the new form is `planItems` 5 (explicit) vs adaptive 3–6. | — |

**Worst case.** A plain `slide` open_lesson or training deck from a stale tab or an already-queued job comes out **without its test** (1–3 questions), and training/pitch gain an agenda slide.
- In all 72 cases the deck is still well-formed:
  - the slide count is exactly what was asked (the new engine never overruns; the old engine made 7–8 slides for a 4-slide lesson);
  - every plan item has its own slide;
  - the price is unchanged, because price depends only on `slideCount`.
- The outcome is **exactly what the old form displayed**. The old summary chip read «Testsiz» and «Reja» (`main:components/forms/slide-fields.tsx:274-281`). The old worker ignored those choices (bugs A3-01 and A3-02). So the user gets what their screen said, not what prod used to silently do.
- Verdict: **acceptable for the window.**

**New form → old worker** (web restarted first, worker not yet). The new plain form omits `blocks`, `planItems`, `quizCount` and `agendaSlide` unless the user touches them, and the old `extractMeta` falls back to exactly the old defaults.
- Probe: **72/72 cases are identical to today's prod decks** (same slide count, plan count, agenda and quiz).
- If a user *touches* «Reja bandlari» = 1–2, the old worker clamps it to 3. That lasts only seconds.
- Verdict: harmless.

**Optional guard** (not required; only if the owner wants prod-identical behaviour for stale tabs). There is a precise fingerprint: the new *plain* form never sends `blocks`, but the old plain form always did. In `extractMeta`, when `tool.id === "slide" && values.blocks != null`, treat `quizCount === 0`, `agendaSlide === true` and `planItems === 5` as not sent.
- It would need a red→green test and a review. Given the analysis above, I recommend **not** adding it at this stage.
- The cheaper mitigation: deploy at low traffic and check that the queue is empty first:
  ```sql
  SELECT tool_id, status, count(*) FROM generations WHERE status IN ('QUEUED','IN_PROGRESS') GROUP BY 1,2;
  ```

### R2 — Drafts: `v` is stored, both directions checked
- **The draft API keeps `v`.**
  - `app/api/forms/[toolId]/draft/route.ts` → `lib/server/form-draft.ts` stores and returns `sanitizeValues(raw)`.
  - `sanitizeValues` (`lib/server/validate.ts:71`) keeps any key matching `^[a-zA-Z0-9_]{1,40}$` with a number value, so `v: 2` round-trips.
  - The new bundle deletes `v` from the restored state (`sanitizeRestoredDraft`), so `v` is never posted by the new form.
- **Old bundle, after deploy.** It keeps saving drafts without `v`. The new bundle then drops `planItems`, `quizCount` and `agendaSlide` from them (and drops `blocks` on plain slide), which is the correct «legacy = untouched» reading.
- **Old bundle restoring a new `v:2` draft** (a stale tab, or after a rollback):
  - `v: 2` merges into the old form state and gets posted. `sanitizeValues` keeps it, `values_json` stores it, and `extractMeta`/`priceFor` ignore it. Harmless.
  - **Rollback-only wrinkle:** a *plain* `slide` `v:2` draft has no `blocks`. The old form then keeps its init `blocks = resetBlocksForPurpose("general")` = `reja` even when the draft's `slidePurpose` is, say, `open_lesson`. The old worker honours the sent `blocks`, so the deck gets the purpose's template but only the `reja` block, until the user touches «Taqdimot turi».
  - This is minor and only matters after a rollback. No action; note it in the rollback log if one happens.

### R3 — The image-upload guard also refuses a *replacement* image (P8, `lib/server/slide-image.ts`)
- `assertTextFitsImage` refuses with 400 «Matn rasm bilan sig‘maydi…» whenever `imageYieldField(slide, deck.bodyType, deck.visual)` is non-null. It does **not** exempt a slide that **already has an image**.
- `plannedImageSlots` does exempt such slides («Rasmi allaqachon bor slayd chiqarilmaydi»). So on an old deck, if the new fit metrics (P2's audience floors and bold width) judge an image slide's existing text as too long, the user can no longer swap that slide's picture, even though the box would not change.
- **Suggested follow-up** (one line plus a test, next sprint): `if (slide.image) return;` in `assertTextFitsImage`.
- **Smoke:** replace the image on one image slide of an OLD deck (step S5 below). It must succeed for normal text.

### R4 — Visible change on every existing deck (expected, decision 4)
- Section and kicker numbers now come only from `s.plan`, and old `doc_json` has no `plan`. So **old decks re-render in the viewer and in re-exported PPTX without the big «03» section numbers** (15 deck-index sites removed).
- The OLDDECKS probe covers this. Tell support: it is intentional, not data loss.

### R5 — Latency and cost per slide job
- New costs per job:
  - one extra LLM call (`repairThinSlides`, only when a slide is thin and budget remains);
  - redirect resolution budget 3 s → 6 s, run only with `internetSearch` and only when ≥ 6 s remain.
- Both are guarded by the deadline.
- **Watch** `finished_at − started_at` and `cost_json` in smoke query S1. Compare them with a pre-deploy pro-slide job of the same size.

### R6 — The shared-file surface for other tools (low risk)
| File | Change | Effect on non-slide tools | Coverage |
|---|---|---|---|
| `lib/generation/meta.ts` | `planCapacity`/`effectivePlanItems`/`resolvePlanFlags` now run for **every** tool | Pure functions, no throw path. For non-slide tools `meta.planItems` becomes 3 (was 5), and `quizCount`/`agendaSlide` become `undefined` (so they drop out of the stored `doc_json.meta`). Grep: no non-slide reader of these three fields (`lib/`, `app/`, `components/`). | `tests/document.test.mts`, `tests/slide-plan.test.mts` (extractMeta) |
| `lib/generation/delivered.ts` | `case "pro-slide"` + image gate | Only `slide`/`pro-slide`. Other tools fall through as before. | `tests/delivered.test.mts` 9+ pass (ran) |
| `lib/generation/quality.ts` | **unchanged**. `slide-research.ts` only *reuses* the existing `mapPool` (order-preserving, bounded). | none | — |
| `lib/generation/safe-fetch.ts` | **unchanged**. `slide-research.ts` still uses `safeFetchUrl` with the same exact-host check (`https` + `vertexaisearch.cloud.google.com`), `maxRedirects: 0`, HEAD, plus a new per-request 3 s timeout. The SSRF surface is unchanged. | none | `tests/slide-research.test.mts` |
| `components/forms/compact.tsx` `Segmented` | optional `disabled` on options | For the other 15 forms (`disabled` undefined), the DOM and class output are identical: `aria-disabled` is omitted, `disabled={false}` renders nothing, and the onClick behaviour is the same. | `tests/ui/*-composer.test.mts`, `shared-forms`, `translation-form`, `image-studio`, `teacher-composer`; green in gate `879f495`, which already contains P4 (`c86bdcd`) |
| `lib/tools.ts` | pro-slide description text only (D1) | none | — |

---

## OK (verified)

1. **Schema and migrations.** No new migration: no file under `lib/server/migrations/`, and no new SQL or `query(` in the diff. DB access is unchanged.
2. **`doc_json` shape is additive.**
   - Additions: `slides[].plan?: number`, `DocMeta.quizCount?`/`agendaSlide?` optional, and `SlideBeat.structural` (beat-only, **never persisted**).
   - Old rows always carry a numeric `quizCount`, a boolean `agendaSlide` and `planItems` 3–6, which new readers accept:
     - `bodyRules` → `planItems || 5`;
     - the prompt → `quizCount ?? 0` (generation only);
     - slide `plan` missing → no number drawn;
     - `slide-edit.validPlan(undefined)` → the field is not set.
   - The stored `preview.slide.bodyType` of old rows lacks the new `stepsMax`/`tableCols`… fields. The layout (`planSlide`) never reads them (only `normalizeSlide` and the editor do), and the editor receives a freshly computed `deck.bodyType` from the server.
3. **Env, compose, deps.**
   - No new env var: no added `process.env`/`env.` in the diff.
   - `docker-compose.yml`, `Dockerfile`, `next.config.ts`, `instrumentation.ts` and `lib/server/env.ts` are unchanged.
   - `package.json` has one added script, `"slide-audit": "tsx scripts/slide-audit.mts"`. `tsx` is already in `dependencies`, and the worker image copies `scripts/` and `lib/`.
   - **`package-lock.json` diff is empty.**
   - **`playwright-core` was not added.** The only `playwright` mention in the lockfile is Next's pre-existing optional peer `@playwright/test`. `scripts/slide-audit.mts` imports only `node:*` and `lib/`.
4. **Client bundle and CSP.**
   - The new client imports are `slide-params` (now `slide-purpose`, type-only back-edges, no cycle at runtime), `slide-blocks` and `slide-limits.limitsFor` (`safe-text` only).
   - `slide-quality.ts` (server: `llm`, `job-cost`) is not reachable from any `"use client"` file. `tests/client-bundle-guard.test.mts` **passes on HEAD**.
   - No new external origin, font or script, so there is no CSP impact.
5. **Rollback (code only)** works: `git reset --hard $(cat /root/slaydx-backups/ROLLBACK.txt)` + `docker compose -p slaydx build && up -d`. There are no migrations to undo.
   - **New decks under old code:**
     - The old renderer ignores `plan`.
     - The old `sanitizeSlideModel` (`main:lib/generation/slide-edit.ts:628`) is a whitelist, so it **silently drops `plan`** on whole-slide ops (set, insert, layout convert). Field edits (`{...s, …}`) keep it. This is acceptable: the number is simply not drawn afterwards.
     - `meta.planItems` 1–2 gives an old `agendaMax` of 1–2, which matches the deck's agenda.
     - Absent `quizCount` is read as `?? 0` by the old prompt code, which never re-runs on stored docs.
   - **Faster rollback option** (from the prior runbook): tag the images before deploy, `docker tag slaydx-web:latest slaydx-web:pre-a25 && docker tag slaydx-worker:latest slaydx-worker:pre-a25`, then roll back with the tags and `up -d --no-build`.
6. **New form → old worker** is identical to prod (72/72; R1).
7. **Retries and idempotency.** The only re-read of `values_json` is the worker claim (`jobs.ts:803`), which is the same job. No "re-run with same values" path exists, so legacy payloads cannot resurface after the queue drains.

---

## Post-deploy smoke for THIS change

Run these after the standard `.claude/deploy.md` §3 checks (containers, health, worker logs).

**S0 — Queue empty just before deploy.** See R1 for the SQL. Record the deploy timestamp as `:T`.

**S1 — Generate one `slide` and one `pro-slide` on the owner account through the real queue.** This debits real credits: `slide` ≈ 3 000, `pro-slide` 12 × 2 000 = 24 000. Do not run it without the owner's OK.
```bash
docker compose -p slaydx exec -T worker npx tsx --conditions=react-server scripts/seed-demo.mts <owner-username> slide pro-slide
docker compose -p slaydx logs -f --since 5m worker     # wait for both COMPLETED
```
- The samples in `scripts/seed-demo.mts` are:
  - `slide`: lesson, 10 slides, `planItems: 4`, test with 3 questions, agenda;
  - `pro-slide`: open_lesson, 12 slides, chips including `reja` and `test`, `planItems: 4`, `internetSearch`.
- Expected for both: 4 plan items, one agenda slide, at least one quiz slide, the slide count exactly as requested, and no refund row.

In the SQL below, `:SLIDE` and `:PRO` are the two ids printed by the seed script. Run each query with:
```bash
docker exec slaydx-postgres-1 psql -U slaydx -d slaydx -v SLIDE="'<id1>'" -v PRO="'<id2>'" -c "<query>"
```

```sql
-- S1. status, size, timing, money
SELECT id, tool_id, status, attempts, left(coalesce(error,''),80) AS err,
       finished_at - started_at                      AS took,
       jsonb_array_length(doc_json->'slides')         AS n_slides,
       doc_json->'meta'->>'targetPages'               AS want,
       doc_json->'meta'->>'planItems'                 AS plan_items,
       doc_json->'slideImages'                        AS images,
       delivered_json, cost_json
FROM generations WHERE id IN (:SLIDE, :PRO);
-- expect: COMPLETED, n_slides = want (10 / 12), plan_items = 4, delivered_json NULL
--         (pro: images.got = images.want; want may be < image-layout count — P8 yield, see logs)

SELECT kind, points_delta, quota_delta, balance_delta, reference, created_at
FROM transactions WHERE user_id = 2 AND created_at > now() - interval '1 hour' ORDER BY created_at;
-- expect: two 'charge' rows, no 'refund'

-- S2. plan coverage: every plan item 1..N has ≥1 slide, one agenda, quiz present
SELECT g.id, g.tool_id,
       (g.doc_json->'meta'->>'planItems')::int                       AS plan_items,
       count(DISTINCT s->>'plan') FILTER (WHERE s ? 'plan')           AS distinct_plans,
       min((s->>'plan')::int)                                         AS min_plan,
       max((s->>'plan')::int)                                         AS max_plan,
       count(*) FILTER (WHERE s->>'layout' = 'agenda')                AS agendas,
       count(*) FILTER (WHERE s->>'layout' = 'quiz')                  AS quiz_slides
FROM generations g CROSS JOIN LATERAL jsonb_array_elements(g.doc_json->'slides') AS s
WHERE g.id IN (:SLIDE, :PRO) GROUP BY g.id, g.tool_id;
-- expect: distinct_plans = plan_items = max_plan = 4, min_plan = 1, agendas = 1, quiz_slides >= 1

-- S2b. order (eyeball): plan tags ascend along the deck
SELECT g.id, string_agg(coalesce(t.s->>'plan','·') || ':' || (t.s->>'layout'), '  ' ORDER BY t.o) AS seq
FROM generations g CROSS JOIN LATERAL jsonb_array_elements(g.doc_json->'slides') WITH ORDINALITY AS t(s, o)
WHERE g.id IN (:SLIDE, :PRO) GROUP BY g.id;

-- S3. agenda bullets == plan-head titles (head = the plan's section slide, else its first slide)
WITH sl AS (
  SELECT g.id, t.o, t.s FROM generations g
  CROSS JOIN LATERAL jsonb_array_elements(g.doc_json->'slides') WITH ORDINALITY AS t(s, o)
  WHERE g.id IN (:SLIDE, :PRO)
), heads AS (
  SELECT DISTINCT ON (id, (s->>'plan')::int) id, (s->>'plan')::int AS p, s->>'title' AS title
  FROM sl WHERE s ? 'plan'
  ORDER BY id, (s->>'plan')::int, (s->>'layout') <> 'section', o
), ag AS (
  SELECT sl.id, b.o::int AS p, b.v AS bullet
  FROM sl CROSS JOIN LATERAL jsonb_array_elements_text(sl.s->'bullets') WITH ORDINALITY AS b(v, o)
  WHERE sl.s->>'layout' = 'agenda'
)
SELECT coalesce(h.id, a.id) AS id, coalesce(h.p, a.p) AS p, h.title, a.bullet,
       CASE WHEN h.title IS NULL OR a.bullet IS NULL THEN 'MISSING'
            WHEN a.bullet = regexp_replace(h.title, '^\s*(REJA\s*\d+-band:\s*|\d+\s*[.)]\s*)', '', 'i') THEN 'ok'
            WHEN right(a.bullet, 1) = '…' AND position(rtrim(a.bullet, '… ') IN h.title) > 0 THEN 'clipped'
            ELSE 'DIFF' END AS verdict
FROM heads h FULL JOIN ag a ON a.id = h.id AND a.p = h.p
ORDER BY 1, 2;
-- expect: 4 rows per deck, all 'ok' ('clipped' = long title cut at bulletChars — acceptable; MISSING/DIFF = P1 regression)

-- S4. no «…» truncation in visible slide text (notes/image fields excluded)
SELECT g.id, t.o AS slide_no, t.s->>'layout' AS layout, v #>> '{}' AS text
FROM generations g
CROSS JOIN LATERAL jsonb_array_elements(g.doc_json->'slides') WITH ORDINALITY AS t(s, o)
CROSS JOIN LATERAL jsonb_path_query(t.s - 'notes' - 'image' - 'imageHint' - 'id', 'strict $.**') AS v
WHERE g.id IN (:SLIDE, :PRO) AND jsonb_typeof(v) = 'string' AND (v #>> '{}') LIKE '%…%';
-- expect: 0 rows. Legit exception: a fill-in-the-blank quiz stem («… = …»).
-- A process step / bullet ending in «…» is the KNOWN residual (holat: «kamaydi, yo'qolmadi», P11 in flight) —
-- record it, it is NOT a rollback trigger.

-- S5a. honest skeleton never leaks; section slides always carry plan
SELECT g.id, t.o, t.s->>'layout' AS layout, t.s->>'title' AS title,
       CASE WHEN t.s->'bullets' = '["…"]'::jsonb OR t.s @? '$.stats[*] ? (@.value == "—")' THEN 'SKELETON'
            WHEN t.s->>'layout' = 'section' AND NOT t.s ? 'plan' THEN 'section-without-plan' END AS problem
FROM generations g CROSS JOIN LATERAL jsonb_array_elements(g.doc_json->'slides') WITH ORDINALITY AS t(s, o)
WHERE g.id IN (:SLIDE, :PRO)
  AND (t.s->'bullets' = '["…"]'::jsonb OR t.s @? '$.stats[*] ? (@.value == "—")'
       OR (t.s->>'layout' = 'section' AND NOT t.s ? 'plan'));
-- expect: 0 rows (a structural section without plan renders unnumbered — eyeball only)
```

Optionally, run the engine's own audit on the stored doc from inside the worker, with the same code as `npm run live`:
```bash
docker exec slaydx-postgres-1 psql -U slaydx -d slaydx -tAc "SELECT doc_json FROM generations WHERE id='<PRO_ID>'" > /tmp/pro.doc.json
docker compose -p slaydx cp /tmp/pro.doc.json worker:/tmp/pro.doc.json
docker compose -p slaydx exec -T worker npx tsx scripts/slide-audit.mts /tmp/pro.doc.json
```

Check the worker log for the new code paths:
```bash
docker compose -p slaydx logs --since 30m worker | grep -E "\[rasm\]|\[slide-research\]|repair|ta.mir|Error" | tail -40
```

**S6 — Viewer (by eye, in the browser as the owner).** Open both new decks:
- The agenda lists 4 items, and they match the section/content titles.
- Section slides show the plan number (01–04), never a deck index.
- The quiz options are not cut off.
- The pro deck has an image on every slide that still has room for one.
- The PPTX download opens in PowerPoint/LibreOffice and matches the viewer.

**S7 — Editor round-trip on an OLD deck** (created before `:T` and never edited, so `doc_prev IS NULL`):
```sql
SELECT id, tool_id, created_at, doc_version
FROM generations
WHERE user_id = 2 AND tool_id IN ('slide','pro-slide') AND status = 'COMPLETED'
  AND doc_json IS NOT NULL AND doc_prev IS NULL AND (expires_at IS NULL OR expires_at > now())
  AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(doc_json->'slides') s WHERE s ? 'plan')
ORDER BY created_at DESC LIMIT 3;
```
In the viewer, on that deck:
1. It opens. Section slides have no big number, which is expected (R4).
2. Edit one bullet (add a word) and save, then undo.
3. Convert one bullets slide to process, then back.
4. Replace the image on one image slide. This must succeed (R3).
5. Download the PPTX.
6. «Asl holatga qaytarish».

Then check in SQL:
```sql
-- after steps 2–4 (before revert): only the touched slides differ from the original; no plan invented
SELECT t.o AS slide_no, t.s = p.s AS unchanged, t.s ? 'plan' AS has_plan
FROM generations g
CROSS JOIN LATERAL jsonb_array_elements(g.doc_json->'slides') WITH ORDINALITY AS t(s, o)
JOIN LATERAL jsonb_array_elements(g.doc_prev->'slides') WITH ORDINALITY AS p(s, o) ON p.o = t.o
WHERE g.id = '<OLD_ID>' ORDER BY 1;
-- expect: unchanged = true for every slide you did not touch (W7: untouched text never shrinks), has_plan = false everywhere

-- after revert
SELECT doc_version, doc_json = doc_prev AS reverted FROM generations WHERE id = '<OLD_ID>';
```

**Rollback triggers:**
- Either job FAILED, or `n_slides ≠ want`.
- S2 or S3 shows MISSING or DIFF.
- An S5a SKELETON row.
- A 5xx on the viewer or editor for an old deck.
- `next build` / health failures.

These are **not** rollback triggers:
- an S4 «…» on process text (known residual);
- R4's missing numbers on old decks.

---

## Verdict: **GO-WITH-FIXES**
- **Fixes before merge/deploy:** B1 (full gate + `next build` on the merge commit), B2 (freeze at `7d4525c`, read the INTEGRATION and OLDDECKS verdicts, fix the P9 row in `docs/AUDIT-25.md`), B3 (owner acknowledgement of the P6 pro-slide refund semantics).
- **Code.** No blockers: no schema, env, dependency or compose change, and additive `doc_json`.
- **Rollout overlap.** Acceptable without a guard. The worst case is that plain `slide` open_lesson/training decks from stale tabs or queued jobs come out without a test (and training/pitch gain an agenda slide), which is exactly what the old form displayed. The new form on the old worker is identical to prod in 72/72 cases.
