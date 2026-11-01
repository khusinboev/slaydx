# Studio P0 — media engine core: technical spec (2026-11-01)

Status: **draft for the owner's «ok»**. Parent plan: `docs/studio/PLAN.md` (§14 core, §17 capabilities, §18 platform
service, §19 scale, §21 decisions of 2026-11-01). P0 ships **no user-visible change**: today's «Rasm», pro-slide /
slide illustrations, graduation portrait, «Video», podcast / greeting / domla voice run through the core with the same
requests, the same prices and the same refunds. Every later phase only ADDS catalog entries, adapters and UI.

## 0. Scale target (owner 2026-11-01: «at least 50k active»)
Design point: **50 000 daily active users** (not 100k registered with 10 % active, as §19 assumed: ~5× more load).

| Quantity | Estimate | Consequence |
|---|---|---|
| Media jobs / day | 20–30 % of DAU make one → 10–15k images, 2–5k videos, 3–5k audio | job table grows ~25k rows/day → monthly partitions or an `(status, next_poll_at)` partial index + 90-day archive |
| Peak rate | ~60 % of traffic in 8 h, 3× burst → **3–5 jobs/s** submitted | Postgres `SKIP LOCKED` is fine (limit is hundreds/s) |
| In flight at peak | videos: up to ~30 new/min × ~3 min ≈ 90 ops; images/speech: ~3 calls/s × 20–40 s ≈ 100 → **200–300 provider calls at once** | jobs must not hold a worker slot while the provider works: submit → park → poll/webhook (today's `video_ops` shape, generalised) |
| New media / day | 2–5k videos × 10 MB + 15k images × 1.5 MB ≈ **40–75 GB/day** | **object storage is mandatory**; the DB and the app disk can't hold it (prod disk is 81 % full) |
| Concurrent sessions | 2 500–5 000 | web is stateless already; scale by replicas behind nginx |

**Server note (owner buying it in the next 3–4 days):** VPS 6 (6 vCPU / 12 GB) is enough for the app + workers at this
level **only** with media in R2 and the DB on the same box kept small (no file bytes in Postgres, see §5). Postgres
with 50k DAU wants its own RAM: plan the DB box (or a bigger plan of the same provider) as the first upgrade, earlier
than the «~50k DAU» line in §20 because that line is now the starting point. Not a P0 blocker.

## 1. Scope
**In P0**
1. `lib/studio-core/` — provider-agnostic core, zero SlaydX imports (enforced by a test).
2. Catalog entries for every model in use today (§3.6) + purposes (§3.7) with their current defaults.
3. Pricing through the core with today's prices kept by per-model **legacy overrides** (golden test proves equality).
4. Router: route list per model, circuit breaker, fallback before a provider accepted the job, per-provider limiter.
5. `media_jobs` table: one row per provider operation of every media call (sync and async); video moves onto it.
6. `MediaStore` interface + the Postgres (today's) implementation; the R2 implementation is the infra track (§7) and
   plugs into the same interface.
7. Host bindings `lib/server/media/` (wallet, settings, keys, storage, telemetry, worker loop).
8. Dark switch per kind so the old path stays one setting away until the new one has run a week in prod.

**Build notes (2026-11-01):** SlaydX adapters live in the host (`lib/media/adapters/`), so the core purity rule has
no exceptions; `lib/server/media/run.ts runMedia` is the shared sync call; migration 065 creates only `media_jobs` —
overrides, purpose defaults and provider balances land with the phase that reads them (P1), and `media.markup` with
the admin page that edits it. The circuit breaker and Semaphore moved into the core (the LLM layer re-exports them).
Router rule added: the last usable route is never skipped on health. The CostRule `megapixel` shape is not needed yet.

**Not in P0:** new models, the Studio UI, the model picker, webhooks (interface only; the first provider that uses
them, fal in P2, lands its route), templates, gallery, R2 (infra track I2).

## 2. Module layout
```
lib/studio-core/                 isomorphic where marked (client), no "server-only", no imports outside this folder
  types.ts          (client)     Kind, Capability, MediaInput/Output, Money, errors
  params.ts         (client)     ParamSchema, normalize(), validate(), encode() — the form and the server read ONE schema
  cost.ts           (client)     CostRule → USD for a given normalized input
  pricing.ts        (client)     price(costUsd, ctx) with injected markup / rate / rounding / override
  catalog.ts        (client)     defineCatalog(entries) → lookup, list by kind/capability, client-safe view
  purposes.ts       (client)     PurposeSpec { id, kind, allowed, default } + resolve()
  router.ts                      Route, RouterState, pickRoute(), fallback policy
  breaker.ts                     circuit breaker (same semantics as lib/generation/llm/breaker.ts, own copy)
  limiter.ts                     per-provider semaphore + token bucket
  adapter.ts                     MediaAdapter interface, AdapterDeps (fetch, clock, key, signal)
  storage.ts                     MediaStore interface + content checks (sniffed mime, size, sha256)
  engine.ts                      run(): validate → route → submit → (sync result | parked op) → fetch → validate output
  testing/                       recorded-response fetch stub, fake store, fake clock (used by host and core tests)
lib/studio-core/adapters/        thin wrappers; P0 wraps the EXISTING request builders, no rewrite
  google-image.ts   → lib/generation/image-provider-gemini.ts requestGeminiImage
  openai-image.ts   → image-provider-openai.ts requestOpenaiImage
  google-video.ts   → video/omni.ts
  kling-video.ts    → video/kling.ts
  gemini-speech.ts / elevenlabs-speech.ts / azure-speech.ts / aisha-speech.ts → tts/*
lib/server/media/                host (SlaydX) bindings, "server-only"
  engine.ts         mediaRequest() — the ONE entry for every SlaydX caller
  jobs.ts           media_jobs DAO (claim, park, poll due, finish), idempotency
  store-pg.ts       MediaStore over generation_files (today's bytes)
  host-pricing.ts   markup from app_settings, USD rate, rounding, tool_pricing % on top
  availability.ts   provider enabled + key (providers/store.ts) + model enabled (overrides) + breaker
  balances.ts       provider_balances reader/writer (prepaid providers), low-balance alert hook
  poll-loop.ts      generalises video-poll-loop.ts over media_jobs
```
Why the adapters wrap instead of moving code in P0: the request bodies are pinned by today's probe tests
(`image-params`, `video-params`, `audio-params`, `image-provider-openai`); wrapping keeps them byte-identical. The code
physically moves into `studio-core/adapters/` in P1 when its own contract tests already hold. P0 adapters may therefore
import from `lib/generation/*` — the purity test allows exactly `lib/studio-core/adapters/*.ts → lib/generation/{image-provider-*,video,tts}/**` and nothing else.

## 3. Core interfaces
### 3.1 Kinds and capabilities
```ts
export type MediaKind = "image" | "video" | "speech" | "music" | "sfx";
export type Capability =
  | "t2i" | "i2i" | "edit" | "inpaint" | "upscale" | "bg-remove" | "vectorize"
  | "t2v" | "i2v" | "effect" | "extend" | "lipsync"
  | "tts" | "dialogue" | "clone" | "voice-design" | "music" | "sfx" | "stt";
```
### 3.2 ParamSchema
```ts
type ParamBase = { name: string; label: string /* Uzbek */; hint?: string; advanced?: boolean;
                   /** request field it maps to; the differential probe asserts each param changes the request or the price */
                   affects: "request" | "price" | "both" };
export type ParamSchema =
  | ParamBase & { type: "enum"; options: { value: string; label: string }[]; default: string }
  | ParamBase & { type: "int"; min: number; max: number; step?: number; default: number }
  | ParamBase & { type: "number"; min: number; max: number; default: number }
  | ParamBase & { type: "bool"; default: boolean }
  | ParamBase & { type: "text"; min: number; max: number; default?: string }
  | ParamBase & { type: "image"; max: number; mimes: string[]; maxBytes: number }   // asset ids, ownership checked by host
  | ParamBase & { type: "voice"; source: "catalog" | "user-clones" };
export function normalize(schema: readonly ParamSchema[], raw: Record<string, unknown>): NormalizedParams;  // never throws
export function validate(schema: readonly ParamSchema[], raw: Record<string, unknown>): string | null;      // Uzbek message, before charging
```
Rule kept from today (`imageModelError`, `videoParamsError`): an unknown value is **rejected**, never silently mapped.
### 3.3 CostRule (provider cost in USD, from the provider's price page)
```ts
export type CostRule =
  | { per: "job"; usd: number }
  | { per: "output"; usd: number; by?: { param: string; table: Record<string, number> } }  // per image; by quality/size
  | { per: "second"; usd: number; by?: { param: string; table: Record<string, number> } }  // video, music
  | { per: "kchar"; usd: number }                                                        // speech
  | { per: "megapixel"; usd: number };
export function costUsd(rule: CostRule, p: NormalizedParams): number;
```
`llm-pricing.ts IMAGE_PRICES` and the TTS meter stay the telemetry source for actual spend; the CostRule is the quote.
A test asserts they agree for every catalog model that both know (no silent drift).
### 3.4 Pricing (host-injected)
```ts
export type PriceCtx = {
  soumPerUsd: number;            // finance.soum_per_usd
  markup: number;                // media.markup, default 2 (owner decision)
  round: (soum: number) => number;      // host rounding (to 100 so'm)
  override?: PriceOverride;      // per-model admin override
};
export type PriceOverride =
  | { mode: "markup"; markup: number }
  | { mode: "fixed"; soum: (p: NormalizedParams) => number };  // legacy ladders (P0)
export function price(entry: CatalogEntry, p: NormalizedParams, ctx: PriceCtx): number; // integer so'm, ≥ 1
```
Order: override.fixed → else `round(costUsd × soumPerUsd × (override.markup ?? markup))`. The host then applies the
existing `tool_pricing` percentage of the calling tool exactly as `effectivePrice` does today (so «Narxlar» keeps
working). Pricing is the money path: every branch is a mutation target (§8).
### 3.5 Catalog entry
```ts
export type CatalogEntry = {
  id: string;                      // stable public id, e.g. "google/nano-banana-lite"
  kind: MediaKind;
  capabilities: readonly Capability[];
  label: string; maker: string; badges: readonly ("tez"|"sifatli"|"arzon"|"matn"|"ovozli"|"yangi")[];
  params: readonly ParamSchema[];
  cost: CostRule;
  routes: readonly Route[];        // ordered: primary first
  limits: { maxOutputs?: number; maxSeconds?: number; maxChars?: number; timeoutMs: number; deadlineMs?: number };
  output: { mimes: readonly string[]; maxBytes: number };
};
export type Route = { provider: string /* registry id */; upstreamModel: string; adapter: string };
```
`catalog.clientView()` strips `routes`/`upstreamModel` and anything the browser must not see.
### 3.6 P0 catalog (exactly today's models, nothing new)
| id | kind | route (provider : upstream) | price in P0 |
|---|---|---|---|
| `google/nano-banana` | image | gemini : `image.gemini` slot (default lite) | fixed: 2 000 / 3 500 / 6 000 by count |
| `openai/gpt-image` | image | openai-image : `gpt-image-2.5-flare` | fixed: 4 000 / 7 000 / 12 000 |
| `google/omni-video` | video | veo : Omni Flash | fixed: 3 000 so'm/s |
| `kling/video` | video | kling : `kling-v2-master` | fixed: 2 000 so'm/s |
| `google/tts` | speech | gemini : `TTS_GEMINI_MODEL` | inside the tool price (podcast/greeting/domla) |
| `elevenlabs/tts` | speech | elevenlabs | «Premium ovoz» surcharge as today |
| `azure/tts`, `aisha/tts` | speech | azure / aisha | fallbacks, inside the tool price |
Speech used by documents is priced by the tool (podcast per minute etc.), not per call: those entries carry a CostRule
for telemetry and margin only; their callers keep their tool price.
### 3.7 Purposes
```ts
export type PurposeSpec = { id: string; kind: MediaKind; allowed: readonly string[] /* catalog ids */; default: string;
                            userCanChoose: boolean };
```
P0 purposes and defaults (= today): `rasm.image` (nano-banana; allowed nano-banana, gpt-image; user chooses),
`slide.illustration` and `proslide.illustration` (nano-banana), `portrait.edit` (nano-banana edit), `video.clip`
(omni; allowed omni, kling; user chooses), `podcast.voice`, `greeting.voice`, `domla.voice`, `listening.voice`
(speech chain = `tts.order` slot). Stock search (Pexels/Pixabay) is search, not generation: it stays outside the core.
The admin `image.gemini` and `tts.order` routing slots stay authoritative in P0 — the purpose resolver reads them
through `route-effective.ts` (one precedence rule, no second source).
### 3.8 Adapter
```ts
export interface MediaAdapter {
  id: string;
  configured(deps: AdapterDeps): boolean;
  /** Pure: what submit would send (probe + contract tests). No key inside. */
  buildRequest(input: AdapterInput): { url: string; headers: Record<string, string>; body: unknown };
  /** Sync providers return the outputs; async ones return an op id to park. idempotencyKey goes to providers that accept one. */
  submit(input: AdapterInput, deps: AdapterDeps): Promise<{ done: MediaOutput[] } | { opId: string }>;
  poll?(opId: string, deps: AdapterDeps): Promise<{ state: "running"; progress?: number } | { state: "done"; outputs: MediaOutput[] }
                                                  | { state: "failed"; message: string; safety: boolean }>;
  /** Webhook: verify signature + map body to a poll result (P2 onwards). */
  webhook?(headers: Headers, body: string, deps: AdapterDeps): Promise<{ opId: string; result: PollResult } | null>;
  fetchOutput(o: MediaOutput, deps: AdapterDeps): Promise<Uint8Array>;
}
export type MediaOutput = { kind: "inline"; bytes: Uint8Array; mime: string } | { kind: "url"; url: string; mime?: string };
export class MediaError extends Error { provider; status?; retryable: boolean; safety: boolean; accepted: boolean; }
```
Failure classes are today's (`ImageFailure`: no-key / blocked / rate / timeout / failed; video `retryable`/`safety`)
mapped onto `MediaError`; `accepted` = the provider already took the job (cost may be incurred).
### 3.9 Router
- `pickRoute(entry, state)`: first route whose provider is available (enabled, keyed, model enabled, breaker not open,
  balance not below its floor).
- Fallback to the next route **only** when `!err.accepted && err.retryable` (5xx, 429, timeout before accept, network).
  Never after the provider accepted (double cost, double output); a parked op that dies fails the job → refund.
- Breaker per `provider:upstreamModel`, opened by N consecutive retryable failures, half-open probe after a cool-down;
  state is per process in P0 (as `llm/breaker.ts`) and exported to the admin health block.
- Limiter per provider: max in-flight + requests/min token bucket (Gemini TTS ≈10 rpm already lives in a pg rate limit
  `tts:gemini:rpm`; the core takes a `RateGate` interface so the host keeps that pg implementation).
- P0 has one route per model, so fallback is exercised only in tests; P2 adds second routes (fal → WaveSpeed).
### 3.10 Storage
```ts
export interface MediaStore {
  put(o: { key: string; bytes: Uint8Array; mime: string; sha256: string }): Promise<StoredObject>;
  get(key: string, range?: { start: number; end?: number }): Promise<{ bytes: Uint8Array; size: number; mime: string } | null>;
  url?(key: string, ttlSec: number): Promise<string>;   // signed GET (R2); absent for pg
  delete(key: string): Promise<void>;
}
export function checkOutput(bytes: Uint8Array, spec: CatalogEntry["output"]): { mime: string; sha256: string } // sniffed, never trusted
```
Keys: `gen/<generationId>/<n>.<ext>`. Provider URLs are never shown to users (download → check → store).

## 4. Host contract (`lib/server/media/engine.ts`)
```ts
mediaRequest({ purpose, modelId?, params, generationId, userId, idempotencyKey }) →
  | { state: "done"; files: StoredObject[]; costUsd: number; delivered?: { got: number; want: number } }
  | { state: "parked"; mediaJobId: string }
```
- Validation + price happen in the route **before** charging (unchanged: `validate()` → `priceFor` → `chargeInTx` +
  enqueue in one tx). `modelId` outside `purpose.allowed` is a 400.
- Sync kinds (image, speech chunks) run inside today's worker job; video parks and the poll loop finishes it.
- Telemetry: every provider call writes `ai_usage` + the job's `cost_json` exactly as today (same `tool` labels), plus
  the `media_jobs` row.
- Refunds: unchanged functions (`refundPartial`, full refund on fail).

## 5. Tables (migration 065, additive, header + ROLLBACK block)
```sql
CREATE TABLE media_jobs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  generation_id   UUID REFERENCES generations(id) ON DELETE CASCADE,  -- caller job (NULL for previews / admin tests)
  user_id         UUID,
  purpose         TEXT NOT NULL,
  model_id        TEXT NOT NULL,            -- catalog id
  provider        TEXT NOT NULL,            -- route actually used
  upstream_model  TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,     -- <generationId>:<step>:<n>; a retry with the same key never submits twice
  op_id           TEXT,                     -- provider operation (async)
  status          TEXT NOT NULL CHECK (status IN ('submitting','pending','succeeded','failed')),
  attempts        INT NOT NULL DEFAULT 0, errors INT NOT NULL DEFAULT 0,
  next_poll_at    TIMESTAMPTZ, deadline_at TIMESTAMPTZ,
  params          JSONB NOT NULL,           -- normalized, no secrets, no image bytes (asset ids only)
  cost_usd        NUMERIC(12,6), price_soum INT,
  outputs         JSONB,                    -- [{key, mime, size, sha256}]
  last_error      TEXT,                     -- scrubbed (scrubSecrets)
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(), finished_at TIMESTAMPTZ
);
CREATE INDEX media_jobs_due_idx  ON media_jobs (next_poll_at) WHERE status = 'pending';
CREATE INDEX media_jobs_gen_idx  ON media_jobs (generation_id);
CREATE INDEX media_jobs_stat_idx ON media_jobs (provider, created_at);

CREATE TABLE media_model_overrides (          -- admin: hide a model, markup or fixed price per model (UI in P1)
  model_id TEXT PRIMARY KEY, enabled BOOLEAN, markup NUMERIC(6,3) CHECK (markup BETWEEN 1 AND 20),
  updated_by UUID, updated_at TIMESTAMPTZ NOT NULL DEFAULT now());

CREATE TABLE media_purpose_defaults (         -- admin: default model per purpose (UI in P1); absent row = code default
  purpose TEXT PRIMARY KEY, model_id TEXT NOT NULL, updated_by UUID, updated_at TIMESTAMPTZ NOT NULL DEFAULT now());

CREATE TABLE provider_balances (              -- prepaid providers (fal, Kling, ElevenLabs credits)
  provider TEXT PRIMARY KEY, balance_usd NUMERIC(12,4), floor_usd NUMERIC(12,4) NOT NULL DEFAULT 5,
  source TEXT NOT NULL CHECK (source IN ('api','manual')), checked_at TIMESTAMPTZ NOT NULL DEFAULT now());

ALTER TABLE generation_files ADD COLUMN object_key TEXT, ADD COLUMN sha256 TEXT;  -- R2 pointer (infra track); bytes stay until backfill
```
`video_ops` is not dropped (additive rule): new video submits write `media_jobs`; the poll loop reads both tables until
the last `video_ops` row is past its 20-minute deadline; then the old loop is removed in code (P1). Settings (in
`settings.ts` CATALOG, audited): `media.markup` (1–20, default 2), `media.core.image|video|speech` (bool, default
false = old path), `media.max_inflight_per_user` (default 3). Admin writes go through `adminHandler` + audit as every
other setting.

## 6. Moving today's engines onto the core (unchanged behaviour and prices)
One commit per step, each with its parity test green before the next:
1. Core types, params, cost, pricing, catalog, purposes, router, breaker, limiter + their unit tests (no callers yet).
2. **Price parity**: before touching callers, a script records `priceFor(tool, values)` for every `rasm`/`video`/
   `podcast`/`greeting` parameter combination into `tests/fixtures/media/price-golden.json`; after wiring, the test
   asserts equality for every row. Prices that come from `tool_pricing` are applied the same way on both paths.
3. **Image**: `buildImageArtifact` (rasm), `portrait/engine.ts`, slide illustrations call `mediaRequest` when
   `media.core.image` is on. Request parity: the existing probe tests run twice (old path, core path) and compare the
   `buildRequest` bodies byte for byte.
4. **Video**: `submitVideoJob` / `pollOp` / `finalizeVideo` over `media_jobs`; same deadlines (20 min), same Uzbek
   messages (`VIDEO_*_MESSAGE`), same backoff (`videoPollDelaySec`), same refunds.
5. **Speech**: `audio/engine.ts` + domla call the core speech chain; `tts.order` remains the order; chunking, MP3
   packing and the Gemini rpm gate unchanged.
6. Switch on in prod one kind at a time (image → speech → video), watch `media_jobs` + error ratio for a week, then P1
   deletes the old branches.

## 7. Infra track (parallel docs, each server step needs the owner's consent)
- **I1 — new server** (owner buys it within 3–4 days): runbook `docs/ops/VPS6-CUTOVER.md` in the 2026-09-30 style —
  provision, docker + compose, `.env` copy (owner), DB restore from the nightly dump + final core dump, DNS switch,
  ~10 min downtime at night, rollback = DNS back to the old box (kept read-only 48 h).
- **I2 — R2 storage** (**deferred by the owner 2026-11-01**: «Cloudflare later, files stay on the server for now»;
  until then the pg store stays and a local-disk store on the new server is the interim option): `store-r2.ts` behind `MediaStore` (S3 API, SigV4 via `aws4fetch` — one tiny justified
  dependency instead of the AWS SDK); `MEDIA_STORE=pg|r2`; new files go to R2 when configured; reads prefer
  `object_key`, fall back to `bytes`. Backfill script `scripts/media-backfill-r2.mts`: batches of 200, upload →
  re-download sha256 check → set `object_key`; `--dry-run`; bytes are cleared **only** in a second, separate,
  owner-approved run, then `VACUUM FULL generation_files` in a maintenance window (the 5.7 GB DB is mostly these bytes).
  Downloads keep today's auth + Range (server streams from R2); previews in P1 use short signed URLs.
- **I3 — load test**: k6 scripts in `loadtests/` at 2× the §0 peak (10 jobs/s submit, 800 parked ops, 5k sessions)
  against a staging copy with stubbed providers; pass = p95 API < 500 ms, no lost jobs, no double charge.

## 8. Tests
| Area | Test | Mutation targets (each must turn a test red) |
|---|---|---|
| Purity | `studio-core-purity.test.mts`: import graph of `lib/studio-core/**` stays inside the folder (+ the P0 adapter allow-list) | add a `lib/server` import |
| Params | normalize/validate per type; unknown enum rejected; differential probe: each param changes request or price | drop a param from the request; map unknown to default |
| Cost | every CostRule shape; agreement with `IMAGE_PRICES` / TTS meter | per-second ↔ per-output swap; table lookup default |
| Pricing | markup, override fixed/markup, rounding, min 1, tool_pricing % on top; price golden (§6.2) | ×markup removed; override ignored; rounding direction; integer cast |
| Router | primary chosen; fallback on retryable-before-accept; **no fallback after accept**; breaker open/half-open; unavailable model hidden | accept check removed; breaker threshold off by one |
| Idempotency | same key twice → one provider submit, one charge | unique key dropped |
| Adapters | contract tests on recorded, scrubbed responses (`tests/fixtures/media/<provider>/*.json`): success, 429, 5xx, safety refusal, malformed body | failure class mapping |
| Storage | one contract suite run against the pg store (test DB 127.0.0.1:55440) and the fake store; R2 suite runs when R2 env is present | sha256 check skipped |
| Video parity | old vs core: deadline, backoff, messages, refund amount | deadline constant |
| Host | route rejects disallowed `modelId` before charge; parked job resumes after worker restart | allow-list check |
| Live smoke | `npm run studio-live -- <modelId>` (via `scripts/heavy.sh`), one real call per P0 model with a key, output to the admin account | — |
Commands run one file at a time through `scripts/heavy.sh`; full suite once before the PR.

## 9. Delivery
Branch `feat/studio-p0` → PR. Steps §6.1–6.5 as separate commits; independent review by a fresh agent (money path →
strongest model); CI green; merge (auto-deploy) with all `media.core.*` OFF; prod check; then the owner's consent to
switch each kind on. Report to the owner in Uzbek after the merge and after each switch.

## 10. Open items carried (not P0 blockers)
- Paynet prefill param (variants A–D) — `lib/paynet-link.ts`, `PAYNET_APP_PREFILL` stays off.
- Bandlik real `vk-` payment test (owner side).
- `FAL_KEY` / `FAL_MODEL*` leftovers in the server `.env` — P2 decides reuse; nothing touched without asking.
