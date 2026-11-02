# Studio P7 — compare mode, chains, favourites (+ P5/P6 cost telemetry) — spec 2026-11-03

Parent: `docs/studio/PLAN.md` §15 (P7 «Compare mode (2–4 models), remix chains, favourites»), §17 «Cross-provider
chains». Builds on P1–P6 (all on `feat/studio-next`). **No merge to `main`, no deploy, no server access** (owner
2026-11-02). Owner 2026-11-03: «davom etaver, bir necha agentlab ishlayver» — three parallel packages below.

## P7a — «Solishtirish» (compare) — Rasm and Video tabs
- A «Solishtirish» switch next to the model picker (image prompt mode and video). On: the user ticks **2–4 models**
  of the tab (only models available to them; edit / upscale / bgremove modes have no compare). One prompt; the
  shared rows are the parameters every ticked model has with the same name and type (e.g. ratio, seconds) — each other
  parameter takes the model's default. The sticky button reads «Solishtirish · N model · ~X so'm» with X = the SUM of
  each model's own price (the same `studioEntryPrice` per model, no discount, no new rule).
- **Server**: one batch submit (`POST /api/studio/compare`, or an extension of the existing submit — builder's choice,
  documented): validates EVERY model (availability, params, expectedPrice per model + total) BEFORE charging any; then
  charges and enqueues all N generations in ONE transaction (all or nothing); each is an ordinary generation (own
  refund on failure — failures do not cancel the others), tagged with a shared `compare_group` id (additive migration
  **071**, header + ROLLBACK, in `tests/admin-migrations.test.mts`, ids from code). Idempotency-Key as the single submit.
- **Results**: a side-by-side grid (desktop 2–4 columns, phone 1 column with model labels), each cell = the model,
  its price, progress / result, «Yuklab olish», «Shu modelni tanlash» (turns compare off and selects that model with
  the same prompt). Gallery shows each generation as usual (group badge optional).
- Limits: compare counts as N generations for the existing per-user rate / concurrency limits (no bypass).

## P7b — chains («Keyingi qadam») and favourites
- **Chains = handoffs, not new engines**: on a finished picture (results + gallery) «Videoga aylantirish» opens the
  Video tab with that picture as the start frame of an image→video model (the picture travels as an asset the user
  owns — reuse the P2b/P3 input path; the model picker shows only models that take a start image); on a finished
  video «Musiqa yaratish» opens the Audio tab (Musiqa mode) with the prompt prefilled; on any result «Ovoz qo'shish»
  opens the Ovoz tab with the prompt as text. Every step is a normal priced job. The existing P2b picture tools stay.
- Voice / music laid ONTO a video or a voice + music mix is **not** in P7b (needs ffmpeg in the worker image — owner
  decision pending, see «Open»).
- **Favourites**: a star on each result and gallery item (own generations only, SQL ownership); gallery filter chip
  «Sevimlilar». Additive migration **070** `studio_favorites` (user_id, generation_id, created_at; PK both; ON DELETE
  CASCADE). Free, no limits beyond ownership; star state survives reload.

## P7c — provider cost telemetry for Studio speech + audio (review m3 of P6)
- Studio speech (P5) and audio (P6) jobs write their provider cost into the generation's `cost_json` like the other
  engines (admin profit / cost reports read it), one entry per delivered call, using the same catalog cost as
  `media_jobs.cost_usd` (one clip per call). Tests: the admin cost report shows a non-zero cost for a studio-speech and
  a studio-audio job; mutation for each.

## File ownership (parallel agents — do not edit another package's files)
- P7a: `components/studio/compare/*`, `lib/server/studio-compare.ts` (+ route), migration 071, its tests; in
  `StudioPage.tsx` ONLY the mount of the switch + results (small, isolated hunk).
- P7b: `components/studio/StudioResults.tsx`, `Gallery.tsx`, handoff wiring in `StudioPage.tsx` / Video / Ovoz / Audio
  tabs (prefill props), favourites server + route, migration 070, its tests.
- P7c: `lib/generation/studio/*` speech / audio engines, cost recording helpers, their tests. No UI.
- Shared enumeration tests (document, nav-pure, admin-settings-tabs, admin-migrations, ui/studio-page …): each package
  adds its own lines; the lead merges.

## Open (owner)
- ffmpeg in the worker image (≈ +80 MB) to unlock: voice-over / music ON a video, voice + background-music mix.
