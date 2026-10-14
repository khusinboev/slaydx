# SlaydX — project context for a new chat (2026-10-14)

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
- Backups: daily DB dump + off-site copy; monitoring: `server_metrics` recorder, alert rules (memory < 10 %, swap > 85 %, disk > 85 %, load,
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
- Live results: app payment works end to end (bonus credited). Card 6262… got no SMS (asked Click); phone-invoice method not yet live-tested.
- Refund policy: the bot only accepts payments; money paid is not refunded to the user (owner decision).

## 5. AI providers
- Text/LLM: Gemini (default), roles `LLM_WRITER/RESEARCHER/JUDGE/FAST` with fallbacks (Anthropic via `ANTHROPIC_WORKSPACE_ID` header when set, OpenRouter);
  images: Gemini lite image (fal.ai code kept but dead); TTS: **Gemini** (`TTS_GEMINI_MODEL`, two voices: female Kore / male Charon,
  preview in the form). Gemini TTS preview quota ≈ 10 requests/min/model → chunks ≤ 1 400 chars, 90 s call timeout, pg rate limit `tts:gemini:rpm`.
- Metering: `ai_usage` + `cost_json`; pricing tables in `lib/generation/llm-pricing.ts`. Roughly 25 % of price is AI cost; bonus points are a marketing cost.
- Failure logging: `[llm] attempt failed`, `[llm] json repaired`, `[llm] stream anomaly` lines (worker logs). Slide JSON repair: `docs/llm/SLIDE-BAD-JSON.md`.

## 6. Bot, Mini App, sessions
- Bot = same services as the web (no business logic of its own). Admin panel inside the bot is a **reply keyboard**: Statistika, Xabar yuborish,
  **Xabarlar holati** (broadcasts in progress, pause / resume / stop), Kanal ulash (bonus channels), To'lov bonusi (`docs/bot-admin/PLAN.md`).
- Reply-keyboard web_app buttons give empty `initData` → signed `?bt=` link (nginx redacts it from logs). Telegram Desktop drops session cookies →
  opt-in Bearer fallback (`docs/auth/COOKIELESS.md`). Webhook has its own secret (`TELEGRAM_WEBHOOK_SECRET`).
- Support group link `https://t.me/SlaydX_support` is used everywhere (`lib/support.ts`).
- Running-job page: stage checklist, percent, ETA (`docs/ux/GENERATION-PROGRESS.md`).

## 7. Known open items (2026-10-14)
- Slide failure rate (was 3.7 %/9 %): re-check worker logs after the JSON-repair and Anthropic fixes.
- Google AI Studio final 4–10 Oct figure vs our metered $7.07 (`scripts/cost-reconcile.mts`).
- Click: card 6262 SMS, phone-invoice live test. Telegram Desktop login retest (PR #47). `/admin/system` charts on a phone.
- `pricing.payment_fee_percent` is still 0 on prod — set Click's / Google's fee in Sozlamalar to make margins honest.
- Flaky `tests/bonus-bot.test.mts` («Yangilash» rate limit). Optional: Azure free TTS tier as first provider.
