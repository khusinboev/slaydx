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
