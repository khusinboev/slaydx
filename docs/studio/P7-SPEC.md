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

### P7a — what shipped / decisions (builder, 2026-11-03, branch `feat/studio-p7a`)
- **Endpoint**: a new `POST /api/studio/compare` (`app/api/studio/compare/route.ts` → `lib/server/studio-compare.ts`),
  not an extension of `POST /api/generations`. Body `{ kind: "image" | "video", members: [{ values, expectedPrice? }],
  expectedTotal? }`, header `Idempotency-Key` (UUID, optional). 202 `{ group, total, items: [{ id, modelId, price }] }`.
- **One pipeline**: `submitGeneration` was split into `prepareGeneration` (every check up to and including the price
  guard, unchanged order) + the enqueue; the compare batch runs `prepareGeneration` for EVERY model before any charge,
  so availability, inputs, channel / offer / pause gates and the price (`studioEntryPrice` + `tool_pricing` %) are the
  single submit's, by construction. `insufficientError` (the 402 wording, video «paid balance only» included) is shared.
- **Batch rules** (`compareRequestError`): 2–4 DISTINCT models; Rasm = `studio.image` drawing models only (edit /
  upscale / bgremove refused), Video = `studio.video` models without the effect entry; ONE prompt (equal after the
  server's normalization); prompt-only — a non-empty image param is refused (no start / end frame in compare).
- **Transaction**: lock the user row (the `enqueueGeneration` lock), replay check, admission computed as N jobs
  (`admissionDecision` with in-flight + i / queued + i for the i-th model), then N × (`chargeInTx` with the row's own id
  as reference + INSERT). A balance below the SUM throws inside the transaction → full rollback → 402 with the sum.
  `expectedTotal` ≠ server sum → 409 `price_changed` with `price` (sum) and `prices` (per model).
- **Migration 071**: `generations.compare_group UUID` + `compare_index SMALLINT` (both or neither, index 0..3, CHECK
  `NOT VALID` so the big table is not scanned under the lock) + partial index `(user_id, compare_group, compare_index)`.
- **Idempotency**: the client key is stored on the FIRST row only (`generations_user_idem_idx` is unique per key); a
  replay (same key, same tool, same values per index — JSONB equality) answers the whole batch with
  `Idempotent-Replayed: true`, charging nothing; any other request under that key → 422 (also a single job's key).
- **Rate limits**: the route takes one slot of BOTH `gen:burst` (5/min) and `gen:hour` (60/h) per model, so a
  4-model compare uses 4 of the 5 burst slots.
- **UI**: `components/studio/compare/*` — `CompareSwitch` (shown when the tab offers ≥ 2 compare models: Rasm in
  drawing mode, Video), `ComparePanel` (own prompt seeded from the tab, model checklist with per-model price, shared rows
  via `ParamRows` over a synthetic entry, sticky «Solishtirish · N model · ~X so'm»), `CompareResults` (grid: phone 1
  column, `sm` 2, `lg` 3, `xl` 4; each cell model label + price, progress / pictures / clip, «Yuklab olish», «Shu
  modelni tanlash»). Shared rows = same name + type and a non-empty set of values every ticked model accepts (enum
  options intersection; int values intersection — Omni 5/8 s ∩ Kling 3–15 s = 5/8 s; number range overlap; bool);
  every other param goes out at the model's own default (`memberValues` sends only shared values).
- **Deviation**: the switch sits at the top of the tab's form (under the tab bar), not literally inside the model
  picker — the Video tab's picker lives in `VideoTab.tsx` (not P7a's file). In compare mode the panel replaces the tab's
  form and, on Rasm, also the results column (the panel spans both columns at `md+`).
- **StudioPage.tsx hunk**: `useCompare()` + availability + `toggleCompare` / `pickCompared` (one block after the audio
  tab state), the switch + panel ahead of the tab chain, and two `comparing` conditions (form column span, Rasm results).
- **Open risk**: the default `queue.user_max_inflight` is 2, so with nothing in flight only 2-model compares are
  admitted; 3–4 models need the admin to raise it (the 429 says «Solishtirish N ta ish hisoblanadi …»). No gallery
  group badge (optional; Gallery is P7b's file).

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

### P7b — what shipped / decisions (builder, 2026-11-03, branch `feat/studio-p7b`)
- **Handoffs** live in `components/studio/handoff.tsx` (`useHandoffs` + the pure `videoFromPicture` / `voiceFromText` /
  `musicFromPrompt`); `StudioPage` only wires them (one `useHandoffs` call, the props, two `HandoffAlert`s). Nothing is
  charged by a handoff: the next tab opens prefilled and its own «Yaratish» is the normal priced job (same
  `expectedPrice` rule, no price change).
- **Picture → video**: `resultAssetOf(url)` → `POST /api/media/inputs/from-result` (the P2b path: SQL ownership, a copy
  into the user's `photo_uploads` kind `studio`) → the copied asset id becomes `imageAssetId`; the submit re-checks it
  is the user's own photo (`photoExists` + `studioVideoInputsError`, unchanged). The handoff reads the video catalog
  FIRST and refuses with «Rasmdan video yaratish hozircha mavjud emas» when no start-image model is offered — no input
  copy is made then. The Video tab opens on «Matndan / rasmdan», the picture's prompt prefilled (editable; a utility job
  — upscale / bgremove / edit — hands an empty prompt), and `VideoTabState.fromPicture` keeps the picker on
  `startImageModels` (models with an `imageAssetId` image param; effects excluded) while the frame is set; removing the
  frame clears the flag (a later hand upload is an ordinary start frame). A job of several pictures asks «Qaysi
  rasmdan?» (numbered buttons); a gallery card uses its first stored picture (as the P2b tools there).
- **Clip → music**: «Audio», «Musiqa», the clip prompt as the description (cut to the model's max). **Prompt → Ovoz**:
  «Ovoz», «Matn», the text field of the chosen / default text model (`speechTextParam`), cut to `spokenMax`. Each
  handoff checks its tab offers the mode now (else a message). Offered on picture results / cards and on clips made
  from a prompt; NOT on effect clips (no prompt of their own), utility picture jobs (label, not description) or audio
  items. Gallery cards show them behind a «Keyingi qadam» disclosure (keeps the 2-column phone card short); result
  cards show them in a «Keyingi qadam» row.
- **Favourites**: migration **070** `studio_favorites (user_id, generation_id, created_at; PK both; both FKs ON DELETE
  CASCADE; index on generation_id)`. `PUT` / `DELETE /api/media/favorites/<generationId>` (`lib/server/media/favorites.ts`):
  idempotent, `{ id, favorite }`; a star only on the caller's OWN COMPLETED Studio generation (the INSERT selects from
  `generations WHERE id AND user_id AND tool_id IN studio tools AND status`), anything else 404 (same as missing);
  un-star deletes only the caller's row. No count limit; a 300 / 5 min rate limit only stops a runaway client. The
  gallery item carries `favorite` (EXISTS with the owner) and `?favorites=1` filters with the same keyset cursor.
- **Client**: `components/studio/Favorite.tsx` — a small zustand store of the stars toggled on this page (a result's star
  shows on its gallery card and back without a reload), optimistic toggle reverted with the server's message on failure.
  Gallery chips «Hammasi» / «Sevimlilar» (radio group, own empty state); an item un-starred inside «Sevimlilar» stays
  visible (re-starrable) until the list is reloaded.
- Tests: `tests/studio-favorites.test.mts` (4, real Postgres), `tests/ui/studio-chains.test.mts` (8),
  `tests/admin-migrations.test.mts` (070 lines), `tests/ui/studio-page.test.mts` (result action list + `to-video`,
  `to-voice`).

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

## P7a review fixes (2026-11-03, independent review: APPROVE WITH FIXES, no MAJOR)
- **MINOR-1** a stale per-model price answers ONE 409 with the new TOTAL and every model's price (the per-model guard
  moved out of `prepareGeneration` into the batch check); before, the message showed one model's price as «Yangi narx».
- **MINOR-2** the batch cap follows the admin's per-user in-flight cap: the session carries `features.compareMax`
  (= min(4, `queue.user_max_inflight`)); the panel offers at most that many ticks, and below two the switch is hidden.
  With today's default (2) a compare is 2 models; raising «Bir foydalanuvchiga bir vaqtda» in Sozlamalar to 4 opens 3–4.
- **NIT-1** the replay pre-check window equals the in-transaction one (24 h).
- Not changed (documented): burst slots spent by a refused batch (N per batch, consistent with «N generations»);
  migration 071's `CREATE INDEX` is not CONCURRENTLY (fine at today's table size); no cross-path idempotency tests.
