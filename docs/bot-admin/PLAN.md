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
