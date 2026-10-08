# Bot admin panel (client request, owner decisions 2026-10-08)

Request: an admin panel inside the Telegram bot with the main actions — «Xabar yuborish», «Kanal ulash», «Statistika».

## Owner decisions
| # | Decision |
|---|---|
| A-Q1 | Who: every user linked to an admin account (`getAdminAccountForUser`), **by role permissions** (finance/viewer see statistics only; owner/admin everything) — the web RBAC (`lib/server/admin-rbac.ts`) is the single source |
| A-Q2 | Broadcast content: **text, photo or video with caption + an optional single link button**, copied as-is to recipients |
| A-Q3 | Audience choice: **all bot users / active in 30 days / joined in 7 days** (same audiences as the web broadcasts) |
| A-Q4 | Statistics: **users** (total, new today/7d, active), **documents** (today/7d, top tools), **money** (revenue today/7d/30d, payments count), **bonuses** (paid by type: channel, invite, signup, first top-up; channel subscribers) |

## Design
- Entry: an extra «🛠 Admin» row on the main keyboard for linked admins only (re-checked server-side on every action), and `/admin` (today it starts the contact-sharing link flow — keep that for users without an admin link; for linked admins it opens the panel).
- Screens edit one message; callback codes `a:*` ≤ 64 bytes; every action re-checks the admin account + permission; every mutation goes through the existing admin services with an `AdminActor` and writes audit rows (`createBroadcast/sendTest/sendBroadcast`, `admin-bonus-channels` create).
- Broadcast flow: «📣 Xabar yuborish» → «Xabarni yuboring» (state in bot_chat_state, 10 min) → admin sends text/photo/video(+caption) → optional «🔗 Tugma qo'shish» (text + https url) → audience choice with recipient count → preview (copy to the admin) → «🧪 O'zimga sinov» → «✅ Hammaga yuborish» confirm (shows count) → queued through the existing broadcast delivery (rate-limited, progress, cancel). Media is sent with copyMessage/file_id from the admin's message.
- Channel flow: «📢 Kanal ulash» → forward any post from the channel or send @username / t.me link → resolve via getChat → bot admin check (warn) → type «📰 Yangiliklar (2 000 so'm)» / «➕ Qo'shimcha (1 000 + 7 kunda 2 000)» / custom amounts within the 20 000 cap → confirm → `admin-bonus-channels` create (audit). List / toggle existing channels.
- Statistics: one card from SQL aggregates (reuse lib/server/admin-metrics.ts where possible), «🔄 Yangilash».

## Implementation notes (wip/bot-admin)
- **Access** (`lib/server/bot/admin-access.ts lookupAdmin/adminCtx`): re-read on EVERY admin message and `a:*` tap — unblocked
  user with this `telegram_id` + `admin_accounts` row `active|pending` (2FA mode: `active` AND enrolled). Role permissions come
  from `admin-rbac.ts`. Non-admin taps → «Ruxsat yo‘q» only; a linked admin without the permission → «Ruxsat yo‘q» + `auth.denied`
  audit row (rate-limited like the web). Actions: panel/stats `dashboard.view` (bonus section of stats only with `bonus.view`),
  broadcast `broadcasts.send` (progress `broadcasts.view`), channel list `bonus.view`, connect/toggle `bonus.edit`. Per-admin
  bot rate limit 60/min.
- **Step-up.** Simple mode (prod today, the web has no step-up): Telegram identity of the linked admin (secret-header webhook,
  private chat = the tapping user) + an explicit confirm button naming the effect. 2FA mode: the confirm taps (send, stop,
  channel create/toggle) also need a TOTP code typed in the chat (`admin-accounts.ts botStepUp` = the web's lock, replay guard
  and `auth.reauth` audit, `meta.via=bot`), valid 10 min per chat; the code message is deleted.
- **Broadcasts.** Migration 044 adds `broadcasts.content` (text entities / photo|video `file_id` / one https button /
  `notify`); web broadcasts keep `content = NULL` and the plain-text path. New audience kind `new_days` («Yangilar (7 kun)» =
  accounts created in 7 days). Draft row created lazily at the first test or the send; button/audience change cancels it
  (audited); «✅ Yuborish (N)» passes N as `confirmCount`. Delivery sends rich content with entities and posts a summary to
  the admin's chat when done.
- **Channels.** Forward (`forward_origin.type = channel`) or @username / t.me link → `resolveChannel` → «📰 Yangiliklar ·
  2 000» / «➕ Qo‘shimcha · 1 000 + 7 kunda 2 000» → confirm → `createBonusChannel` (private channel: invite link via
  `createInviteLink` when the bot is admin). Custom amounts stay in the web panel.
- **i18n**: `bot/admin-i18n.ts` (uz/ru/en); errors from the shared admin services are Uzbek in every language (web texts).
- State: `bot_admin_state` (044), 10 min, claim per update id; commands / keyboard buttons / a profile prompt drop it.
