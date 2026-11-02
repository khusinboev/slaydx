# Studio P2b — prompt library, templates, editing and utility tools (spec + what shipped, 2026-11-02)

Parent: `docs/studio/PLAN.md` §5.6, §6, §17; builds on `P1-SPEC.md` and `P2-SPEC.md` (P2a fal adapter).

## What shipped

### A. Prompt library + templates
- **Migration `067_studio_library.sql`** (additive, header + ROLLBACK): `studio_prompts` (category, Uzbek title, prompt
  ≤ 500, optional preview, sort, enabled, `seed_key`), `studio_templates` (category, title, `model_id`, `params` JSONB
  object, `skeleton` with `{slot}`s, `slots` JSONB array, preview, sort, enabled), `studio_library_previews` (PNG / JPEG
  ≤ 512 KB, id = sha256 prefix). **Seed in the migration** (data, idempotent via `ON CONFLICT (seed_key)`): 40 prompts
  (4 × 10 categories: Portret, Mahsulot, Logo, Plakat, Tabriknoma, Ta'lim, Reklama, Tabiat, Arxitektura,
  Illyustratsiya — no real people, no brands) and 10 templates on Nano Banana, FLUX 3, Seedream 5 Lite / Pro,
  Ideogram 4.5, Recraft 4.1 / Pro (no GPT Image template: it may be unavailable). A seed module was not needed: the
  rows are plain data and the test validates every seeded template against the live catalog.
- **Shared rules** `lib/media/library.ts` (client-safe): categories, `fillSkeleton` (slot value → placeholder → nothing;
  braces stripped so a value can never inject a slot; dangling separators tidied), `templateError` (model must be a
  `studio.image` model; preset keys must exist in its ParamSchema and pass its `validate`; no `prompt` preset; skeleton
  slots == declared slots; prompt length at placeholders ≥ min and at full slots ≤ max).
- **Public reads** (`lib/server/media/library.ts`, rows cached 30 s, dropped on an admin write in-process):
  `GET /api/media/library?category=` (enabled only; fields `id, category, title, prompt, previewUrl`; unknown category
  400) and `GET /api/media/templates` (enabled AND valid AND model available right now — same `availableModels` the
  route refuses with; fields `id, category, title, modelId, params, skeleton, slots, previewUrl`).
  `GET /api/media/library/preview/<id>` serves previews (public, immutable; added to `next.config.ts` BYTE_ROUTES).
- **Admin page «Studio kutubxonasi»** `/admin/studio` (nav group «Boshqaruv», `settings.view`; writes `settings.edit`
  with step-up): tabs «Namuna promptlar» / «Shablonlar»; add, edit, enable / disable, move up / down (reorder inside
  one category), delete, preview upload; every write asks for a reason, writes `studio_prompt.*`,
  `studio_template.*`, `studio_library.reorder`, `studio_library.preview_upload` audit rows with before / after in the
  same transaction; `expectedUpdatedAt` → 409 `stale`; unchanged → 409 `state`. An invalid template is a 400
  `template_invalid` and is never stored; a stored template that became invalid or whose model is off shows a badge.
  Routes: `app/api/admin/studio-library/{route,prompts,prompts/[id],templates,templates/[id],reorder,previews}`.
- **Studio UI**: the prompt box's tool row — «Namuna promptlar» (sheet with category chips; tap fills the prompt),
  «Rasm yuklash», «Yaxshilash (AI)»; the «Shablonlar» row (cards of templates whose model is offered); a chosen
  template picks its model, applies its preset values (still editable in the settings rows) and shows one input per
  slot (`data-field="slot.<name>"`); typing in the prompt box leaves the template.

### B. Edit + utilities
One tool (`studio-image`), four new purposes' worth of models, so charge / refund / `delivered` / result page / gallery
are the P1 ones. The tab has a **mode** (picture / edit / upscale / background removal) = a catalog purpose; the page
loads that purpose's catalog; the server checks the model against its own purpose (`studioPurposeOf`).

| Catalog id | Purpose | Route | Params | USD (cost) | so'm at ×2, 12 700/$ | Source (read 2026-11-02) |
|---|---|---|---|---|---|---|
| `google/nano-banana-edit` | `studio.edit` | Gemini `google-image` (admin slot `image.gemini`), input pictures as `inputImages` | prompt, inputImages (1–3), imageCount 1–4 | 0.034 / picture (lite slot model; live slot price follows) | 900 / picture | existing price book (`IMAGE_PRICES`) |
| `bytedance/seedream-edit` | `studio.edit` | fal `bytedance/seedream/v5/lite/edit` | prompt, inputImages (1–3), imageCount 1–4 | 0.035 / picture | 900 / picture | https://fal.ai/models/bytedance/seedream/v5/lite/edit/llms.txt |
| `bytedance/seedvr-upscale` | `studio.upscale` | fal `fal-ai/seedvr/upscale/image` (`upscale_mode: factor`) | inputImages (1), factor ×2 / ×4 | 0.0168 / job (upper bound) | 500 / job | https://fal.ai/models/fal-ai/seedvr/upscale/image/llms.txt («$0.001 per megapixel») |
| `bria/background-remove` | `studio.bgremove` | fal `fal-ai/bria/background/remove` (no prompt) | inputImages (1) | 0.018 / job | 500 / job | https://fal.ai/models/fal-ai/bria/background/remove/llms.txt |

- **Inputs** are always the user's own `photo_uploads` rows (kind `studio`): «Rasm yuklash» → `POST /api/media/inputs`
  (PNG / JPEG ≤ 5 MB, ≤ 4096 px), or «Tahrirlash» / «Sifatini oshirish» / «Fonni olib tashlash» on a result card or a
  gallery item → `POST /api/media/inputs/from-result {generationId, assetId}` (copies one picture of the user's OWN
  completed Studio job; SQL `g.user_id = $3`; another user's job is a 404). `submitGeneration` checks every input id
  in ONE SQL (`user_id = $1`), type, size, and the upscale side limit (×2 ≤ 2048 px, ×4 ≤ 1024 px → output ≤ 16.8 MP,
  the priced upper bound) — 400 `input_invalid` BEFORE anything is priced or charged. The worker resolves the bytes
  (`studioInputsForJob`); a row gone meanwhile fails the job → full refund. Asset ids travel comma-separated (form
  values are scalars, `sanitizeValues`).
- **fal**: `FAL_TOOL_MODELS` in `lib/media/adapters/fal.ts` (one grouped block): inputs as `data:` URIs; a single `image`
  result is read as well as `images[]`; bria must answer a **PNG with alpha** (IHDR colour type 4 / 6 or `tRNS`) — an
  opaque PNG or a JPEG is refused (accepted: true → the picture is refunded).
- **Engine** `lib/generation/studio/edit.ts`: the edit instruction is translated to English by one LLM call (the
  «Rasm» pattern, quotes kept verbatim) and wrapped by `composeEditPrompt` («change only what is asked, keep the rest»);
  one `runMedia` call per picture under the model's purpose; doc / file / `delivered` exactly as P1.
- **«Yaxshilash (AI)»** `POST /api/media/enhance {prompt}` → `{prompt}`: FREE, rate-limited through the free-LLM
  policy (`lib/server/spend.ts` endpoint `enhance`): 10 / 10 min burst, `free_llm.daily.enhance` (default 30 / user /
  Tashkent day, env `FREE_LLM_DAILY_ENHANCE`, admin «Sozlamalar»), the global free-LLM cap and kill switch; spend
  metered as `free:enhance`. Same language out as in; the user edits the result before generating.

## Mutations
Recorded in the headers of `tests/studio-edit.test.mts`, `tests/studio-library.test.mts`,
`tests/ui/studio-library.test.mts` (each made the named test red, then restored; run by a scripted mutation pass).

## Known gaps / UNVERIFIED
- **fal inputs inline (UNVERIFIED for these three endpoints).** fal's CDN page says models «also accept base64-encoded
  data URIs» but recommends CDN uploads for anything over a few KB
  (https://fal.ai/docs/documentation/model-apis/fal-cdn.md, 2026-11-02); the raw CDN upload endpoint is not documented
  there. Inputs are capped at 5 MB; a fal storage-upload step is the follow-up if a live smoke shows size trouble.
- **SeedVR billing basis UNVERIFIED** (input or output megapixels): priced at the 16.8 MP upper bound, so we never
  undercharge; compare `media_jobs.cost_usd` with fal's billing after the first live jobs. Output is JPEG (an upscale of
  a transparent cut-out loses its alpha).
- **Nano Banana edit: no unit flow test with a Gemini stub** (the request carries `inputImages` exactly as the
  graduation portrait — covered by `tests/media-image.test.mts`); the fal edit path has the full flow test.
- The fal «Tekshirish» probe still compares only the six P2a endpoints' prices.
- Studio inputs share the photo upload quota (50 rows / 200 MB) and the 90-day photo purge; a queued job does not pin
  its inputs against the purge (a 90-day-old input used in a job fails it → refund).
- Recraft vectorize, inpaint with a mask, GPT Image edit: not in this package.
- No live provider call was made (no keys in this environment); the lead's live smoke on the admin account is pending.
