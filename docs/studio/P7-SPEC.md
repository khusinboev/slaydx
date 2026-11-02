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

### P7c — what shipped (builder, 2026-11-03, branch `feat/studio-p7c`)
- **Recording** (`lib/generation/studio/cost.ts`, called by `speech.ts`, `audio.ts` and the clone job `lib/server/media/voice-clone.ts`):
  after the engine ACCEPTS a call's audio, one entry goes into the job's meter (`job-cost.ts`), so `buildArtifact` writes it to
  `generations.cost_json` and the worker flushes it to `ai_usage` (the rows the admin cost / profit reports read). Amount =
  `costUsd(entry.cost, normalize(entry.params, <the very values passed to runMedia>))` = that call's `media_jobs.cost_usd`
  (SFX: values with `variants: 1`, one clip per call; speech chunk: priced on its own text; dialogue: the whole normalized
  script, names included, `units` = the spoken characters). No change to prices, `runMedia` or the worker.
- **Parts**: speech and the clone preview -> kind `tts` (provider = the route's: `elevenlabs` / `gemini` -- the catalog's id, not
  `google`; model = the route's upstream model, e.g. `eleven_v3`, the operator's Gemini TTS model; units = characters; the Gemini
  part is flagged `estimated` because its quote is a characters -> tokens estimate and the adapter returns no usage). Music /
  effect / voice changer / isolator -> NEW kind `audio` (`JobCost.addAudio` / `recordAudio`, `CostPart.kind` widened; units =
  the seconds the call was priced on; ElevenLabs bills these per second, so they are not `tts`).
- **Failed calls** follow the existing convention (`coreAdapterImageProvider`, `tts/chain`): a call that failed or returned no
  usable audio records nothing; calls delivered before a later failure stay in the meter (the worker's failed `ai_usage` row
  carries them -- the provider billed them), `cost_json` itself is written only on COMPLETED. SFX 3 of 4 -> three clips.
- **Clone job**: the IVC call costs $0 (catalog `per: job, usd: 0`) and records nothing; the preview call is the job's cost.
- **Tests** (mutations listed in each file's header): `studio-speech` / `studio-audio` (pure, real engine + stubbed fetch inside a
  meter: exact parts, price == the number `runMedia` prices, failed call / failed job records nothing), `studio-speech-flow` /
  `studio-audio-flow` (worker + isolated DB: `cost_json`, `spendForJobs` and `spendBy` tool / kind of the admin cost report, and the
  succeeded `media_jobs.cost_usd` sum agree; failed jobs leave no spend; speech, dialogue, clone, music, SFX 3 of 4, voice changer,
  isolator).
- **Not done / follow-ups**: the admin UI label maps (`components/admin/providers/format.ts`, `components/admin/pricing/shared.ts`,
  `admin-cost.ts KIND_LABEL`) do not know kind `audio` yet (they fall back to the raw key, and the providers panel files the
  part under the provider's own tab) -- a one-line label per map for the owner of the admin UI. Library-voice previews (`voicePreview`) run outside any job, so their
  small cost is still unrecorded. Credit rates stay the P6 UNVERIFIED estimates until compared with the ElevenLabs usage page.

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
