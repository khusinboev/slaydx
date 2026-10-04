# R2 — Telegram «Ulashish» (#2) and «Saqlash» (#3)

Research only, repo at `060e731`. No product code changed, no DB/dev server needed (the proof is pure),
no real Telegram call (official docs and `telegram-web-app.js` fetched as plain files into `r2/`).

Artifacts in `scratchpad/mobile/r2/`:
- `proof-bot-requests.mjs`: builds the exact Bot API bodies (multipart `sendDocument`/`sendPhoto`, JSON resend by
  `file_id`, JSON `savePreparedInlineMessage`) with a fake token against a stubbed `fetch`. It also checks the 403/429
  handling and that the token appears in no request body. Output: `proof-output.txt` ("OK 7 stubbed Bot API calls").
- `botapi.txt`, `webapps.txt`, `tg-web-app.js`: snapshots of core.telegram.org/bots/api (Bot API 10.3, 2026-08-24),
  /bots/webapps and the official script, used for the facts below.

---

## 1. Current code

| Area | Where | Relevance |
|---|---|---|
| Bot transport | `lib/server/telegram.ts:62-118` `call()` | JSON only (`Content-Type: application/json`), 15 s timeout, one retry on 429 if `retry_after ≤ 5 s` (`:29`, `:105`). `throwTransient` turns network/5xx/429 into `TelegramTransientError` (`:36`). 403/400 return `null`, and the **error code is lost**, so a caller cannot tell "bot blocked" from "bad file_id". There is **no multipart path** and a 15 s timeout is too short for a 25 MB upload. |
| `sendMessage` | `telegram.ts:125-142` | Always `parse_mode: HTML` and `throwTransient: true`. Returns `false` on a permanent error. |
| Send example | `lib/server/admin-users.ts:907-933` `messageUser` | Pattern to copy: `users.telegram_id` → 409 `no_telegram` when absent; `sendMessage(escapeTelegramHtml(text))`; transient → 503 `telegram_unavailable`; audit row. |
| Pacing | `lib/server/broadcast-delivery.ts:49-50` | 25 msg/s, 600 per tick. This is the only global pacing. A per-user send has no limiter yet. |
| Webhook | `app/api/telegram/webhook/route.ts:20-72` → `handleUpdate` (`telegram.ts:543`) | Only `update.message` is handled (`:561-571`). `inline_query`/`chosen_inline_result` would be silently ignored. Polling asks only for `allowed_updates: ["message"]` (`scripts/bot.mts:66`); prod `setWebhook` `allowed_updates` is set manually (unknown, OWNER to check). |
| **/start payload trap** | `telegram.ts:614-630` | Any `/start <payload>` is treated as a login-ticket nonce. A share link like `t.me/<bot>?start=share` would answer «Bu havola eskirgan…». A link back to the bot must use a plain `t.me/<bot>`, or the handler must learn a non-nonce prefix. |
| Mini App bridge | `components/telegram/MiniAppBridge.tsx:25-34` | `TelegramWebApp` type covers only `initData/version/ready/expand/isVersionAtLeast/BackButton/closingConfirmation`. No `shareMessage`, `close`, `requestWriteAccess`, `initDataUnsafe`, `downloadFile`. The `webApp` object is local state, so other components have no accessor. `isTelegramWebApp` (`lib/telegram-miniapp.ts:75`) is the trusted detection to reuse. |
| initData | `lib/server/auth.ts:70-114` | Verified server-side, but only id/username/name/photo are kept. `allows_write_to_pm` (a field of `WebAppUser`, Bot API 6.9) is dropped. The client can read it from `Telegram.WebApp.initDataUnsafe.user.allows_write_to_pm`; that is fine for UX only, never for authorization. |
| Session user | `lib/server/session.ts:21,91`, client `lib/api-client.ts:200` | `telegramId: string \| null` is available on both sides. It is `null` for local/OTP accounts. |
| Bot username | `lib/server/env.ts:191` `NEXT_PUBLIC_TELEGRAM_BOT` | Read only on the server today. Not in any client bundle, so endpoints should return it when needed. |
| Existing "share" | `app/api/generations/[id]/share/route.ts:43-85`, `components/files/GameSharePanel.tsx` | Only **game links** (`publicGameKindOf`): public `/o/<token>`, ownership checked in SQL, `limit(share:<user>,30,3600)`, `navigator.clipboard` copy (`GameSharePanel.tsx:195`). There is no file sharing and no public page for documents. `/uz/files/[id]` is owner-only, so a "link back" to it is useless for recipients. |
| File storage | `lib/server/storage.ts:17,85-103`, migration `001_init.sql:102` | **Bytes live in Postgres** (`generation_files.bytes BYTEA`, one row per generation, no expiry since `011`). Cap `MAX_FILE_BYTES = 25 MB`, which is below Telegram's 50 MB multipart limit. Reads are owner- and COMPLETED-checked in SQL. |
| Serving | `app/api/generations/[id]/file/route.ts:24-100` | `ensureFreshFileShared` re-renders a stale PPTX/DOCX after edits (`lib/server/fresh-file.ts:50-85`: single-flight per user:gen, `filerender:` 30/h). `?format=pdf` goes through `pdfResponse` (`lib/server/pdf-serve.ts:53`): LibreOffice gate, disk cache, `pdf:` 10/10 min. Stored mimes: pptx, docx, xlsx, png/jpeg, mp3/wav, zip (several images), pdf. |
| Result UI | `components/files/ResultView.tsx:550-591` | «Yuklab olish» + «PDF» buttons. This is where R1's format sheet will sit. Share/Save buttons go next to it. |
| Thumbnail | `lib/server/thumb.ts:192` `getOrBuildVersionedThumb` | A first-page JPEG already exists. It could become the `thumbnail` of a sent document after a resize to ≤320 px and <200 kB (optional polish). |

## 2. Bot API options for «Ulashish» (#2)

### 2a. Recommended: `savePreparedInlineMessage` + `Telegram.WebApp.shareMessage(id)` (Bot API 8.0)
- Server: `savePreparedInlineMessage(user_id, result: InlineQueryResult, allow_user_chats?, allow_bot_chats?, allow_group_chats?, allow_channel_chats?)`
  → `PreparedInlineMessage {id, expiration_date}` ("Expired prepared messages can no longer be used"; the TTL is not documented).
  `user_id` binds the message to one user. Only that user's client can open it.
- Client: `WebApp.shareMessage(msg_id, cb)`, available from 8.0. The script throws `WebAppMethodUnsupported` below 8.0, and
  `WebAppShareMessageOpened` if a share dialog is already open (`tg-web-app.js:3269-3281`). It opens the **native chat picker**
  with a preview. Callback `true/false`; events `shareMessageSent`, `shareMessageFailed {error: UNSUPPORTED | MESSAGE_EXPIRED}`.
- Which result carries the **file**:
  - `InlineQueryResultCachedDocument {type:"document", id(1-64 B), title, document_file_id, description?, caption ≤1024, parse_mode, reply_markup}`.
    It works for **any** file type (PPTX/DOCX/XLSX/ZIP/PDF) but needs a **`file_id`**.
  - `InlineQueryResultDocument` (by URL): "only .PDF and .ZIP files", mime `application/pdf|application/zip`. It would also
    need a public URL, so it is not useful here.
  - `InlineQueryResultCachedPhoto {photo_file_id, caption, …}` for image tools. `InlineQueryResultCachedAudio` for MP3.
- **How to get the `file_id`:** upload once with multipart `sendDocument` and read `message.document.file_id`
  (`photo[-1].file_id` for photos). Facts: no size limit when resending by `file_id`; the type cannot change
  (document↔photo); file_ids are per bot ("can't be transferred from one bot to another"); several valid ids may exist for one file.
  Where to upload:
  1. into the user's own bot chat. This is exactly «Saqlash» (#3), so a share then reuses the same id.
  2. into a private **storage channel**, where the bot is admin, with `disable_notification`. This works for users who never opened the bot chat.
  3. into the user's chat followed by `deleteMessage`. Not recommended: the user sees a flash and gets a notification.
- Buttons in the shared message: `url` buttons only. `web_app` buttons are "Available only in private chats between a user
  and the bot", so they cannot be used in a group or another person's chat.
- **Inline mode:** the Bot API docs do not say that `savePreparedInlineMessage` needs inline mode. Third-party guides
  (e.g. clawhub tg-miniapp skill) say "Enable inline mode: @BotFather → /setinline" and that `prepared_message_id` is
  **single-use**. Treat both as required/likely until checked once on the real bot (OWNER action, see Q1).
  The design prepares a fresh id per tap anyway.
- Client support: Telegram iOS/Android/Desktop/macOS ≥ 8.0 era clients (Nov 2024+). Older clients and `UNSUPPORTED`
  fall back (§2d).

### 2b. `switchInlineQuery` (6.7) / `switchInlineQueryChosenChat` (inline keyboard)
- `WebApp.switchInlineQuery(query, ['users','groups','channels'])` throws `WebAppInlineModeDisabled` unless the client
  passed `tgWebAppBotInline`, i.e. inline mode is on (`tg-web-app.js:2884-2893`). After the user picks a chat, the client
  sends an `inline_query`. We would need an `inline_query` handler and `answerInlineQuery` that resolves the query
  (e.g. a one-time token) into a `CachedDocument`. That is more moving parts (webhook `allowed_updates`, token, latency)
  for no gain over 2a. Use it only as a fallback for 6.7–7.x clients, if at all.

### 2c. `https://t.me/share/url?url=…&text=…` via `WebApp.openTelegramLink`
- Link only, no file. Since Bot API 7.0, `openTelegramLink` does **not** close the Mini App. Recipients cannot open
  `/uz/files/<id>` (owner-only), so the only useful URL would be a new public/signed view, which is out of scope.
  Not recommended for documents. It stays fine for game links (`/o/<token>`).

### 2d. Fallbacks
- In Telegram < 8.0 or on `UNSUPPORTED`: do «Saqlash» (send to the bot chat). The user then forwards the message natively:
  long-press → Forward. Copy: «Fayl bot chatiga yuborildi — u yerdan istalgan chatga uzating».
- Outside Telegram: **Web Share API Level 2** — `navigator.canShare({files:[file]})` then `navigator.share({files, title, text})`.
  Constraints:
  - Requires HTTPS and transient user activation (~5 s). Fetching a 5–25 MB file *after* the tap and then calling `share()`
    often fails with `NotAllowedError`. So the flow is two taps: «Tayyorlash…» fetches the Blob, then «Ulashish» calls
    `share()` synchronously.
  - Chromium only allows audio/image/pdf/video/text extensions, so `canShare` is false for **DOCX/PPTX/XLSX** on Android
    Chrome and desktop. Safari iOS is more permissive. Always feature-detect; never hard-code.
  - Firefox desktop and many in-app webviews have no file share.
  - Last fallback: «Havolani nusxalash» is only meaningful for game links. For documents fall back to «Yuklab olish»
    (R1) plus a hint.
- Android Telegram's WebView: do not rely on `navigator.share`. Inside Telegram always use 2a.

## 3. Bot API for «Saqlash» (#3)
- `sendDocument(chat_id, document: InputFile|file_id, thumbnail?, caption ≤1024, parse_mode, reply_markup, disable_content_type_detection, protect_content, disable_notification…)`.
  - Multipart limit 50 MB (photos 10 MB via `sendPhoto`); by URL 20 MB, and for `sendDocument` by URL only PDF/ZIP; by `file_id`, no limit.
    Our 25 MB cap fits. `thumbnail` only works on a multipart upload (`attach://thumb`, JPEG, <200 kB, ≤320 px).
  - Per mime: pptx/docx/xlsx/zip/pdf → `sendDocument` (+`disable_content_type_detection`). png/jpeg ≤10 MB → `sendPhoto`
    (recompressed!) or `sendDocument` to keep the original (OWNER Q3). mp3 → `sendAudio`; wav → `sendDocument`.
  - Keep `message.document.file_id` + `file_unique_id` (schema below). A second save, from any device, is then a 300-byte
    JSON resend. If the resend by `file_id` fails with 400 "wrong file identifier" (bot token rotated), re-upload and
    overwrite the cache.
- **Closing:** there is **no `minimize()`**. Telegram ≥ 8.0 lets the *user* minimise (`isActive`, `activated/deactivated`
  events only). `WebApp.close()` closes the app. When it was launched from the bot chat, the user lands in exactly the chat
  where the file just arrived, which is the owner's wish. `openTelegramLink('https://t.me/<bot>')` opens the bot chat without
  closing (≥7.0). On 8.0+ mobile clients this effectively leaves the app minimised in the tab bar; device check needed.
  Do **not** auto-close while a leave guard is pending (closing confirmation, `MiniAppBridge.tsx:187-195`). The server
  re-renders first anyway (`ensureFreshFileShared`).
- **Users who can't receive:** a Mini App opened from a direct link or the attachment menu by someone who never pressed
  /start, or a user who blocked the bot, gets 403 ("bot can't initiate conversation" / "bot was blocked by the user").
  - Client pre-check: if `initDataUnsafe.user.allows_write_to_pm !== true` and `isVersionAtLeast('6.9')`, call
    `WebApp.requestWriteAccess(cb)` first. The native popup returns `allowed|cancelled`.
  - Server: map 403 → `409 {code:"bot_unreachable"}`. The UI then shows «Bot sizga yoza olmadi — botni oching va /start bosing»
    with a button `openTelegramLink('https://t.me/<bot>')`. Plain link, see the /start trap.
  - Do not persist "blocked" state: it changes outside our control.
- **Web users:** with `telegramId` (Login Widget or bot link) «Telegram'ga yuborish» works from a normal browser as well, which
  is a good feature. Without `telegramId` (local/OTP) the button is hidden.
- **Rate limits:** Telegram allows about 1 msg/s per chat (short bursts tolerated), about 30 msg/s globally (broadcast uses 25),
  and 20/min in groups (not ours).
  - Our limits: `limit("tgsave:<user>", 20, 3600)` and `limit("tgshare:<user>", 30, 3600)`.
  - A PDF variant also goes through the existing `pdf:` (10/10 min) and soffice gate (503). A stale PPTX goes through
    `filerender:` (30/h).
- **Idempotency / double tap:** the client disables the button while in flight. The server runs a single-flight per
  `user:gen:format`, copying `fresh-file.ts:42-82`, so a parallel second request awaits the first and returns
  `{duplicate:true}`. A DB debounce (`saved_at` within 20 s for the same `file_version`) also returns `{duplicate:true}`
  without sending again.
- **Load and cost:** the bytes are already in Postgres. The first upload reads ≤25 MB from the DB (the same as a download)
  and pushes it to api.telegram.org: about 2× the file in RAM briefly, plus 2–10 s of upstream bandwidth, with no LibreOffice
  unless PDF. Later saves and every share are tiny JSON calls. Telegram storage costs nothing; there is no paid API.
  - Use a separate transport timeout for uploads (60–90 s) and `maxDuration ≥ 90` on the save route.

## 4. Security
- **Ownership in SQL:** reuse `getGenerationFile(id, user.id)`, which already has `JOIN generations … user_id=$2 AND status='COMPLETED'`,
  and `ensureFreshFileShared(id, user.id)`. The `telegram_files` cache is read only through a join on `generations.user_id`.
  A leaked `file_id` is harmless outside our bot, but it is still never sent to the client.
- **Recipient fixed by the server:** `chat_id` / `user_id` always come from the session's `telegramId`, never from the body
  (the IDOR lesson from `messageUser`). POSTs are Origin-checked (`lib/server/api.ts:172`). UUID regex as in the existing routes.
- **Webview/session mismatch:** `MiniAppBridge` keeps an existing session even when the webview belongs to a *different*
  Telegram user (`MiniAppBridge.tsx:66-68`). Then the prepared message is bound to the session user and fails in this client,
  and a «Saqlash» lands in the other person's chat.
  - Client guard: if `initDataUnsafe.user.id !== user.telegramId`, disable both buttons and show «Bu Telegram akkaunti
    boshqa SlaydX akkauntiga kirgan».
  - Optional hardening: send `initData` along, have the server verify it with `verifyMiniAppInitData`, and require
    `profile.telegramId === user.telegramId`.
- **No token leakage:** the token stays only in the URL path of server-side fetches (the proof asserts it is in no body).
  Never log the request URL; the existing `console.warn` logs only method + description. No public file URL is needed in
  this design. If R1 adds a signed public URL for `WebApp.downloadFile` (it requires HTTPS without cookies; Telegram
  recommends `Content-Disposition: attachment` + `Access-Control-Allow-Origin: https://web.telegram.org`), use an
  HMAC(`sessionSecret`) token, ≤10 min, bound to gen+format+file_version.
- **Storage channel (if Q2=a):** private, only the bot and the owner as members. It holds copies of user files, which is a
  privacy point to mention in /privacy. Do not reuse an existing public channel.
- **Audit/logging:** structured `log("tg.save"|"tg.share", {userId, genId, format, result, tgCode})`. An admin stats row
  is optional (the owner wants telemetry): `telegram_files.saves/shares` counters are enough. No content is logged.
- Bot API 10.0: Mini App methods are blocked from foreign origins (enforced since 2026-07-20). Our app is same-origin, so
  nothing to do. Keep CSP `frame-ancestors` as is.

## 5. Proposed design / contract

**Migration `035_telegram_files.sql`** (additive):
```sql
CREATE TABLE IF NOT EXISTS telegram_files (
  generation_id  UUID NOT NULL REFERENCES generations(id) ON DELETE CASCADE,
  format         TEXT NOT NULL,            -- 'native' | 'pdf' | R1 format ids
  file_version   INT  NOT NULL,            -- generations.file_version at upload; stale → re-upload
  media          TEXT NOT NULL CHECK (media IN ('document','photo','audio')),
  file_id        TEXT NOT NULL,
  file_unique_id TEXT,
  size_bytes     BIGINT,
  saved_at       TIMESTAMPTZ,              -- last «Saqlash» (debounce)
  saves          INT NOT NULL DEFAULT 0,
  shares         INT NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (generation_id, format)
);
```

**`lib/server/telegram.ts`**: make the transport reusable. Add `callBot(method, payload, {multipart?, timeoutMs?})`
returning `{ok:true,result}|{ok:false,code,description}`, keeping 429-once and `TelegramTransientError`. Export a
`publicAppLink()`.

**`lib/server/telegram-files.ts`** (new, deep module; the functions are proven in `r2/proof-bot-requests.mjs`):
- `mediaKindFor(mime,size)`, `buildCaption`, `backLinkMarkup`, `buildUploadForm`, `buildResendJson`, `fileIdFromMessage`, `buildPrepared`.
- `ensureTelegramFile(gen, user, format) → {fileId, media}`: cache hit when `file_version` matches. Otherwise materialize the
  bytes via R1's format provider (`native` = `getGenerationFile`, `pdf` = the pdf cache), upload to the target chat (user
  chat for save, storage chat for share-without-save) and upsert the row.
- `saveToBot(genId, user, format)`: if the cache was just populated by an upload *to this user's chat*, done. Else resend by
  `file_id` to `user.telegramId`.
- `prepareShare(genId, user, format) → {id, expiresAt}`: `ensureTelegramFile`, then `savePreparedInlineMessage` with
  `user_id = Number(user.telegramId)`, `allow_user_chats/group/channel = true`, `allow_bot_chats = false`.
- Every function takes `deps` (fetch, now) for tests, like `fresh-file.ts`.

**Routes** (thin, `handler`/`requireUser`, UUID check):
- `POST /api/generations/[id]/telegram/save` `{format?}` → `200 {ok, duplicate?, botUrl}` | `409 no_telegram|bot_unreachable|not_ready` | `429` | `503 telegram_unavailable`. `maxDuration=90`.
- `POST /api/generations/[id]/telegram/share` `{format?}` → `200 {preparedId, expiresAt}` | the same errors | `501 share_unavailable` (inline mode off / prepare failed).

**Client:**
- `lib/telegram-webapp.ts` (new): typed accessor `getTelegramWebApp()` plus a pure `shareCapability({inTelegram, version, hasTelegramId, canShareFiles})`
  → `"tg-prepared" | "tg-save-forward" | "web-share-files" | "download-only"`, and `saveCapability → "tg-close" | "tg-toast" | "web-toast" | "hidden"`.
- `components/files/ShareButton.tsx`: «Ulashish». Flow: POST share, then `shareMessage(id, ok => …)`.
  - On `UNSUPPORTED`/<8.0: «Saqlash» + forward hint.
  - On web: two-tap Web Share flow, then download fallback.
- `components/files/SaveToBotButton.tsx`: «Telegram'ga saqlash». Flow: optional `requestWriteAccess`, POST save, toast, then
  `WebApp.close()` (Q5).
- Both take `format` from R1's sheet. Recommended: the same sheet component with `mode: "download" | "share" | "save"`,
  the native format pre-selected and shown first. A one-format tool skips the sheet.

**Uzbek copy:**
- Buttons: «Ulashish», «Telegram'ga saqlash» (short: «Saqlash»).
- Progress: «Fayl tayyorlanmoqda…», «Telegram'ga yuklanmoqda…».
- Save success: «✅ Fayl bot chatiga yuborildi».
- Share success: «Ulashildi».
- Share fallback: «Bu Telegram versiyasida to'g'ridan-to'g'ri ulashib bo'lmaydi — fayl bot chatiga yuborildi, u yerdan uzating».
- Bot unreachable: «Bot sizga yoza olmadi. Botni ochib /start bosing, so'ng qayta urinib ko'ring.» + [Botni ochish]
- No Telegram on the account: «Telegram akkaunti bog'lanmagan».
- Account mismatch: «Bu Telegram akkaunti boshqa SlaydX akkauntiga kirgan».
- Rate limited: the existing «Juda ko'p so'rov…».
- Caption (HTML, ≤1024): `<b>{sarlavha}</b>\n{vosita} · SlaydX yordamida tayyorlandi` + url button «SlaydX'da ochish» → `https://t.me/<bot>` (Q4).

## 6. Root causes, packages, owner questions, risks

**(a) Root causes:**
- The bot transport is JSON-only, swallows error codes, and has a 15 s timeout.
- There is no `file_id` cache and no Mini App API surface beyond BackButton.
- No public view of a document exists, so link sharing is meaningless.
- `/start <payload>` is overloaded as the login nonce.
- `allows_write_to_pm` is ignored.

**(c) Work packages** (no overlapping files; R1 owns the format sheet, `ResultView.tsx` and the download pipeline):

| WP | Files (exclusive) | Model |
|---|---|---|
| T1 Bot transport + bot fixes | `lib/server/telegram.ts` (`callBot`, multipart, error codes, upload timeout; `/start` non-nonce payloads such as `s_*` → WELCOME instead of «eskirgan»; optional `inline_query` → empty `answerInlineQuery` with a «SlaydX'ni ochish» button once inline mode is on), `tests/telegram-transport.test.ts` | sonnet |
| T2 telegram-files core | `lib/server/telegram-files.ts`, `lib/server/migrations/035_telegram_files.sql`, `tests/telegram-files.test.ts` (port of the proof + DB tests on `slaydx_<wp>`) | opus |
| T3 API routes | `app/api/generations/[id]/telegram/save/route.ts`, `…/telegram/share/route.ts`, `tests/telegram-routes.test.ts` | sonnet |
| T4 Client capability + buttons | `lib/telegram-webapp.ts`, `components/files/ShareButton.tsx`, `components/files/SaveToBotButton.tsx`, `lib/telegram-share-client.ts` (fetch wrappers, kept out of `api-client.ts` to avoid colliding with R1), `tests/ui/share-save.test.mts`, Playwright smoke with the `tgapp.cjs` stub (stubbed `shareMessage`/`close`/`requestWriteAccess`) | sonnet |
| T5 Integration (after R1) | the R1 sheet/`ResultView.tsx` hook-up only. Done by R1's package owner or sequenced after it | lead |

Order: T1 → T2 → T3; T4 runs in parallel against the contract; T5 last. Every parameter gets a differential test (format → different
upload, `allow_*` flags present).

**(d) OWNER questions:**
1. *Inline mode in @BotFather (`/setinline`, placeholder e.g. «SlaydX…»)?*
   - (a) **Enable it, recommended.** Likely needed for `shareMessage` and harmless; T1 answers stray inline queries.
   - (b) Don't; «Ulashish» then becomes save + forward.
2. *Where to obtain the `file_id` for a share without a prior save?*
   - (a) **A private storage channel** (bot is admin, `TELEGRAM_STORAGE_CHAT_ID`), recommended.
   - (b) Upload into the user's own bot chat: share then implies save, which needs no setup but adds clutter.
   - (c) Upload, then delete the message.
3. *Default format for Ulashish/Saqlash?*
   - (a) **Native** (PPTX/DOCX/XLSX/MP3; images as *document*, to keep quality) with the R1 sheet for PDF etc., recommended.
   - (b) Always PDF (opens in-app everywhere, but costs LibreOffice and is not editable).
   - (c) Always ask in the sheet.
4. *Link back in the caption?*
   - (a) **Plain `https://t.me/<bot>`**, recommended.
   - (b) A Main Mini App direct link `t.me/<bot>?startapp` (requires Main Mini App setup in BotFather).
   - (c) Site home `https://slaydxx.uz/uz`.
   - (d) No button.
5. *After «Saqlash» inside Telegram?*
   - (a) **Toast, then auto `close()` after about 1 s** (lands in the bot chat), recommended.
   - (b) Toast with a «Chatga o'tish» button (stays open).
   - (c) Toast only.
6. *Allowed share targets?*
   - (a) **Users + groups + channels**, recommended.
   - (b) Users only.
7. Caption wording: approve the copy in §5, or give your own.

**(e) Risks:**
- The inline-mode requirement and single-use prepared ids are not confirmed by the official docs. Needs one owner-run check
  on the real bot; never from an agent.
- Old clients (<8.0) and Telegram Web/Desktop variants can return `UNSUPPORTED`; the fallback path must be tested.
- A cached `file_id` becomes invalid after a bot token change; the re-upload fallback is needed.
- A 25 MB upload in a web request takes 2–10 s, possibly more on a slow uplink. The timeout must be raised, and the user
  needs progress feedback (owner pain point #1).
- PDF variants inherit soffice gate 503s and limits.
- Webview user vs session user mismatch: a file could go to the wrong chat without the client guard and optional initData check.
- Web Share needs transient activation, and Chromium blocks DOCX/PPTX from file share.
- A storage channel concentrates copies of every shared file (privacy). It must stay private.
- `/start` payload collision: a share link with `?start=` currently answers «havola eskirgan» until T1 fixes it.
- UTF-8 filenames (ʻ, ‘) in multipart `filename` should be checked once on a real client (Node FormData sends raw UTF-8).
