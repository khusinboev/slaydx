# Studio P2 — more image models through fal.ai (spec, 2026-11-02)

Parent: `docs/studio/PLAN.md` §4, §11–§13, §15 (P2), §17 (aggregator rows). Builds on P1 (`P1-SPEC.md`).
P2 is split: **P2a** (this file, shipped first) = the fal adapter + six models; **P2b** = prompt library, image
templates, «Namuna promptlar», editing / utility tools.

## What P2a ships
- Provider **`fal`** back in the registry (kind `image`, `implemented`, `testable`). The key lives in the admin
  «Provayderlar» store. `FAL_KEY` is only a dev/script fallback: **docker-compose deliberately does not pass it**, so a
  stale pre-2026-10-31 key left in the server `.env` cannot switch the models on at deploy. «Tekshirish» reads fal's
  price list for our six endpoints (free, authenticated; `GET https://api.fal.ai/v1/models/pricing`), reports any
  price that differs from our price book, and shows the balance when the key may read it
  (`GET https://api.fal.ai/v1/account/billing?expand=credits`, needs `billing:usage:read`).
- **One generic adapter** `lib/media/adapters/fal.ts`: queue API (submit → status poll → result) inside the job's
  deadline, `Authorization: Key …` only to `queue.fal.run`, no redirect followed, outputs as inline bytes with a
  sniffed type (`sync_mode` data URIs, or a key-less `safeFetchUrl` download), best-effort cancel on timeout,
  `X-Fal-Request-Start-Timeout` so fal drops a job that could not start in time. Error mapping: 401/402/403 account,
  400/404/422 validation, 422 `content_policy_violation` / `has_nsfw_concepts` safety, 429/5xx retryable; every failure
  after a request id exists is `accepted` (no fallback, no double cost). fal has no submit idempotency key (queue docs,
  2026-11-02), so nothing resubmits.
- **Six catalog entries** (`lib/media/catalog.ts`; Seedream and Recraft in two tiers each, owner 2026-11-02), added to `studio.image.allowed` after Nano Banana and GPT Image;
  Nano Banana stays the default. Same Studio params (prompt, O'lcham, Soni, Uslub); «Soni» = N calls of one picture
  (a failed picture is refunded alone); «Uslub» works through the engine's composed prompt. One model-specific param:
  Ideogram **Sifat** (`quality`, advanced; «Yuqori» kept, owner 2026-11-02) — changes the request and the price.
- **Text in pictures** (owner 2026-11-02): in the STUDIO engine only, a model whose catalog entry carries the `matn`
  badge (GPT Image, Ideogram 4.5) gets the composed prompt WITHOUT the «absolutely no text…» clause and with
  `textInstruction(quotedTexts(prompt))`: render exactly the text the user put in quotes («…», „…“, “…”, "…"), nothing
  else (no quotes → no text unless asked). Every other Studio model and the «Rasm» tool keep the no-text prompt byte for
  byte (`composePrompt` without `text`; `tests/media-fal.test.mts` pins both).
- Availability = provider `fal` on + keyed + model not switched off in «Media modellari» (the block lists the six by
  itself). Studio UI unchanged (renders from the catalog).
- Spend: one `media_jobs` row per picture (provider `fal`, upstream = endpoint id, cost of one picture), the job meter
  records `image / fal / <endpoint>` (admin cost pages, the fal card in «Provayderlar»).

## Models (prices read on 2026-11-02; so'm = USD × 2 × 12 700, rounded up to 100, per picture)

| Catalog id | Label | fal endpoint | USD / picture | so'm (×2) | Source |
|---|---|---|---|---|---|
| `bfl/flux` | FLUX 3 | `blackforestlabs/flux-3/text-to-image` (`resolution: 1k`) | 0.048 | 1 300 | https://fal.ai/models/blackforestlabs/flux-3/text-to-image/llms.txt |
| `bytedance/seedream` | Seedream 5 Lite | `bytedance/seedream/v5/lite/text-to-image` (2K–4K sizes) | 0.035 | 900 | https://fal.ai/models/bytedance/seedream/v5/lite/text-to-image/llms.txt |
| `bytedance/seedream-pro` | Seedream 5 Pro | `bytedance/seedream/v5/pro/text-to-image` (≈ 2.1 MP, under the 1536² step) | 0.0675 (tentative) | 1 800 | https://fal.ai/models/bytedance/seedream/v5/pro/text-to-image/llms.txt |
| `ideogram/ideogram` | Ideogram 4.5 | `ideogram/v4.5` | 0.03 / 0.06 / 0.22 (Tez / Standart / Yuqori) | 800 / 1 600 / 5 600 | https://fal.ai/models/ideogram/v4.5/llms.txt |
| `recraft/recraft` | Recraft 4.1 | `fal-ai/recraft/v4.1/text-to-image` | 0.035 | 900 | https://fal.ai/models/fal-ai/recraft/v4.1/text-to-image/llms.txt |
| `recraft/recraft-pro` | Recraft 4.1 Pro | `fal-ai/recraft/v4.1/pro/text-to-image` | 0.21 | 5 400 | https://fal.ai/models/fal-ai/recraft/v4.1/pro/text-to-image/llms.txt |

Queue protocol: https://fal.ai/docs/model-apis/model-endpoints/queue · errors: https://fal.ai/docs/model-apis/errors ·
billing ("only successful outputs", no charge on ≥ 500): https://fal.ai/docs/documentation/model-apis/pricing.

**Reve**: not on fal 2026-11-02 (`fal-ai/reve/text-to-image`, announced 2025-10-18, is absent from
`GET https://api.fal.ai/v1/models?endpoint_id=…` → 404). **Qwen Image 3**: owner declined for now (one catalog entry to
add later, `alibaba/qwen-image-3/text-to-image`, $0.04 at 1K).

UNVERIFIED: FLUX 3 bills per megapixel; the page states «a 1K (1 MP) image costs $0.048» and the adapter always asks
`1k`, but how a non-square 1k frame is rounded is not documented — the admin «Tekshirish» shows fal's own unit price
next to ours. Seedream 5 Pro's price is marked «Tentative … Final pricing is not yet confirmed» by fal (the probe will
show a change). Whether 4xx answers (content-policy refusals) are billed is not documented.

## P2b (next)
Prompt library + «Namuna promptlar», image templates, editing (FLUX / Seedream edit endpoints, `i2i`), utility tools
(upscale, background removal, Recraft vectorize).
