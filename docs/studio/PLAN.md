# SlaydX Studio — AI image / video / voice studio (plan, 2026-11-01)

Status: **plan approved** (owner 2026-11-01, §10, §13, §21); P0 spec `P0-SPEC.md` awaits «ok»; no code yet.

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

## 13. Owner decisions — round 2 (2026-11-01)
- **Image: all shortlisted models** (GPT Image 2.5, Nano Banana, FLUX, Seedream, Reve, Ideogram, Recraft).
- **Video: all shortlisted models** (Gemini Omni, Kling 3.0 + effect templates, Wan 3.0, Seedance 2.5, Hailuo/MiniMax,
  Sora 2, HeyGen) — rolled out in waves, the catalogue makes each model one entry + its ParamSchema.
- **Voice**: Gemini TTS (live) + **ElevenLabs v3 with voice cloning** + **ElevenLabs Music**. (Azure/Aisha stay as
  silent fallbacks only.)
- **Markup: ×2 of provider cost for now** (cost 100 → price 200), one global setting, per-model override possible.
  Note: ×2 must also cover failed-job cost, payment fees and the payment bonus — the admin margin page watches it.
- **Screens to design**: phone (site), Telegram Mini App, tablet, desktop.
- Owner: **do not start coding** until providers and designs are agreed.

## 14. Reusable core (owner 2026-11-01: «quality mechanism for each, easy to reuse in other projects and other parts»)
The Studio is built as a **provider-agnostic core with thin adapters**, not as SlaydX screens:
- `lib/studio-core/` (no SlaydX imports; could become a package later): `catalog` (model entries + ParamSchema +
  CostRule + capabilities), `router` (route list per model, fallback on 5xx/timeout, health), `adapters/` (google,
  openai, elevenlabs, kling, fal, wavespeed — one interface: `submit(input) → jobRef`, `poll(jobRef)`, `fetchOutputs`),
  `pricing` (cost → price with a markup function injected by the host), `moderation` hooks, `telemetry` (cost per call).
- The **host** (SlaydX) plugs in: wallet charge/refund, queue/worker, storage, settings, admin pages, UI.
- Every existing SlaydX feature that makes media moves onto the core over time (slide/pro-slide images, «Rasm»,
  infographic, podcast/greeting TTS, listening audio, video) — one catalog, one price rule, one telemetry.
- Quality bar per adapter: contract tests against recorded provider responses, a live smoke script per model
  (`npm run studio-live -- <model>`), output validation (type, size, duration, dimensions), mutation-tested pricing.

## 15. Phased roadmap (each phase ships a usable increment; later phases only ADD)
| # | Phase | User-visible result | Builds on |
|---|---|---|---|
| **P0** | Core + catalog + pricing + router (no new UI) | nothing visible; old Rasm/Video/TTS now run through the core (same behaviour, same prices) | — |
| **P1** | Studio shell + **Rasm** tab: Nano Banana + GPT Image 2.5, model picker, ParamSchema form, live price, gallery | Studio section with 2 image models | P0 |
| **P2** | fal adapter + FLUX / Seedream / Reve / Ideogram / Recraft; prompt library + image templates | 7 image models, templates, «Namuna promptlar» | P1 |
| **P3** | **Video** tab: Gemini Omni + Kling 3.0 (+ effect templates) | video with templates | P1 |
| **P4** | More video: Wan 3.0, Seedance 2.5, Hailuo/MiniMax (fal/WaveSpeed routes), image → video | 6+ video models | P2, P3 |
| **P5** | **Ovoz** tab: Gemini TTS + ElevenLabs v3 + voice cloning; voice library with previews | Uzbek voices, own voice | P1 |
| **P6** | **Musiqa**: ElevenLabs Music; voice + background music mixing | songs / jingles | P5 |
| **P7** | Compare mode (2–4 models), remix chains (image → video → voice-over), favourites | desktop power features | P2–P5 |
| **P8** | Old tools fold into Studio as templates (Rasm, Video, Podkast, Tabriknoma); redirects | one place for media | P1–P6 |
| **P9** | Sora 2, HeyGen avatars, new models as they trend (catalog entries) | ongoing | P0 |

Each phase: plan check with the owner → code → tests + mutations → independent review → CI → deploy (dark switch)
→ owner device check (phone, Telegram, tablet, desktop) → switch on. A model is added by **one catalog entry + its
ParamSchema + a live smoke**, so new features keep landing without rewiring.

## 16. Design (draft v1, 2026-11-01)
Canvas: https://claude.ai/artifact/RKtqPUxeyEnV5F5dJJ7m1A — phone (Rasm tab), phone model picker sheet, Telegram
Mini App (Video + effect templates, dark), tablet (Ovoz: TTS / cloning / music), desktop (3 columns + compare).
Prices on the mock-ups = cost × 2 at ~12 800 so'm/$, rounded; placeholders, not final.

## 17. Provider capability matrix (owner 2026-11-01: «integrate the main features of ElevenLabs and the other services»)
Each row becomes catalog entries (one per capability × model). ✓ = planned, phase in brackets. «verify» = confirm on
the provider's docs/console before that phase (language lists and prices change).

### ElevenLabs
| Capability | What the user gets | Phase |
|---|---|---|
| Text to Speech (Eleven v3; Flash/Turbo for non-Uzbek) | Uzbek narration, 18-language output | ✓ P5 |
| Text to Dialogue | multi-speaker scenes / podcasts in one call | ✓ P5 |
| Voice library + voice design (voice from a text description) | pick / invent a voice | ✓ P5 |
| Instant voice cloning (Professional cloning later) | «my own voice» | ✓ P5 |
| Voice changer (speech → speech) | re-voice a recording | ✓ P6 |
| Voice isolator | clean noisy recordings | ✓ P6 |
| Sound effects (≤30 s, 4 variants) | SFX / ambience for videos | ✓ P6 |
| Music (Eleven Music) | songs, jingles, background tracks | ✓ P6 |
| Speech to Text (Scribe v2) — Uzbek ✓ (`P10-SPEC.md`) | transcripts, subtitles | ✓ P10 |
| Dubbing (90+ languages) — Uzbek ✓ (`P10-SPEC.md`) | translate + re-voice a video | ✓ P10 |
| Agents (conversational) | out of Studio scope | — |

### Google (direct)
| Capability | Phase |
|---|---|
| Nano Banana: text → image, **edit with a prompt**, multi-image fusion | ✓ P1 (gen), P2 (edit/fusion) |
| Gemini Omni: text → video, **image → video**, native audio | ✓ P3 |
| Gemini TTS: Uzbek voices, **multi-speaker** | ✓ P5 |
| Lyria (music) — verify API availability | P9 |

### OpenAI (direct)
| Capability | Phase |
|---|---|
| GPT Image 2.5: generate, **edit / inpaint with mask**, reference images, transparent background | ✓ P1 (gen), P2 (edit) |
| Sora 2: text/image → video | ✓ P9 |

### Kling (direct, key exists)
| Capability | Phase |
|---|---|
| Text → video, image → video (3.0 / Omni, 3–15 s, up to 4K, native audio) | ✓ P3 |
| **Effect templates** (one photo → ready scene) | ✓ P3 |
| Start/end frame, camera / motion control (motion from a reference video) | ✓ P4 |
| Video extend (+~4.5 s, chainable), multi-shot | ✓ P4 |
| Lip-sync (talking photo / dub a clip) | ✓ P4 |
| Virtual try-on (garment on a model photo) | ✓ P4 |
| Elements (reusable character / object across videos) | ✓ P7 |

### Aggregator models (fal primary, WaveSpeed second route)
| Capability | Phase |
|---|---|
| FLUX, Seedream, Reve: generate + edit | ✓ P2 |
| Ideogram: typography posters, remix | ✓ P2 |
| Recraft: vector SVG, logos, **vectorize** an image | ✓ P2 |
| Wan 3.0, Seedance 2.5, Hailuo/MiniMax: t2v, i2v | ✓ P4 |
| **Utility tools**: upscale ×2/×4, background removal, face restore, relight | ✓ P2 (image), P4 (video upscale) |
| HeyGen avatars | ✓ P9 |

### Cross-provider «chains» (P7)
image → upscale → video → voice-over (ElevenLabs/Gemini) → music + SFX → subtitles (Scribe) — each step is a normal
catalog job, the chain is a saved recipe the user can re-run with another model at any step.

### Roadmap delta
P2 gains image editing + utility tools; P4 gains Kling motion/extend/lip-sync/try-on; P5 gains dialogue + voice
design; P6 becomes «Audio»: music + sound effects + voice changer + isolator; **P10 (new)**: transcription and
dubbing (after the Uzbek check).

## 18. Media engine as a platform service (owner 2026-11-01)
The core (§14) is **the one place every SlaydX feature calls** to make an image, a video or audio — Studio is only
its biggest client. Contract for a caller (slides, coursework, greeting, podcast, infographic, bot…):
- `media.request({ kind: "image"|"video"|"speech"|"music"|"sfx", purpose, input, modelId? , params? })` → job.
- **`purpose`** (e.g. `slide.illustration`, `greeting.card`, `podcast.voice`) has an **admin-set default model** and
  an allowed list; the caller never hard-codes a provider.
- **Embeddable model picker** (`<MediaModelPicker purpose=… />`, one React component): shows the default model,
  lets the user switch to a cheaper / better one inside ANY form, price updates live (`priceFor` = catalog cost × markup).
- Same job record, wallet charge/refund, telemetry, moderation and storage for every caller → one place to fix,
  measure and price. Existing engines migrate in P0/P8.

## 19. Scale target: ~100 000 users (design now, build in steps)
**Today (measured 2026-11-01):** 11 505 users, DB 5.7 GB, one shared box (4 vCPU, 7 GB RAM), files on the local disk
(`STORAGE_DIR`), **disk 81 % full (77 / 96 GB)**, Postgres queue with `FOR UPDATE SKIP LOCKED`, `WORKER_CONCURRENCY=2`.

**Load model for 100k users:** ~10 % daily active → ~10k/day; peak ~5–10 % of those at once → 500–1 000 concurrent
sessions; media jobs mostly WAIT on providers (I/O-bound), so throughput is limited by provider rate limits, money and
storage, not CPU. Video is the heavy part: 10k videos/day × ~10 MB ≈ **100 GB/day**.

**Design decisions (built into P0–P1, not retrofitted):**
1. **Object storage + CDN** for all generated media (S3-compatible, e.g. Cloudflare R2 — no egress fees), signed URLs,
   lifecycle rules (e.g. originals kept N days for free users); never on the app disk. Existing files migrate.
2. **Async everywhere**: provider **webhooks** where offered (fal, Kling, ElevenLabs async), polling only as fallback;
   a media worker holds hundreds of in-flight jobs with async I/O instead of 2 blocking slots.
3. **Separate media workers** from document workers (their own containers / machines), scaled horizontally.
4. **Per-provider concurrency + rate limits** (token buckets), **circuit breaker** and **fallback route** (§12);
   back-pressure: honest queue position + ETA, reject before charging when over capacity (extends today's queue limits).
5. **Idempotency keys** on every request and provider submit; exactly-once charge, refund on failure (existing ledger).
6. **Queue**: Postgres `SKIP LOCKED` with partitioned / indexed job tables is fine to a few hundred jobs/s; the queue
   sits behind an interface so it can move to Redis/BullMQ-style or a managed queue without touching callers.
7. **Per-user and global caps**: jobs in flight per user, daily spend caps, abuse limits; prepaid **provider balance
   monitors** with bot alerts and auto-hide of models whose balance is low.
8. **Observability**: per provider/model latency, error rate, cost, queue depth dashboards + alerts (extends «Yuklama
   tarixi»).
9. **Infrastructure step-up** (owner decision, money): move SlaydX off the shared 7 GB box → dedicated app server(s)
   + managed Postgres (or a DB box with replicas) + object storage/CDN; load test (k6) at 2× target before launch.

**Immediate risk:** disk at 81 % — before any video-heavy phase, object storage must land (P0) or the disk fills.

## 20. Owner decision — server (2026-11-01)
**Contabo Cloud VPS 6** (6 vCPU, 12 GB RAM, 200 GB SSD / 100 GB NVMe, $8.06/mo for 24 months), **SlaydX only**; the
old shared box keeps the other projects. Fits today's 11.5k users and early growth **only if** media goes to object
storage (R2/CDN) and document workers stay ≤ 2–3 LibreOffice processes. Upgrade path: VPS 8/12 (same provider,
in-place) when the load-history page shows sustained CPU > 70 % or RAM > 80 %; DB moves to its own box at ~50k DAU.
Still open: provider budgets (fal, Kling, ElevenLabs), design feedback, phase order confirmation.

## 21. Owner decisions — round 3 (2026-11-01)
- **Budgets: minimal start**, topped up when the phase starts, not before: fal.ai $20 (P2), Kling trial $9.80 (P3),
  ElevenLabs Starter $6/mo (P5).
- **Design canvas approved as is**; small adjustments during the P1 browser smoke.
- **Phase order confirmed**: P0 → P1 → P2 → P3 → P5 → P4 → P6 → P7 → P8 → P9 → P10.
- **Infra**: the owner creates the Cloudflare account + R2 bucket and writes the keys into the server `.env`; the new
  server is bought **within 3–4 days**, then SlaydX moves to it (cutover runbook first, window agreed then).
- **Scale target raised: at least 50 000 active users** (not 100k registered). §19's numbers are superseded by
  `P0-SPEC.md` §0 (≈5× more load; DB box becomes the first upgrade, earlier than §20 assumed).
- Next: `docs/studio/P0-SPEC.md` → owner «ok» → build P0 on `feat/studio-p0`.
