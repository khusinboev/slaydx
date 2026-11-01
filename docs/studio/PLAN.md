# SlaydX Studio — AI image / video / voice studio (plan, 2026-11-01)

Status: **plan approved in principle** (owner 2026-11-01, §10); shortlist §11; no code yet.

## 1. Goal
One «Studio» section where a user picks a modality (Rasm / Video / Ovoz), then a **model** from several well-known
providers, sets the model's own parameters (or starts from a **template** / a **prompt from the library**), sees the
price **before** generating, and pays per job from the wallet. Results land in a gallery where they can be compared,
remixed (same prompt, other model) and reused (image → video, text → voice).

## 2. What exists today (the base we extend)
| Piece | File | Today |
|---|---|---|
| Image model registry | `lib/generation/image-models.ts` | `IMAGE_MODELS` = Gemini (Nano Banana) + OpenAI gpt-image; price ladder per model |
| Image engine | `lib/generation/image-studio.ts`, `image-provider-*.ts` | Gemini live; OpenAI adapter (no key) |
| Video registry | `lib/generation/video/registry.ts` | Gemini Omni Flash live; Kling adapter (key in DB, switched off, model `kling-v2-master`) |
| Voice | `lib/generation/tts/*` | Gemini TTS live; Azure, Aisha, ElevenLabs adapters + fallback chain |
| Provider keys / switches | `lib/server/providers/{registry,catalog,store}.ts`, admin «Provayderlar» | per provider key + on/off |
| Model routing | `ai_routes` (migration 062), admin slots | per-route model order |
| Pricing | `lib/tools.ts priceFor`, `tool_pricing`, admin «Narxlar» | server-side price, charge + enqueue in one tx, partial refund |
| Jobs | Postgres queue + worker | async, polling, `cost_json` + `ai_usage` telemetry |

So the Studio is mostly **generalising what `rasm` already does** (model choice → availability → price → adapter) to
many models and three modalities, plus a much richer UI.

## 3. Market — models worth offering (Nov 2026, prices are approximate, to be re-checked on each provider's page)
### Images
| Model | Strength | ≈ cost / image | Access |
|---|---|---|---|
| Google Nano Banana (Gemini 3.1 Flash Image / Lite) | fast, edits, cheap | $0.034 (Lite) / $0.067 | direct (live) |
| OpenAI GPT Image 2.x | best instruction following, text in images | $0.03–0.20 by quality | direct |
| FLUX.2 (Black Forest Labs) | photorealism | ~$0.03 / MP | fal / Replicate / BFL |
| Seedream 4.5 / 5 (ByteDance) | cheap, good text, editing | ~$0.03–0.04 | fal / WaveSpeed |
| Ideogram 3 | posters, typography | ~$0.03–0.05 | Ideogram / fal |
| Recraft V3 | design, logos, **vector SVG** | $0.04 raster / $0.08 vector | Recraft / fal |
| Midjourney | — | no official API → **not offered** | — |

### Video
| Model | Strength | ≈ cost | Access |
|---|---|---|---|
| Google Gemini Omni Flash (ex-Veo) | native audio, quality | ~$0.10 / s | direct (live) |
| Veo 3.1 Lite | cheap Google tier | ~$0.05 / s | Google / fal |
| Kling 3.0 / Omni | value, character consistency, **effect templates**, camera control, 4K | ~$0.08–0.17 / s; effects ~$0.84 each | direct (key exists) / fal |
| Seedance 2.0 (ByteDance) | cheap fast tier + pro tier | $0.09 / s (fast) – $0.25 / s (pro) | fal / WaveSpeed |
| Hailuo 2.3 (MiniMax) | motion, physics | $0.28 / 6 s (768p), $0.49 (1080p) | fal / MiniMax |
| Wan 2.5 (Alibaba) | cheapest | ~$0.05 / s (480p) | fal / WaveSpeed |
| Runway Gen-4.5 | editing-led | (no reliable API price found) | Runway |
| OpenAI Sora 2 | cinematic realism | ~$0.15 / s (unverified) | OpenAI |

### Voice / audio
| Model | Uzbek | ≈ cost | Access |
|---|---|---|---|
| Gemini TTS | yes | ~$0.015 / min | direct (live) |
| ElevenLabs Eleven v3 | **yes** (only v3) | $0.08 / 1k chars ≈ $0.07 / min | direct (adapter exists) |
| Azure Neural (uz-UZ voices) | yes | ~$16 / 1M chars | direct (adapter exists) |
| Aisha (Uzbek-native) | yes | ~1 so'm / char | direct (adapter exists) |
| ElevenLabs Music | instrumental/songs | ~$0.30 / min | direct |
| Suno | — | no public self-serve API → not offered | — |

## 4. Integration strategy (recommended: **hybrid**)
- **Direct** for the providers we already use or that matter most for quality/price/Uzbek: Google (Gemini image,
  Omni video, TTS), OpenAI (GPT Image), ElevenLabs, Kling.
- **One aggregator** (recommended **fal.ai**; alternatives Replicate / WaveSpeed) for the long tail: FLUX.2, Seedream,
  Ideogram, Recraft, Seedance, Hailuo, Wan, Veo Lite… One key, one async API shape (submit → poll/webhook → file URL),
  per-model price published → adding a model = one catalog entry + its parameter schema, no new adapter.
- The aggregator is prepaid: the owner tops it up like Gemini. The fal adapter was removed on 2026-10-31 (credit ran
  out); it comes back as **one generic adapter** for all fal models, not per-model code.

## 5. Architecture
1. **Studio model catalog** (`lib/studio/catalog.ts`, client-safe, the ONE source like `image-models.ts`):
   `{ id, modality, provider, upstreamModel, label, badges (speed/quality/new), params: ParamSchema[],
   cost: CostRule, capabilities (t2i, i2i, edit, t2v, i2v, effects, audio, voices…), limits }`.
   `ParamSchema` drives the form (aspect ratio, count, duration, resolution, style, seed, negative prompt,
   reference images, voice, speed…) — the «every param must work» rule applies: each param has a differential probe test.
2. **Pricing** = provider cost rule (per image / per second / per 1k chars / per effect) × admin markup → so'm,
   computed ONLY by `priceFor` on the server; shown live in the form; charged + enqueued in one transaction; failed
   jobs refunded, partial delivery refunded proportionally (existing `refundPartial`). Admin «Narxlar» gets a
   per-model row (cost, price, margin) — fits the admin-pricing plan.
3. **Availability** = provider enabled + key present + model enabled (admin can hide any model) → session sends the
   list; the route re-checks before charging (same pattern as `imageModelsAvailable`).
4. **Adapters**: existing direct adapters + one `fal` adapter (generic: model id + input JSON → result URLs). Outputs
   are downloaded to our storage (never hot-link provider URLs), size/type checked.
5. **Jobs**: the existing queue/worker; video/long jobs poll the provider; progress panel already exists.
6. **Templates & prompt library** (DB tables + admin editor): template = model + preset params + prompt skeleton with
   slots («{ism} uchun tug'ilgan kun tabrigi, {uslub}») + preview image/video; library = curated prompts by category
   (portret, mahsulot, logo, poster, tabriknoma, ta'lim, reklama…), Uzbek UI, prompt auto-translated to English for
   models that need it (one cheap LLM call, shown to the user).
7. **Gallery**: per-user history with filters, «Shu promptni boshqa modelda», «Videoga aylantirish» (image → i2v),
   «Ovoz qo'shish», download, share; optional **compare mode** (same prompt → 2–4 models side by side, sum of prices
   shown upfront).
8. **Safety**: provider moderation + our own prompt filter; **no face-swap / lip-sync / voice cloning of real people
   without consent** (start without voice cloning and face-swap); watermark/metadata note «AI»; abuse rate limits;
   uploads scanned for type/size.

## 6. UX outline
`Studio` entry in the bottom tabs (or the Media group) → three tabs **Rasm · Video · Ovoz**:
- Top: prompt box + «Namuna promptlar» + «Shablonlar» chips; reference upload (image/video/audio where supported).
- Model picker: cards with logo, badges («Tez», «Sifatli», «Arzon», «Matnni yaxshi yozadi», «Ovozli video»), price
  per unit; «Hammasini solishtirish» link.
- Parameters panel generated from the model's `ParamSchema` (collapsed «Qo'shimcha sozlamalar»).
- Sticky footer: **«Yaratish — 12 000 so'm»** (price updates live).
- Result: progress panel → result card with actions (download, remix, to video, compare).
Phone-first (sheet/tiles like the new top-up dialog), dark mode.

## 7. Phases (one item at a time, each: code → tests + mutations → review → CI → deploy → owner check)
| Phase | Scope | Money needed |
|---|---|---|
| **S0** | Catalog + ParamSchema + pricing engine + Studio shell (Rasm tab) with today's 2 image models; admin per-model price/enable | none |
| **S1** | fal adapter + 4–6 image models (FLUX.2, Seedream, Ideogram, Recraft…) + image templates & prompt library + gallery | fal top-up (~$20–50 to start) |
| **S2** | Video tab: Omni (live) + Kling 3.0 (switch model off `v2-master`) + Kling **effect templates** + 2–3 fal video models (Seedance fast, Hailuo, Wan); image → video | Kling trial ($9.80/$98) + fal |
| **S3** | Ovoz tab: Gemini TTS (live) + ElevenLabs v3 (Uzbek) + Azure/Aisha; voice picker with previews; music (ElevenLabs) optional | ElevenLabs plan ($6–22/mo) |
| **S4** | Compare mode, remix chains, favourites, public showcase of best results (opt-in) | — |

## 8. Risks
- Provider prices change often → cost rules live in the catalog/DB, admin can update; margin alerts already exist.
- Prepaid balances run out (fal happened) → balance monitor + bot alert; unavailable models disappear automatically.
- Long/expensive video jobs → per-user concurrency + daily caps; price shown before start; refund on failure.
- Content safety / likeness → §5.8.
- Scope: S0–S3 is several weeks of work; ship per phase.

## 9. Decisions needed from the owner
1. Integration: hybrid with **fal.ai** as the aggregator (recommended) / direct only / another aggregator.
2. Start budget for paid providers (fal, Kling, ElevenLabs).
3. Markup rule: one global markup (e.g. ×2.5 of cost) or a price per model set by hand.
4. Placement: new «Studio» tab vs inside «Media»; keep the old Rasm/Video/Podkast tools or fold them into Studio.
5. Safety: no face-swap / voice cloning at launch (recommended) — agree?
6. Which phase first (recommended S0 → S1).

## 10. Owner decisions (2026-11-01)
1. Integration: **hybrid** — direct for the main providers + one aggregator; first shortlist the trending models (§11)
   and check how good fal.ai is (§12).
2. Pricing: **cost × one global markup**, admin can override any model on «Narxlar».
3. Placement: **new «Studio» section**; the old Rasm / Video / Podkast / Tabriknoma tools move into it (as templates).
4. Safety: **everything open** (incl. face-swap / voice cloning where a provider allows it). We still keep provider
   moderation, a ToS line + «I have the right to use this face/voice» checkbox on likeness features, and an abuse
   rate limit (owner informed of the legal risk).

## 11. Shortlist — trending models (leaderboards Sep–Nov 2026; re-check before each phase)
Source of truth: Artificial Analysis arenas (text-to-image v2.1, text-to-video v2.x, speech arena), cross-checked.

**Image** (T2I + editing)
| Rank-ish | Model | Why | Route |
|---|---|---|---|
| 1–3 | OpenAI GPT Image 2.5 (Sunburst / Flare), GPT Image 2 | #1–#3 Elo, instruction following, text | direct (adapter exists, needs key) |
| 4 | Google Nano Banana 2.1 (Gemini 3.1 Flash Image) | top-5, fast, edits | direct (live, Lite tier today) |
| — | Reve 2.1 | #2 in an earlier snapshot | aggregator |
| open | FLUX 3 / FLUX.2, Qwen-Image 2.1, Seedream 4.5/5 | best open / cheap | aggregator |
| niche | Ideogram 3 (typography), Recraft V3 (vector/logo) | posters, logos, SVG | aggregator / direct |

**Video**
| Rank-ish | Model | Why | Route |
|---|---|---|---|
| 1 (with audio) | Google Gemini Omni Flash | #1 with-audio arena (Sep) | direct (live) |
| 1 (silent board) | Wan 3.0 (Alibaba) | #1 on AA-Video-T2V v2 | aggregator |
| 2–3 | Seedance 2.5 (ByteDance), MiniMax H3 (Hailuo) | top-3, good prices | aggregator |
| — | Kling 3.0 / Omni | value, consistency, **effect templates**, 4K | direct (key exists) |
| — | HeyGen Video 1 | avatars / talking heads | direct (later) |
| — | OpenAI Sora 2 | cinematic | direct (later) |

**Voice**
| Model | Why | Uzbek |
|---|---|---|
| Google Gemini 3.1 Flash TTS | #1–#3 speech arena | yes (live) |
| Cartesia Sonic 3.6 | #1 Sep snapshot | to verify |
| Alibaba Fun / Qwen TTS | top-3 | to verify |
| ElevenLabs Eleven v3 | rank ~11, best voice library + cloning | yes |
| Azure uz-UZ, Aisha | Uzbek-native fallbacks | yes |
| ElevenLabs Music | the only music model with a public API | n/a |

## 12. fal.ai — assessment
- **+** Largest media catalogue behind one key and one async API; new models usually available on launch day;
  pay-per-use, per-model public prices; good for Wan / Seedance / Hailuo / FLUX / Reve / Ideogram / Recraft.
- **−** Independent probes show **~97–98 % 90-day uptime** (vendor claims 99.99 %); no SLA on pay-as-you-go;
  prepaid balance can run out (happened to us in 2026-09).
- **Mitigation**: every model in the catalogue may list **2 routes** (e.g. fal → WaveSpeed or → direct); the router
  falls back on 5xx/timeout before charging fails; balance monitor + bot alert; unavailable models auto-hide.
- Alternatives: **Replicate** (broadest catalogue, slower cold starts), **WaveSpeed** (ByteDance / Alibaba / Kuaishou
  models — Seedream, Wan, Kling — often cheaper). Recommendation: fal primary, WaveSpeed as the second route for the
  ByteDance/Alibaba models.
