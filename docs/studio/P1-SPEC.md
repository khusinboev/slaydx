# Studio P1 — Studio shell + «Rasm» tab (spec, 2026-11-01)

Parent: `docs/studio/PLAN.md` §15 (P1), `P0-SPEC.md` (core, shipped prod `be9e7d41`). Design canvas: phone «Rasm» and
model picker screens, desktop 3-column layout (`https://claude.ai/artifact/RKtqPUxeyEnV5F5dJJ7m1A`).

## Owner decisions (2026-11-01)
- **Price in Studio = provider cost × 2** (`media.markup`, default 2; per-model override in admin), rounded UP to 100
  so'm. The old «Rasm» tool keeps its ladder (2 000 / 3 500 / 6 000) until P8 folds it into Studio.
- **Entry**: a large «Studio» card on the home page + first item of the Media group. Bottom tabs unchanged.
- Video / Ovoz tabs appear when their phases land (P3 / P5); P1 shows the Rasm tab only (no «tez orada» decoration).
- Every live test lands on the admin account (`adkhambek_4`, +998997333896) through the real queue.

## User-visible result
`/uz/studio` (and the localized twins of other pages' pattern): prompt box, model row + «Barcha modellar» picker
sheet (Nano Banana, GPT Image), parameter rows generated from the model's ParamSchema (O'lcham, Soni, Uslub under
«Qo'shimcha sozlamalar»), sticky «Yaratish · N ta rasm · X so'm» button with the live price, progress panel, result
cards (download, «Qayta», «Boshqa modelda»), and a «Galereya» of the user's Studio images. Phone-first; tablet and
desktop use the 3-column layout of the canvas. Dark mode follows the app theme.

## Contract between backend and frontend (both agents code against THIS)
### Tool
- New `ToolId` **`studio-image`** (group Media, slug `studio`), `custom: "studio-image"`. Form values:
  `{ modelId: string (catalog id), prompt: string, imageRatio, imageCount, imageStyle }` — exactly the catalog
  ParamSchema of the chosen model + `modelId`. Unknown / unavailable model → 400 before charging.
- Purpose **`studio.image`** (allowed: `google/nano-banana`, `openai/gpt-image`; default nano-banana; userCanChoose).
- Price: `priceFor(studio-image, values)` = `mediaQuote(modelId, values, { soumPerUsd, markup, override })` with the
  admin per-model override; then the tool's `tool_pricing` % as for every tool. Server is the only authority
  (client sends no price). Client preview uses the same function with the context below.
### Session / API
- `GET /api/media/catalog?purpose=studio.image` → `{ purpose, defaultModelId, models: ClientEntry[] (only available
  ones, catalog order), pricing: { soumPerUsd, markup, step: 100, overrides: { [modelId]: { markup } } } }`.
  Public data only (no routes, no upstream ids). Cached ≤ 30 s.
- Generation goes through the existing `POST /api/generations` (tool `studio-image`) → charge + enqueue in one tx →
  worker → `buildStudioImage` (runs `runMedia` per picture with purpose `studio.image`, ALWAYS through the core —
  the Studio is a core-native caller, not behind `media.core.image`) → `BuiltFile` like «Rasm» (zip / single image,
  `doc` with `images`, `imageModel` = catalog id) → existing result/progress endpoints, partial refund via `delivered`.
- `GET /api/media/gallery?cursor=` → the user's completed `studio-image` generations (id, created_at, model label,
  prompt, thumbnails via the existing file/thumb endpoints), newest first, 24 per page; ownership in SQL.
### Admin
- Migration **066** `media_model_overrides (model_id PK, enabled bool, markup numeric CHECK 1–20, updated_by,
  updated_at)` + setting `media.markup` (number 1–20, default 2, group «Narxlar»/tab «Narx va marja»).
- Admin «Narxlar» gets a «Media modellari» block: per model — provider cost per unit (USD and so'm), price at the
  current markup, margin, enable switch, markup override (step-up + reason + audit, like other price writes).
- Availability = provider enabled + key + `media_model_overrides.enabled` (absent = on) — the catalog endpoint and the
  route check the same function.

## Carried from the P0 review
- **M5**: housekeeping step fails `media_jobs` rows stuck in `submitting` > 1 h (sync kinds) and deletes rows older
  than 90 days (batched); both in the leader's housekeeping like `video-poll`.
- **N3**: `runMedia` rejects a `modelId` not in `purpose.allowed` (unknown purpose = programmer error → throw).
  Listening's operator-configured ElevenLabs must keep working: add `elevenlabs/tts` to `listening.voice.allowed`.

## Work split
| Package | Owner | Files |
|---|---|---|
| A — backend + admin (money) | builder (opus) | `lib/tools.ts` (studio-image entry + priceFor branch), `lib/types.ts`, `lib/media/catalog.ts` (purpose), `lib/media/quote.ts`, `lib/server/media/*` (availability, overrides, sweeper, N3), migration 066, `lib/server/settings.ts` (+`media.markup`), `app/api/media/**`, studio-image engine (`lib/generation/studio/`), worker dispatch, admin «Narxlar» block (`app/admin/**pricing**`, `components/admin/pricing/**`), tests |
| B — Studio UI | builder (sonnet) | `app/uz/studio/**` (+ other locale twins if the app has them), `components/studio/**` (StudioShell, PromptBox, MediaModelPicker, ParamRows from ParamSchema, PriceButton, ResultCards, Gallery), home card + Media group entry, `tests/ui/studio-*.test.mts`, Playwright smoke script |
B codes against the contract above with a fetch stub until A lands; the lead merges A first, then B, then runs the
browser smoke (phone 390×844, tablet, desktop; light + dark) and a live job on the admin account.

## Tests (as P0)
Price: cost × markup golden per model × count, override wins, rounding up, `priceFor` == server price; route rejects
unavailable / disallowed model before charge; flow test: charge → worker → file → partial refund on a failed picture;
catalog endpoint never leaks routes; ParamSchema-driven form: every schema param renders exactly one `data-field`
(probe test, «every param must work»); mutation list per test file; browser smoke for the picker sheet and sticky button.
