# Bonus tasks («🎁 Bonus olish», Notcoin-style) — 2026-10-08

Owner request: a «Bonus olish» screen in the bot with tasks that pay bonuses: subscribe to channels, invite friends, register.

## Owner decisions (2026-10-08)
| # | Decision |
|---|---|
| B-Q1 | News channel subscription is NOT mandatory — it is a bonus task (no gate) |
| B-Q2 | Amounts: signup **2 000** (was 3 000), invite a friend **2 000** (exists), news channel **2 000 once**, extra channel **1 000** on join **+ 2 000** if still a member after **7 days** |
| B-Q3 | Leaving a channel does NOT claw back a paid bonus; leaving before day 7 only forfeits the unpaid stay bonus |
| B-Q4 | Channel list managed in the **admin panel** (add / edit / activate, amounts, order); the bot must be an admin of each channel |

Currency: bonuses are **ball** (`points`, spendable like tanga; 1 tanga = 1 so'm), through `credits.topUpInTx(kind "bonus")` with
unique ledger references → idempotent. The news channel is just a channel row with join_bonus 2000, stay_bonus 0.

## Data (migration 041, additive)
`bonus_channels` (chat_id unique, username, title, join_bonus, stay_bonus, stay_days, active, sort) and
`bonus_channel_claims` (PK user_id+channel_id, joined_at, join_paid, stay_paid, stay_checked_at, left_at).
Ledger refs: `channel:<channel_id>:<user_id>:join`, `channel:<channel_id>:<user_id>:stay`.

## Flows
- Bot «💰 Hamyon / Bonus» → wallet card + «🎁 Bonus olish» → tasks screen (edit one message): invite friends (2 000 each, count +
  earned, copy link), each active channel: «Obuna bo'lish» (url t.me/<username> or invite link) + «✅ Tekshirish» → getChatMember →
  member/administrator/creator → claim row + join bonus (once) → «✅ +1 000 ball» toast/card; not a member → «Avval obuna bo'ling».
  Shows «7 kundan keyin yana +2 000» progress for joined channels.
- Worker sweep (housekeeping): claims with joined_at + stay_days ≤ now, stay unpaid, not left → getChatMember → still member → pay
  stay bonus + notify the user in the bot; left → left_at, no pay. Bounded batch, respects Telegram limits.
- Admin panel «Bonus kanallar»: add by @username or t.me link (getChat resolves chat_id/title), check the bot is admin (warn if not),
  edit amounts/days/active/sort, stats (joined, paid join, paid stay, left), audit rows, permission-gated like other admin pages.

## Packages
| WP | Scope | Files | Model |
|---|---|---|---|
| K1 Bot + core | `lib/server/bonus-channels.ts` (user-side: tasks, check+pay join, stay sweep, chatMember), worker housekeeping step, bot screens + callbacks + i18n (uz/ru/en), signup bonus 3000→2000 (+ texts/tests), tests | `lib/server/bonus-channels.ts`, `lib/server/bot/*`, `lib/server/telegram.ts`, `lib/server/worker.ts` (one step), `lib/server/auth.ts` (constant), tests | opus |
| K2 Admin | admin API + page «Bonus kanallar» (CRUD, resolve channel, bot-admin check, stats, audit, permission) | `lib/server/admin-bonus-channels.ts`, `app/api/admin/bonus-channels/**`, `app/admin/(panel)/bonus/**`, `components/admin/bonus/**`, admin nav entry, tests | opus |
| Review | security/money review of both | read-only | opus |

## K1 implementation notes
- `checkChannel` → `paid | already | not_member | inactive | unknown | blocked`; a claimed channel answers `already` with no Bot API
  call; the payment re-checks `telegram_id`, `is_blocked` and `active` under the user row lock / channel share lock, then
  `INSERT … ON CONFLICT DO NOTHING` + `topUpInTx` (`channel:<id>:<user>:join`, note `Kanal obunasi: <title>`).
- `staySweep(limit)` — worker step `bonus-stay`, every 10 min, batch 200, ≤ 20 Bot API calls/s, 15 s budget (review fixes); `unknown` retried
  after 6 h (`stay_checked_at`); stay note `Kanalda qolish bonusi: <title>`; the notice message carries «🎁 Boshqa vazifalar» (`b:h`).
- Bot callbacks: `b:h` (tasks screen), `b:c:<channelId>` (check; ≤ 10 per user per minute). Hamyon's first row is «🎁 Bonus olish».
- Admin panel (K2): the bot reads only `active`, `sort`, `title`, `username` (no username → no «Obuna bo‘lish» button),
  `join_bonus`, `stay_bonus`, `stay_days`, `chat_id`.

## Review fixes (2026-10-08, `wip/bonus-fix`)
- **Leaving before day N (B-Q3) is detected when it happens.** Telegram `chat_member` updates (the bot is an admin of every
  bonus channel) route to `bonus-channels.ts recordChannelLeave`: a member of an active or inactive bonus channel (by
  `chat_id`) whose new status is `left` / `kicked` / `restricted` with `is_member: false` gets `left_at = now()` on their
  claim while `stay_paid IS NULL` (users looked up by `telegram_id`, unknown users ignored, replay keeps the first `left_at`).
  Re-joining never clears `left_at`. No reply is sent. The sweep's `getChatMember` at day N stays as the second line.
- **Production webhook must include `chat_member`** — Telegram sends it ONLY when `allowed_updates` names it. `setWebhook`
  replaces the whole list, so send all four (current prod list is message, inline_query, callback_query):
  ```bash
  curl -F "url=https://<domen>/api/telegram/webhook" \
       -F "secret_token=$TELEGRAM_WEBHOOK_SECRET" \
       -F 'allowed_updates=["message","inline_query","callback_query","chat_member"]' \
       "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook"
  # verify: curl "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/getWebhookInfo" → allowed_updates lists chat_member
  ```
  Deploy the code first (an older build ignores `chat_member` harmlessly). `scripts/bot.mts` (dev polling) asks for the same list.
- Amounts are capped at **20 000** per channel for `join_bonus` and `stay_bonus` in the admin validation (server and form);
  the DB CHECK (≤ 1 000 000) is unchanged.
- «Havola yaratish» calls `getChat` first and refuses anything but a channel / supergroup.
- A channel with `stay_bonus = 0` settles the claim at once (`stay_paid = 0`), so it never enters the sweep's partial index;
  the sweep settles older such rows the same way without a Bot API call; «Kutilmoqda» counts only channels with a stay bonus.
- Migration 043: index `bonus_channel_claims (channel_id)` (admin stats, the channel delete check, the FK cascade).
- Sweep: batch **200** per run (every 10 min), time budget **15 s** (the rest continue next run), ≤ 20 Bot API calls/s.
