# SlaydX — project context for a new chat (2026-10-22)

Read this first in a fresh session. No secrets, keys or server addresses are stored here (they live in the server `.env` and in the
owner's private notes); only names, mechanics and decisions. Updated by whoever changes one of these facts.

## 1. Who and how
- Owner speaks **Uzbek**; code, comments, commits, docs are English; UI copy is Uzbek (bot: uz/ru/en).
- Protocol (CLAUDE.md «Ish tartibi»): ask all open questions ONCE up front, then implement → independent review (money/auth: strongest
  model) → CI → merge to `main` (auto-deploys) → verify prod → notify the owner via the bot. «to'xta» = stop at once.
- Token economy ($20 plan): cheaper agents by default, ≤ 1–2 agents, one review per release, commit after every step.
- Money / server / pricing actions need the owner's consent first. Test/sample content always goes to the owner's real account
  (`adkhambek_4`) through `enqueueGeneration`.

## 2. Production
- One shared box (also hosts other projects), public domain `slaydxx.uz`. Containers: `slaydx-web-1`, `slaydx-worker-1/2`, `slaydx-postgres-1`
  (`docker compose -p slaydx` — the `-p` is mandatory). Secrets only in the server's `.env` (never in git, never printed).
- Deploy: push `main` → CI (static, unit×4, ui×3, build, images→GHCR, ci-ok, promote) → server cron `slaydx-auto-deploy` → `slaydx-deploy <sha>`
  (6–10 min). Verify: server `current.env` + `history.log`, `/api/health`, container logs. Details: `docs/ops/DEPLOY.md`.
- Workers are separate processes: every env var a worker needs must be listed in the `worker` block of `docker-compose.yml`
  (`tests/compose-env.test.mts` pins it). Bot token / support link / premium emoji are in it since PR #48.
- Backups: nightly FULL dump + off-site copy; every deploy takes a small «core» dump (DB without the generated-file rows, ~100 MB, newest 3 kept) as its rollback point; monitoring: `server_metrics` recorder, alert rules (memory < 10 %, swap > 85 %, disk > 85 %, load,
  queue, failed-generation ratio, container events) → bot message to the owner; admin page «Yuklama tarixi» (`docs/ops/METRICS.md`).

## 3. Settings the owner controls (admin panel → Sozlamalar, table `app_settings`, audited)
| Key | Meaning | Prod now |
|---|---|---|
| `payment_bonus_percent` | extra points on every top-up (0–50 %), `settleOrder`, ref `payment-bonus:<orderId>` | **10** |
| `pricing.payment_fee_percent` | payment-provider fee used by the margin reports (0–10 %) | not set → default 0 |
| `pricing.target_markup` | target markup (×) of the price recommendation (1–20) | default |
| `finance.soum_per_usd` | USD rate for cost/margin reports | default |
| `generation.paused`, `generation.paused_tools` | stop accepting new jobs (no charge) | off |
| `free_llm.disabled`, `free_llm.daily.global` | free-AI switch and daily cap | default |
| `queue.max_wait_sec` / `queue.user_max_inflight` / `queue.total_slots` / `queue.mean_service_sec` | admission: longest honest wait, per-user in-flight cap, real slot count, mean job duration (0 = measured automatically from the last 200 jobs) | env defaults (900 s / 2 / 8 / auto) |
| `admin.wallet_confirm_threshold` | wallet correction needs re-typed amount above this | default |
Prices: one place, `priceFor` (server); admin «Narxlar» page adjusts 25–1000 % per tool with rounding (100/500/1000) and shows cost, margin
(listed-revenue and cash), bonus cost; admin test jobs are excluded unless «Adminlar bilan». Credits only through `lib/server/credits.ts`
(points = 1 so'm).

## 4. Payments (Click)
- Only Click is live (Payme later). Keys are the four `CLICK_*` env names in `.env.example`. Prepare = Complete URL = `/api/payments/click`.
- Methods in the wallet: Click app (deeplink), card (Uzcard/Humo via Merchant API `card_token` request/verify/payment, any 16–19 digit card,
  «Kodni qayta yuborish» 60 s), phone invoice (`invoice/create`). Free amount 1 000–10 000 000 so'm.
- **Fiscalization is done by Click**, not by us: receipt data is set in the Click cabinet (debit receipt, PINFL, VAT 0 %, item «SlaydX»).
  **MXIK / SPIC code in the cabinet: `10305008004000000`** (package 1546606) — the owner confirms Click assigned exactly this code to SlaydX.
  Our server sends NO MXIK/VAT/item fields (only amount, order id, phone) — nothing to change in code.
- **Shared Click service with Bandlik.uz (vakant3):** callbacks whose `merchant_trans_id` starts with `vk-` are forwarded unchanged to `VAKANT_CLICK_FORWARD_URL` (default abitur24.uz) and its JSON reply is returned to Click; failure → Click `-7 forward_failed`. SlaydX never looks up, settles or logs-to-DB such orders (`lib/server/click-forward.ts`, `docs/payments/CLICK-FORWARD.md`). SlaydX order ids are UUIDs so they can never start with `vk-`.
- Live results: app payment works end to end (bonus credited). Card 6262… got no SMS (asked Click); phone-invoice method not yet live-tested.
- Refund policy: the bot only accepts payments; money paid is not refunded to the user (owner decision).

- **Paynet** (JSON-RPC provider endpoint `/api/payments/paynet`, `docs/payments/PAYNET.md`): live, one service `serviceId 1`, payer = SlaydX ID; no IP allow-list (Paynet's real source differs from the document's ranges). Shared with Bandlik.uz by payer prefix `vk-` behind `PAYNET_SHARED_WITH_VAKANT` (OFF until Bandlik serves its endpoint). Commission 0 %.

## 5. AI providers
- Text/LLM: only **Gemini** (default) and **Anthropic** (via `ANTHROPIC_WORKSPACE_ID` header when set); roles `LLM_WRITER/RESEARCHER/JUDGE/FAST`
  with fallbacks. xAI/Grok, OpenRouter and OpenAI-as-text were removed (2026-10-31); a leftover `LLM_<ROLE>` entry naming one of them is skipped with a
  warn line and the valid entries keep working. Old `ai_usage`/`cost_json` rows of those providers stay readable in the admin cost reports.
  Images: Gemini lite image for «Rasm»/pro slides, OpenAI gpt-image («ChatGPT» choice of «Rasm», `OPENAI_API_KEY`, registry id `openai-image`),
  free stock Pexels → Pixabay for plain slides (fal.ai was removed); TTS: **Gemini** (`TTS_GEMINI_MODEL`, two voices: female Kore / male Charon,
  preview in the form). Gemini TTS preview quota ≈ 10 requests/min/model → chunks ≤ 1 400 chars, 90 s call timeout, pg rate limit `tts:gemini:rpm`.
- **Admin «Provayderlar» (redesigned 2026-10-31)** — one page for everything about providers: purpose cards («Nima uchun nima kerak»: what each purpose
  needs and whether the setup is enough — Yetarli / Yetarli, zaxirasiz / Yetarli emas / Yoqilmagan, `lib/server/providers/catalog.ts`), provider cards
  (To'lovli / Bepul / Bepul limit bilan, real status, price note from the price book, usage today/7/30 days from `ai_usage`, free providers' request
  counters from `provider_calls`), key in/replace/delete, on/off, live test, and system health (breakers, limiters). The old «AI xarajat → Provayderlar»
  tab is gone (`?tab=providers` forwards here). **Routing slots** (`ai_routes`, migration 062, `lib/server/providers/routes.ts`): `llm.model` (default Gemini
  text model), `llm.writer/researcher/judge/fast` (provider:model chains), `image.gemini` (image model), `tts.order` (voice-provider order). Precedence:
  admin's stored choice > `LLM_*`/`GEMINI_*` env > built-in default, decided in ONE place (`providers/route-effective.ts`) which the generation layer
  and the page both read; changes reach the other process within ~30 s. Only models of the price book can be chosen. `TTS_VOICE_<LANG>` still beats
  the stored voice order. Writes need `settings.edit` + step-up + reason and are audited (`routes.set` / `routes.reset`).
- Metering: `ai_usage` + `cost_json`; pricing tables in `lib/generation/llm-pricing.ts`. Roughly 25 % of price is AI cost; bonus points are a marketing cost.
- Failure logging: `[llm] attempt failed`, `[llm] json repaired`, `[llm] stream anomaly` lines (worker logs). Slide JSON repair: `docs/llm/SLIDE-BAD-JSON.md`.

## 6. Bot, Mini App, sessions
- Bot = same services as the web (no business logic of its own). Admin panel inside the bot is a **reply keyboard**: Statistika, Xabar yuborish,
  **Xabarlar holati** (broadcasts in progress, pause / resume / stop), Kanal ulash (bonus channels), To'lov bonusi (`docs/bot-admin/PLAN.md`).
- Reply-keyboard web_app buttons give empty `initData` → signed `?bt=` link (nginx redacts it from logs). Telegram Desktop drops session cookies →
  opt-in Bearer fallback (`docs/auth/COOKIELESS.md`). Webhook has its own secret (`TELEGRAM_WEBHOOK_SECRET`).
- Support group link `https://t.me/SlaydX_support` is used everywhere (`lib/support.ts`).
- **Qattiqqo'l domla** (owner request 15, migration 057; `/domla`, `/uz/domla`): spoken defence of a slide / pro-slide work. Settings `domla.enabled` (default on,
  stops NEW starts only) and `domla.price` (default 3 000 so'm, charged once at start, ledger ref `domla:<sessionId>`; full refund only when question writing fails).
  The webhook only writes rows (`domla_sessions`, `domla_jobs`); the worker loop (`domlaStep` in `worker.ts`, 2 jobs at once) does LLM / TTS / scoring.
  Audio OUT: Gemini TTS voice **Charon** (needs `TTS_GEMINI_MODEL`), WAV 24 kHz -> **MP3 via lamejs** (the worker image has no ffmpeg) -> `sendAudio`, the text is the caption;
  no TTS -> the question goes out as text. Audio IN: Telegram voice (OGG/Opus, <= 2 MB, <= 120 s) is downloaded by the worker and sent inline to ONE Gemini call that
  transcribes and scores (JSON schema); only the transcript is stored, never audio. Idle 30 min -> expired (resumable inside the window). Spend: `ai_usage` tool `free:domla`.
- **Test ishlash / paid tests** (owner request 7, migration 059; `/test`, `/uz/tests`, `/api/tests/*`): ready-made image/text question bank (BMB mechanics: one random variant per
  subject, 10 random questions, 20 min; «hammasi» = 30 questions / 60 min; +1.1 per correct, no negatives). SHIPS DARK: `tests.enabled` defaults to false. Settings `tests.*`
  (`tests.price_subject` 1 500 / `tests.price_all` 4 000 by mode, charged once at start, ref `test:<attemptId>`; `first_attempt_free`; questions/minutes/points). Server-side deadline and scoring; the answer key reaches the client only in
  the finished view. **AI analysis of wrong answers** (migration 063, `lib/server/test-analysis.ts`, `GET /api/tests/attempts/{id}/analysis`, finished attempts only): one multimodal Gemini call per question+key (image inline), cached in `test_analyses` for all users, ≤ 3 calls at once, failed → «Qayta urinish»; model = routing slot `tests.analysis` (default `gemini-3.1-pro`), spend in `ai_usage` as `tests:analysis`, included in the price. Bank import: `npm run import:tests -- export.json images [--dry-run]`, export runbook `scripts/export-bmb-tests.md`. Needs the owner's answers before switching on.
- Running-job page: stage checklist, percent, ETA (`docs/ux/GENERATION-PROGRESS.md`).

## 7. Known open items (2026-10-22)
- **Current program:** `docs/program-17/PLAN.md` (17 owner requests, phases 0 → A → B → C → D, decisions D1–D9).
- Shipped since 2026-10-14: Paynet provider (migration 050), Click forward for Bandlik.uz, tiered referral rewards (PR #62),
  bonus-channel soft delete (PR #63). Referral tiers are being halved (D3) and units renamed to so'm (D1) in Program 17 phase A.
- Capacity notes for new heavy tools: LibreOffice is web-only (writer+impress, no Calc), gate 2 concurrent / 20 waiters → 503;
  8 worker slots, admission mean is global (one slow tool skews every ETA); broadcast limiter 25 msg/s shared with all bot traffic.
- Slide failure rate (was 3.7 %/9 %): re-check worker logs after the JSON-repair and Anthropic fixes.
- Google AI Studio final 4–10 Oct figure vs our metered $7.07 (`scripts/cost-reconcile.mts`).
- Click: card 6262 SMS, phone-invoice live test. Telegram Desktop login retest (PR #47). `/admin/system` charts on a phone.
- `pricing.payment_fee_percent` is still 0 on prod — set Click's / Google's fee in Sozlamalar to make margins honest.
- Flaky `tests/bonus-bot.test.mts` («Yangilash» rate limit). Optional: Azure free TTS tier as first provider.
