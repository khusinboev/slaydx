# Studio P3 — «Video» tab: Gemini Omni + Kling 3.0 + Kling effect templates (spec, 2026-11-02)

Parent: `docs/studio/PLAN.md` §3 (video), §11–§13, §15 (P3), §17 (Google + Kling rows). Builds on P0 (core +
`media_jobs`), P1 (Studio shell, cost × markup) and P2a (fal). Design: canvas «TelegramVideo» (Video tab: «Shablon
effektlar» | «Matndan / rasmdan», 3×3 effect grid with a 5 s badge, upload box, «Yaratish · «Tug‘ilgan kun» · … so'm»).

## What ships
- **Tool `studio-video`** (group media, output mp4, purpose **`studio.video`**). The page is the Studio's Video tab
  (`/uz/studio`, `?tab=video` opens it; `/uz/studio-video` only redirects there). The tool gets no card of its own:
  `listedTools()` / `UNLISTED_TOOL_IDS` (`lib/tools.ts`) keep it out of the catalogue, the create sheet, the search and
  the home groups (the Studio card leads to it). Excluded from the chat tools.
- **Always on the media core + `media_jobs`**, whatever `media.core.video` says (a core-native caller, like the Studio's
  pictures): `submitStudioVideoJob` (`lib/server/video-ops.ts`) writes the `media_jobs` row (purpose `studio.video`, the
  chosen catalog model, idempotency key `<generationId>:video:0`) under the per-generation advisory lock BEFORE the
  provider call, submits through the model's catalog routes (`submitWithRoutes`), parks, releases the lease. Polling is
  THE existing `video-poll` loop: `claimDueOps` claims `video.clip` then `studio.video` rows in one batch, `pollerFor`
  picks the Studio adapter of the row's model, `finalizeVideo` / `failVideo` lock the same row (exactly-once
  finalisation, one refund). No second poll loop. The admin «stuck» view already excludes the row by its key.
- **Price** = provider cost (per second × length, by tier and sound; per clip for an effect) × `media.markup` (model
  override wins), rounded UP to 100 so'm (`studioEntryPrice`, the Rasm tab's function) → `studioVideoPrice`
  (`lib/media/studio-video-pricing.ts`) on the server, `studioVideoClientPrice` (`components/studio/video/video-price.ts`)
  in the browser, then the tool's `tool_pricing` %. The «Video» tool keeps its ladder (P8 folds it).
- **Paid balance only** (owner D5, as «Video»): `isPaidOnlyTool` (`lib/tool-kinds.ts`) covers `video` + `studio-video` in
  the charge, the 402 message and the bar («To‘langan balans»). Both video tools share `video.max_concurrent` and are
  left out of the queue-wait estimate (`VIDEO_TOOLS_SQL`).
- **Results**: MP4 stored as the generation file (`format mp4`, the existing `VideoViewer` result page), `doc.video`
  with `model` (catalog id) and `effect`, `cost_json` from the catalog cost rule at the delivered length; a clip more
  than 1 s short of a per-second price refunds the difference (as «Video»; effects are per clip, no partial refund).
- **Gallery** (`GET /api/media/gallery`): pictures and clips together, newest first; an item has `kind: "image" | "video"`
  and `video: { src: /api/generations/<id>/file?inline=1, seconds, aspect, effectLabel } | null` (pictures keep
  `images`). The card plays the first frame of the file; «Yana yaratish» returns to the Video tab.
- **UI** (`components/studio/video/`): tab bar in `StudioPage` (Rasm state and Video state both kept across switches,
  the video catalog loaded on first open); effects mode = the catalog's effect scenes as a 3×3 grid with «5 s», the
  photo (PhotoField, required); text/image mode = prompt, model picker (video models only, card «~X so'm / N s»), the
  model's ParamSchema rows, optional start image; sticky «Yaratish · «Effekt» | N soniya · X so'm»; progress = the app's
  `GenerationProgress` (video stage list / ETA); finished clip plays inline with «Yuklab olish», «Qayta», «To‘liq ko‘rish».
- **Admin «Media modellari»** lists the four video models after the pictures (unit «5 soniya» / «effekt», priced with
  `studioVideoPrice` + the `studio-video` tool %); «Narxlar» ladder rungs per model (shortest / longest length, silent /
  with sound; one rung per effect).

## Switches (decided)
- **`video.enabled` gates the Video tab too** (recommended in the brief, implemented): one switch for paid video. Off
  (the shipped default) → `features.studioVideoModels = []`, `GET /api/media/catalog?purpose=studio.video` lists nothing,
  `POST` is 400 `video_disabled`, nothing charged.
- Then per model: provider on + keyed in «Provayderlar» (`veo` for Omni, `kling` for the three Kling entries) and not
  switched off in «Media modellari» (`modelAvailable`, the same function for the catalog, the route and the worker).
- `google/omni-video` is sold by «Video» (ladder) and by the Studio (cost × markup): its «Media modellari» switch and
  markup act on the Studio only.

## Models and prices (so'm = USD × 2 × 12 700, rounded up to 100; read 2026-11-02)

| Catalog id | Endpoint (POST, then GET `…/{task_id}`) | Params | USD | so'm at ×2 |
|---|---|---|---|---|
| `google/omni-video` (default) | Gemini Interactions (existing adapter, `gemini-omni-1.1-flash`, 720p) | prompt, 5 / 8 s, 16:9 / 9:16, start image | 0.10 / s | 5 s 12 700 · 8 s 20 400 |
| `kling/kling-3` «Kling 3.0» | `{BASE}/v1/videos/text2video` · `image2video` — `model_name: kling-v3`, `mode: std` (720p) | prompt, 3–15 s, 16:9 / 9:16 / 1:1 (t2v), sound on/off, start image | 0.084 / s silent, 0.126 / s sound | 5 s 10 700 / 16 100 · 10 s 21 400 / 32 100 · 15 s 32 100 / 48 100 |
| `kling/kling-3-pro` «Kling 3.0 Pro» | same, `mode: pro` (1080p) | same | 0.112 / s silent, 0.168 / s sound | 5 s 14 300 / 21 400 · 10 s 28 500 / 42 700 · 15 s 42 700 / 64 100 |
| `kling/effects` «Kling effektlar» | `{BASE}/v1/videos/effects` — `{ effect_scene, input: { image, duration: "5" } }` | effect (9 scenes), photo (required) | 0.84 / clip | 21 400 |

`BASE` = `https://api-singapore.klingai.com` (unchanged); auth = the existing HS256 JWT over the `<accessKey>:<secretKey>`
key, one transport (`klingCall`) for every shape. The old «Video» tool's Kling request stays `kling-v2-master` byte for
byte (its golden test is unchanged).

Sources:
- Kling 3.0 request shape and prices: ComfyUI «Kling 3.0 Video» partner node — `comfy_api_nodes/nodes_kling.py`
  (`KlingVideoNode`: model `kling-v3`, duration 3–15, 720p → `std`, 1080p → `pro`, `sound: on|off`, `aspect_ratio` ignored
  in image-to-video; price badge 720p $0.084 / $0.126, 1080p $0.112 / $0.168, 4K $0.42 per second) and
  `comfy_api_nodes/apis/kling.py` (`TextToVideoWithAudioRequest`, `ImageToVideoWithAudioRequest`), ComfyUI commit
  `de37ca2` (2026-10-26), read via the GitHub API 2026-11-02.
- Effects request: Kling OpenAPI as vendored by ComfyUI, `comfy_api_nodes/apis/__init__.py` (`KlingVideoEffectsRequest`,
  `KlingSingleImageEffectInput`: `image` = URL or raw base64, ≤ 10 MB, ≥ 300 px, aspect 1:2.5–2.5:1; `duration` "5").
  Kling's own page (https://kling.ai/document-api/api/effects/video-effects, «219 effects, 204 single-image») is a
  JavaScript app and could not be read.
- Effect scene ids: present by these exact ids in BOTH pass-through lists — fal
  https://fal.ai/models/fal-ai/kling-video/v1.6/standard/effects/llms.txt and WaveSpeed
  https://wavespeed.ai/docs/docs-api/kwaivgi/kwaivgi-kling-effects (read 2026-11-02).
- Effect price: WaveSpeed «most effects start at $0.84» (URL above) = PLAN §3 «effects ~$0.84 each»; fal bills its
  v1.6 effects $0.056 / s ($0.28 per 5 s). The higher number is the quote.
- Omni: https://ai.google.dev/gemini-api/docs/pricing ($17.50 / 1M output tokens × 5 792 tokens / s, read 2026-10-24).

### Effects sold (grid order)
| `effect_scene` | Uzbek label | canvas |
|---|---|---|
| `happy_birthday` | Tug‘ilgan kun | ✓ |
| `surprise_bouquet` | Gul guldasta | ✓ |
| `glamour_photo_shoot` | Fotosessiya | ✓ |
| `box_of_joy` | Bayram | ✓ (gift-box scene) |
| `zombie_transform` | Zombi | ✓ |
| `pure_white_wings` | Oq qanotlar | new |
| `bullet_time_360` | 360° kadr | new |
| `throne_of_king` | Shoh taxti | new |
| `snowglobe` | Qorli shar | new |

Not sold: «Quchoqlash» (`hug_pro` needs TWO photos — a two-photo upload is P4), «Xotira tiriladi», «Trampolin»,
«Kiyim» (no single-image scene with a documented id). Preview thumbnails: none (no licensed preview set; the grid is text).

## UNVERIFIED (check on the first live call with the owner's key, admin account)
1. Kling's own unit prices for `kling-v3` std / pro × sound and for effects (the account's price list in «units»); the
   numbers above are ComfyUI's / WaveSpeed's public prices. A higher real price → raise the model's markup in «Media
   modellari» until the quote is fixed.
2. Whether the new effect scenes need `input.model_name` (the vendored OpenAPI lists `kling-v1-6` for its five legacy
   scenes only); we send none. Whether `duration` is accepted for every scene.
3. That all nine scenes exist on the direct Kling API under the same ids (they do on fal and WaveSpeed, which pass
   through to Kling).
4. `kling-v3` result size: a 15 s 1080p clip must fit the 25 MB result cap (`VIDEO_MAX_BYTES`); a bigger file fails
   and is refunded.
5. Kling safety code 1301 for the effects endpoint (the same as text2video in the client libraries).

## Known gaps / notes
- **«Tayyor bo‘lgach botga ham yuboriladi»** (canvas) is NOT shown: the «Video» tool does not notify the bot when a job
  finishes (no such code path exists); building it is a new bot feature, out of P3 scope.
- The gallery's clip card loads the MP4's first frame (`preload="metadata"`); in bearer-mode webviews `useApiSrc` turns
  each into a `blob:` URL, i.e. the whole file is fetched per card. A poster image (first-frame JPEG at finalise) is the
  follow-up if the Mini App gallery feels heavy.
- Upload is the existing `PhotoField` (square crop, ≤ 5 MB): an effect photo is cropped square.
- A re-claimed job whose `media_jobs` row is `submitting` (worker died between the call and the update) is failed and
  refunded, never submitted twice — the provider may have started a paid clip nobody will download (as «Video»).
- Kling 3.0 4K, multi-shot / storyboard, end frame, camera control, extend, lip-sync, try-on: P4 (PLAN §17).

## Tests
`tests/studio-video.test.mts` (catalog, golden bodies, differential probe of every param, JWT, error mapping, price
goldens, client == server, preflight), `tests/studio-video-flow.test.mts` (isolated DB: gating, money, submit → park →
poll → finalize, effect flow, refunds, gallery), `tests/ui/studio-video.test.mts` (tabs keep state, effects grid +
required photo, text form + data-field probe + price, results). Updated for the new tool: `studio-admin-media`,
`pricing`, `pricing-server`, `download-formats`, `viewer-kind`, `ui/studio-page`, `ui/home-hub`, `ui/home-phone`,
`ui/shell-phone`, `ui/create-sheet` (each lists the new tool / tab; no assertion removed).
