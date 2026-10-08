# Bot UI — reply keyboard tools + «Profilim» (2026-10-08)

Owner request: move the most used functions into the Telegram bot: 3 most used tools as reply-keyboard WebApp buttons, a
«Profilim» section to view and edit profile data, a beautiful clear bot UI (coloured buttons, new button types, premium emoji
in texts and button labels). Mockup: https://claude.ai/artifact/7nQ3bJqzHzLmuBZJLTi4K7

## Facts (research 2026-10-08, Bot API 10.3)
- `KeyboardButton.web_app` opens the Mini App with **empty initData** (no user, no hash) — our silent Mini App login
  (`MiniAppBridge` → `/api/auth/telegram`, `verifyMiniAppInitData` requires `user`) does not work from reply-keyboard buttons.
  Inline `web_app` buttons and the menu button do carry initData.
- Bot API 9.4: `style` (`primary` blue / `success` green / `danger` red) on KeyboardButton and InlineKeyboardButton — free.
  `icon_custom_emoji_id` on buttons and `<tg-emoji emoji-id>` in messages — allowed when the **bot owner has Telegram Premium**
  (or a Fragment username). A fallback emoji is mandatory and shown where custom emoji cannot render.
- `copy_text` buttons (7.11), `<blockquote expandable>` (7.4), `message_effect_id` (private chats), `editMessageText` for
  in-chat screens (official advice: edit, do not resend), `ForceReply` for step-by-step input, `callback_data` ≤ 64 bytes,
  ~1 msg/s per chat.
- Prod usage (60 days, by tool_id): slide 40, image 25, pro-slide 18, translation 11, essay 11, resume 9.

## Current bot (inventory)
Webhook `app/api/telegram/webhook/route.ts` (secret header, dedup `telegram_updates`, retry semantics); `lib/server/telegram.ts`
(`callBot` with timeout/429 retry, `sendMessage` HTML, `/start` `/login` `/taklif` `/admin`, inline `web_app` login buttons);
no `callback_query`/`web_app_data` handling, no per-chat state, no menu button; profile PATCH SQL inline in
`app/api/users/me/route.ts` (allowlist, ≤ 200 chars, no audit); pure step model `components/profile/profile-model.ts`.

## Architecture (proposed)
```
lib/server/bot/
  ui.ts          premium-emoji table (key → custom_emoji_id + fallback), html helpers (tgEmoji, esc), button builders with style
  keyboard.ts    persistent main reply keyboard (Slayd · Rasm / Pro slayd · Profilim), WebApp URLs per user
  profile.ts     «Profilim» screens: card, section views, field prompts, saved confirmation (pure renderers → {text, markup})
  callbacks.ts   callback_query router: short codes `p:s:<section>`, `p:e:<field>`, `p:x` (cancel), `p:h` (home)
  state.ts       per-chat input state (awaiting field) in table `bot_chat_state` (chat_id PK, field, message_id, expires_at),
                 atomic claim/clear, 10 min TTL
lib/profile/fields.ts   shared field list, labels, limits (moved from components/profile/profile-model.ts, re-exported)
lib/server/profile.ts   updateProfile(userId, patch, source) — the PATCH route and the bot both call it (same allowlist,
                        trim, ≤ 200, + audit row `profile.update` with source web|bot)
migration 038_bot_chat_state.sql (additive)
```
- **Routing:** `processUpdate` gains `callback_query` (always `answerCallbackQuery`) and matches reply-keyboard texts before the
  fallback; a pending `bot_chat_state` turns the next text into the field value (ForceReply prompt). Webhook `allowed_updates`
  stays `[message, inline_query, callback_query]` (already set on prod); `scripts/bot.mts` polling adds `callback_query`.
- **Screens edit one message** (`editMessageText`/`editMessageReplyMarkup`); the main keyboard is re-sent on /start, after
  `/admin`'s contact keyboard, and when the user taps «Profilim».
- **Reply-keyboard WebApp login** — see decision Q1.
- **Premium emoji** — `BOT_PREMIUM_EMOJI=1` switch; off → fallback emoji only (same texts). IDs fetched once with
  `getCustomEmojiStickers` from a chosen pack and stored in `ui.ts`.
- Menu button (`setChatMenuButton` → `/uz`) so the full app is always one tap away with full login.

## Open decisions (owner)
See the question round in the chat (Q1 login from keyboard buttons, Q2 premium emoji, Q3 tools, Q4 profile editing).

## Owner decisions (2026-10-08)
| # | Decision |
|---|---|
| Q1 | Reply-keyboard WebApp login: **personal signed link** in each keyboard URL, valid **7 days**, refreshed on /start and «Profilim»; expired → page says «botga qayting» |
| Q2 | Owner HAS Telegram Premium → premium custom emoji in texts and on buttons (fallback emoji always; `BOT_PREMIUM_EMOJI` switch) |
| Q3 | Keyboard tools: **Slayd · Rasm · Pro slayd** (+ «Profilim») |
| Q4 | Profile editing **in the chat** (section → field → ForceReply prompt → saved), plus «Ilovada to'liq ochish» |
Release: when reviewed (fable security review for the link token) + CI green, merge to main (auto-deploy), notify the owner.

## Work packages
| WP | Scope | Files (exclusive) | Model |
|---|---|---|---|
| B1 Link login | signed token (HMAC with SESSION_SECRET-derived key, telegram id + exp 7 d + version), `botAppUrl` body, token → session exchange route (same session rules as Mini App login: account switch confirm, Origin check, rate limit), MiniAppBridge reads `?bt=` when initData is empty and strips it from the URL, expired/invalid page state «botga qayting», revoke on logout-everywhere | `lib/server/bot-link.ts`, `app/api/auth/bot-link/**`, `components/telegram/MiniAppBridge.tsx`, `lib/telegram-miniapp.ts`, `lib/server/auth.ts` (only additions), tests | opus |
| B2 Bot screens | `lib/server/bot/*` (ui/emoji table, keyboard, profile screens, callbacks, state), migration `038_bot_chat_state.sql`, `lib/server/profile.ts` updateProfile + audit (route refactor), `lib/profile/fields.ts` (moved pure model), telegram.ts routing (callback_query, keyboard texts, pending input), /start + menu button, `scripts/bot.mts` allowed_updates, `scripts/bot-commands.mts`, tests | opus |
| B3 Emoji pack | pick premium emoji packs and map each icon key → custom_emoji_id + fallback (lead fetches IDs via getStickerSet) | research only | sonnet |
| S review | security of B1 token + B2 input handling | read-only | fable |
