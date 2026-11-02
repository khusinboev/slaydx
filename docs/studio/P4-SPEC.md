# Studio P4 — more video in the «Video» tab: fal models, Kling end frame, «Quchoqlash» (spec, 2026-11-02)

Parent: `docs/studio/PLAN.md` §3 (video), §11–§13, §15 (P4), §17 («Kling» + «Aggregator» rows). Builds on P2a (the fal
adapter, `P2-SPEC.md`) and P3 (the Video tab, `media_jobs` async path, the shared poll loop, the Kling transport,
`P3-SPEC.md`).

## What ships
- **fal VIDEO** in `lib/media/adapters/fal.ts` (a marked block at the end; the picture builders and the blocking picture
  cycle are unchanged): `falVideoAdapter` (adapter id `fal-video`) is ASYNC — `submit` makes ONE queue POST and returns
  `fal:<endpoint>:<request_id>`; the Studio submit (`submitStudioVideoJob`) parks it in `media_jobs` exactly as for Kling;
  THE existing `video-poll` loop (`pollDueVideoOps` → `pollerFor` studio branch → the row's route adapter) calls `poll`
  (status, then the result at `COMPLETED`) and `fetchOutput` (MP4 download); `finalizeVideo` / `failVideo` lock the same
  row, refund exactly once. No second poll loop, no blocking call.
  - key only to `queue.fal.run` (`Authorization: Key …`), every call `redirect: "manual"`, every message scrubbed;
  - the status / result URLs are rebuilt from the op id's endpoint (owner/app), and the endpoint must be one of
    `FAL_VIDEO_ENDPOINTS` — a stored op id can never steer the key elsewhere;
  - `X-Fal-Request-Start-Timeout: 600`: a clip fal could not START in 10 min is dropped by fal (not billed);
  - submit: 401/402/403/400/404/422 refused (not accepted, not retryable), 422 `content_policy_violation` = safety,
    429/5xx retryable, 3xx refused, network drop / answer without `request_id` = **accepted** (maybe queued at fal: never
    sent to a second route, refunded);
  - poll: `IN_QUEUE` / `IN_PROGRESS` → running; `COMPLETED` with `error` → failed (policy → safety, Uzbek safety message);
    result 404 / 422 / 499 / 500 / 504 → failed (the model's final answer); 429 / 502 / 503 / network → retry (the result
    is kept ≥ 1 h); status 404 → failed; a missing key after submit → retry until the job's deadline refunds it;
  - output: the `video.url` downloaded WITHOUT the key through `safeFetchUrl` (https + public host on every hop, capped at
    `VIDEO_MAX_BYTES` = 25 MB), `isMp4` checked (then `pollOp` checks size + MP4 again).
- **Five catalog entries** (`lib/media/catalog-video.ts` `FAL_VIDEO_ENTRIES`, after Kling 3.0 in the picker, the effects
  stay last): each has `prompt`, `seconds` (≤ 10), `resolution` («Sifat», sets the price), `aspect` (16:9 / 9:16 / 1:1,
  text → video only), `sound` (Wan, Seedance: a switch, same price), start image, **end frame**. Text vs image endpoint is
  chosen by the start image. Every param changes the request or the price (probe test).
- **Kling 3.0 end frame**: `endImageAssetId` on both Kling 3.0 tiers → image2video `image_tail` (raw base64), same price.
- **«Quchoqlash»** (`hug`): the direct API's documented two-photo scene → `/v1/videos/effects`
  `{ effect_scene: "hug", input: { model_name: "kling-v1-6", mode: "std", images: [a, b], duration: "5" } }`; the effects
  entry gains `secondImageAssetId` (sent only for a two-photo scene). Priced as every effect.
- **Photos**: every `image` param a job sends (start, end frame, second photo — `studioVideoImageParams`) is checked to be
  the user's own upload before charging (`submit-generation.ts`) and resolved by owner at submit (`video-ops.ts`).
  Preflight (`studioVideoError`): an end frame needs a start; «Quchoqlash» needs both photos; a one-photo scene refuses a
  second photo.
- **UI** (`components/studio/video/VideoTab.tsx`): the sheet lists the fal models with maker, badges and «~X so'm / 5 s»;
  the form is the model's ParamSchema (Segmented «Sifat»); «Kadrlar (ixtiyoriy)» shows the end-frame upload only for a
  model that takes one (not Omni); «Quchoqlash» shows a second photo («Ikkinchi surat»), the one-photo scenes do not.
- **Admin «Media modellari»** lists the five automatically (`managedModelIds` = the purpose's allowed list), unit «5
  soniya», price by `studioVideoPrice`; availability = fal on + keyed + not switched off; the tab itself also needs
  `video.enabled` (P3). Provider `fal` is now `kinds: ["image", "video"]`, label «fal.ai (rasm va video)». The «Narxlar»
  ladder (`admin-pricing.ts studioVideoRungs`) gives a fal model one rung per resolution tier at its shortest / longest
  length; a sound rung only where sound changes the price (Kling), so free sound is not a duplicate row.

## Models and prices (USD per second of output; so'm = USD × s × 2 × 12 700, rounded up to 100; read 2026-11-02)

| Catalog id | Label · badges | fal endpoints (t2v / i2v) | Tier USD / s | 5 s | 10 s | Source |
|---|---|---|---|---|---|---|
| `alibaba/wan-3` | Wan 3.0 · ovozli | `alibaba/wan-3.0/text-to-video` / `…/image-to-video` | 480p 0.05 · 720p 0.10 · 1080p 0.20 | 6 400 · 12 700 · 25 400 | 12 700 · 25 400 · 50 800 | https://fal.ai/models/alibaba/wan-3.0/text-to-video/llms.txt , …/image-to-video/llms.txt |
| `bytedance/seedance-2.5` | Seedance 2.5 · sifatli, ovozli | `bytedance/seedance-2.5/us/text-to-video` / `…/image-to-video` | 480p 0.2205 · 720p 0.473 («roughly», token-billed) | 28 100 · 60 100 | 56 100 · 120 200 | https://fal.ai/models/bytedance/seedance-2.5/us/text-to-video/llms.txt , …/image-to-video/llms.txt |
| `bytedance/seedance-2-mini` | Seedance 2.0 Mini · ovozli | `bytedance/seedance-2.0/mini/text-to-video` / `…/image-to-video` | 480p 0.0721 · 720p 0.1547 («roughly») | 9 200 · 19 700 | 18 400 · 39 300 | https://fal.ai/models/bytedance/seedance-2.0/mini/text-to-video/llms.txt , …/image-to-video/llms.txt |
| `minimax/h3` | MiniMax H3 · arzon | `minimax/h3/text-to-video` / `…/image-to-video` | 480p 0.05 · 768p 0.06 | 6 400 · 7 700 | 12 700 · 15 300 | https://fal.ai/models/minimax/h3/text-to-video/llms.txt , …/image-to-video/llms.txt |
| `minimax/h3-max-turbo` | MiniMax H3 Max Turbo · arzon | `minimax/h3-max-turbo/text-to-video` / `…/image-to-video` | 480p 0.025 · 768p 0.04 · 1080p 0.08 (standard rate from 2026-11-16) | 3 200 · 5 100 · 10 200 | 6 400 · 10 200 · 20 400 | https://fal.ai/models/minimax/h3-max-turbo/text-to-video/llms.txt , …/image-to-video/llms.txt |
| `kling/kling-3`, `-pro` + end frame | (P3 prices, unchanged) | `/v1/videos/image2video` + `image_tail` | as P3 | as P3 | as P3 | ComfyUI `KlingFirstLastFrameNode` (nodes_kling.py, master, read 2026-11-02) |
| `kling/effects` `hug` «Quchoqlash» | — | `/v1/videos/effects` dual input | 0.84 / clip (the P3 effect quote) | 21 400 | — | ComfyUI vendored Kling OpenAPI `KlingDualCharacterEffectInput` (apis/__init__.py, read 2026-11-02) |

Seedance 2.5 / Mini and the H3 tiers chosen as «fast/lite + pro» pairs: Seedance 2.0 Fast (`bytedance/seedance-2.0/fast/*`,
$0.2419 / s at 720p, no 480p number published) costs more than Mini and less than 2.5 with no clear reason to sell it;
Wan 3.0 Prime ($0.068 / 0.14 / 0.28) and H3 Max ($0.05 / 0.08 / 0.16) are one catalog entry each to add later.
Not sold: Seedance 2.5 1080p ($1.164 / s), H3 2K / 4K (upscales of 768p), anything over 10 s (see gaps).
Queue protocol: https://fal.ai/docs/api-reference/inference-api/queue/status.md and …/queue/result.md (read 2026-11-02).

## UNVERIFIED (check on the first live call with the owner's key, admin account)
1. **Seedance token billing**: fal bills `width × height × seconds × 24 / 1024` tokens; the per-second figures are fal's
   own («roughly»). 1:1 / 9:16 at the same tier are assumed to have the same pixel count (ByteDance's size tables).
   «Tekshirish» does not yet compare video prices (see gaps): compare fal's billed amount with `media_jobs.cost_usd`.
2. **H3 Max Turbo** is quoted at the standard rate that starts 2026-11-16 (fal's November promotion is 30 % lower) —
   until then our margin is higher than ×2, never lower.
3. **Inline frames**: start / end frames go to fal as `data:` URIs (≤ 5 MB upload cap ⇒ ≈ 6.7 MB of base64 in the JSON);
   fal documents data URIs for inputs, not a body limit for these endpoints.
4. **«Quchoqlash»** on the direct Kling API: the `images` entries as raw base64 (the single-image input documents that
   form; the dual one does not say), `model_name: kling-v1-6`, and the price (Kling's unit list is not readable; quoted
   at the effect price $0.84).
5. **Kling 3.0 `image_tail`** on the direct API (ComfyUI's First-Last-Frame node sends it through Comfy's proxy).
6. Result size: a 10 s 1080p clip must fit the 25 MB cap; a bigger file fails and is refunded (fal still bills it).

## Gaps (not built in P4)
- **Kling motion control** (`/v1/videos/motion-control`, a reference VIDEO; ComfyUI prices kling-v3 std 0.126 / pro 0.168
  per s): needs a video upload, which the app does not have — not built.
- **Kling lip-sync, avatar, virtual try-on** (ComfyUI master nodes, read 2026-11-02): lip-sync `/v1/videos/lip-sync`
  (badge «≈ $0.10», approximate) needs a VIDEO + audio / text; avatar `/v1/videos/avatar/image2video` ($0.056 / $0.112
  per s, std / pro) needs an AUDIO input; virtual try-on `/solutions/virtual_try_on` ($0.16016) returns a PICTURE, not a
  clip (a Rasm-tab tool). None fits the Video tab's inputs (photo + text) — not built. **Extend**: no node and no
  documented direct-API shape found — not built.
- **Kling 4.0** exists in ComfyUI master (`Kling4TextToVideoNode` … , $0.22451 / s 720p, $0.33605 / s 1080p): a new
  model, not in the P4 brief — owner question.
- **fal camera controls / extend / lip-sync** (`minimax/h3-max/camera-controls`, `…/extend-video`,
  `…/lip-sync/image-to-video`): exist with prices on fal; extend and lip-sync need a video / audio input — next phase.
- **Video upscale** (P4 «utility»): not built (needs a video input; fal `fal-ai/seedvr/upscale/video` exists).
- **Over 10 s**: the models take 15–30 s; 10 s keeps a 1080p clip well inside the 25 MB cap. Raise per model after the
  first live sizes are known.
- **Deadline cancel**: the shared poll loop fails a job at its 20-minute deadline without telling fal; a clip fal finishes
  later is billed to us and unrecorded (the 10-minute start timeout limits this to clips that started).
- **«Tekshirish» for video prices**: the fal probe compares only the picture endpoints' unit prices
  (`falEndpointPrices` reads `FAL_IMAGE_MODELS`); adding the ten video endpoints is a follow-up in
  `lib/server/providers/probe.ts`.
- **«Yana yaratish» from the gallery** re-opens a fal clip at the default resolution (the gallery item carries length,
  aspect and sound only); the button shows the live price, so nothing is mischarged. Carrying `resolution` needs
  `lib/server/media/public.ts` + `StudioPage.videoAgain` (P5's file during this phase).

## Tests
`tests/studio-video-fal.test.mts` (catalog, golden bodies × t2v / i2v / end frame, Kling `image_tail` + `hug` goldens,
probe of every fal param, adapter contract: submit / status / result / download / op ids / key scrub, price goldens,
client == server, preflight), `tests/studio-video-fal-flow.test.mts` (isolated DB: gating, the shared poll loop end to
end, end frame, short-clip refund, refunds once for error / policy / deadline / submit 4xx / network drop, a
`submitting` row never resubmitted, «Quchoqlash» and the Kling end frame through the worker), `tests/ui/studio-video-p4.test.mts`
(sheet lists the models with badges + prices, «Sifat» price, submit contract, end frame only where taken, second photo
only for «Quchoqlash»). Updated for the new entries (no assertion removed): `studio-video` (purpose list, probe fixtures +
end-frame branch), `ui/studio-video` (10 scenes, the `endImageAssetId` value), `studio-admin-media` (the managed list +
fal video rows), `provider-keys` (fal kinds), `admin-pricing` (+ the P4 rung test).
