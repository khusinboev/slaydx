# Bonus 3 / mandatory channels / broadcast engine (owner, 2026-10-09)

## Owner decisions
| # | Decision |
|---|---|
| C-Q1 | Architecture: ONE service layer. The bot has no business logic of its own; every bot action calls the same `lib/server/*` service the web API route calls (permissions, audit, money in one place). Bot and web share one database. |
| C-Q2 | Channels are connected as **mandatory** or **optional**. Not subscribed to a mandatory channel → the user cannot CREATE new work (bot and web app): tool forms / generation API show «Avval kanalga obuna bo‘ling» + channel button + «Tekshirish». Files, profile, wallet stay available. |
| C-Q3 | Users without Telegram (phone login) → before creating they are asked to link / log in with Telegram, then the subscription is checked. |
| C-Q4 | Payment bonus: EVERY paid top-up of ANY amount earns **N %** (default 10) as bonus points, no cap. Admin sets N (0–50, 0 = off) in the web admin panel and in the bot admin panel; audited. Replaces the «first top-up only, ≥ 50 000, max 20 000» rule (already-paid first-top-up bonuses stay). |
| C-Q5 | Broadcast engine: adopt manager-bot's strengths (research in chat 2026-10-09): dedicated delivery loop with N concurrent senders behind a paced limiter (≤ 25/s), global pause on 429 for retry_after+1, per-recipient retry with backoff (no transaction across HTTP), `users.bot_blocked_at` hygiene (excluded from audiences, cleared on /start or my_chat_member), error kinds, early abort when the first ~200 sends all fail permanently, pause/resume, heartbeat + auto-updated progress in the bot. Keep our content types, audiences, confirmCount, audit. |

## Packages
| WP | Scope | Model |
|---|---|---|
| D1 Payment bonus % | settings key (app_settings or existing settings mechanism) `payment_bonus_percent`, settleOrder pays % of every paid top-up (unique ref per order), web admin control + bot admin control (audited), bot bonuses message/wallet hint/texts updated, remove the first-top-up-only path for new payments | opus |
| D2 Mandatory channels | migration: bonus_channels.mandatory boolean; admin web + bot «Kanal ulash» choose mandatory/optional; membership cache; server gate in the generation enqueue path (+ tool page UI gate in web and bot tool screens); Telegram-less users → «Telegram'ni ulang»; tests | opus |
| D3 Broadcast engine | C-Q5 | sonnet (after D1/D2) |

## Owner addition (2026-10-09)
- C-Q6: the bot admin menu is a REPLY keyboard at the bottom while the admin is in the panel:
  [📈 Statistika][📢 Xabar yuborish] / [🔔 Kanal ulash][💳 To‘lov bonusi] / [⬅️ Asosiy menyu] — «Asosiy menyu» restores the main
  keyboard. Access re-checked on every tap (texts are matched only for linked admins). Lead does it after D1/D2 merge.

## D3 broadcast engine — as built
- **Loop**: `startBroadcastLoop` (`lib/server/broadcast-delivery.ts`), started by the worker loop, NOT by the 60 s housekeeping tick. Single leader by Postgres advisory lock `727_000_003` (a dedicated connection; housekeeping keeps `…002`). It writes its own `broadcasts` row in `housekeeping_status` (rows = recipients handled since the last write).
- **Claim / lease**: short batches (10) of `pending` recipients (`next_attempt_at` passed) → `sending` with `lease_until = now() + 90 s`, `FOR UPDATE SKIP LOCKED`, committed BEFORE the HTTP call. Results are single statements keyed on the lease (a result for a lost lease is dropped). A `sending` row whose lease passed returns to `pending` at the start of the next pass.
  **Crash duplicates**: if the process dies after Telegram accepted a message but before the result was written, that recipient is sent again after the lease expires — at most the messages in flight (≤ 8, one per sender). A sender never starts a send with < 25 s of its lease left.
- **Rate**: 8 concurrent senders behind ONE limiter (`lib/server/send-limiter.ts`): even pacing 40 ms + sliding-second cap 25 + FIFO. Measured in `tests/broadcast-engine.test.mts`: 100 real-time messages = 25.0 msg/s.
- **429**: the whole limiter pauses for `retry_after + 1` s (cap 1 h); the recipient is re-queued without using an attempt. **Network / 5xx**: `attempts + 1`, `next_attempt_at = now + LEAST(600, 10·2^attempts)` s (10, 20, 40, 80, 160), the 6th failure is final (`failed`, kind `other`).
- **Permanent errors** → `broadcast_recipients.error_kind` ∈ blocked | deactivated | chat_not_found | bad_request | other; `failedReasons` in the detail groups by kind. blocked / deactivated also set `users.bot_blocked_at`.
- **Early abort**: nothing delivered and 200 permanent failures → broadcast `failed` with `fail_reason`; the admin gets the card in the bot.
- **bot_blocked_at**: set by delivery or by a private-chat `my_chat_member` with status `kicked`; cleared by `/start` or `my_chat_member` `member`; every audience (count AND snapshot) excludes users with it set.
  **Prod**: the webhook's `allowed_updates` must include `my_chat_member` (README «Prod da webhook»), otherwise only delivery failures set the flag and only `/start` clears it.
- **Pause / resume**: `pauseBroadcast` / `resumeBroadcast` (`admin-broadcasts.ts`, permission `broadcasts.send`, audited `broadcasts.pause` / `broadcasts.resume`, reason optional), web buttons on the detail page, bot buttons on the progress card. Status is re-read before every message; unsent claimed rows go straight back to `pending`.
- **Progress**: `broadcasts.heartbeat_at` on every recorded result; detail stats carry `inFlight`, `retrying`, `speed` (last 30 s), `etaSeconds`. While a bot broadcast sends, the engine edits the admin's progress message (`content.notify.messageId`, remembered by `setProgressMessage`) at most once per 10 s per broadcast, and the final summary is sent as before (the card, with the reason, when aborted).
- **Migration 046** (rollback in the file; `tests/admin-migrations.test.mts` rolls it back and forward).
