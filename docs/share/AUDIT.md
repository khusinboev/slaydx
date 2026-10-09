# Share everywhere — audit (branch `fix/share-everywhere`, base `origin/main` a4e0e95)

Owner report: «Ulashish» works on phones but not on PCs/laptops. Cause in one line: every web
share entry point leans on the Web Share API (`navigator.share`), which is missing or partial on
desktop, and none of them has a real fallback UI.

Facts checked (not assumed):

- Headless Chromium on Linux (what a Linux Chrome user has): `typeof navigator.share ===
  "undefined"`, `typeof navigator.canShare === "undefined"` (probe run for this audit).
- Firefox desktop: no Web Share at all. Windows Chrome/Edge and macOS Safari: `navigator.share`
  exists; Chromium refuses DOCX/PPTX/XLSX in `canShare({files})` on every OS (R2 §2d).
- Inside Telegram the app already has its own share route (`openTelegramLink`
  `t.me/share/url`, `shareMessage`), which works on phone and on Telegram Desktop clients that
  expose `Telegram.WebApp` (script loaded by `MiniAppBridge`).

Columns: **Phone** = phone browser, **Desktop** = desktop browser without Web Share (Firefox, Linux
Chrome) — Windows/macOS browsers with Web Share behave like Phone, **TG phone** / **TG desktop** =
Telegram Mini App on phone / Telegram Desktop.

## 1. Web share entry points

| # | Entry point (file:line) | Shares | Phone | Desktop (no Web Share) | TG phone | TG desktop | What breaks |
|---|---|---|---|---|---|---|---|
| 1 | Result header «Ulashish» — `components/files/ResultActions.tsx:291` → `onSharePress` `:196` → `useShareAction.run` `components/files/ShareButton.tsx:228` | the generated FILE (never a link) | PDF/PNG…: two-tap `navigator.share({files})` (`:246`); DOCX/PPTX on Chromium: `canShare` false → `download-only` | `download-only` ALWAYS: toast «Bu brauzer faylni ulasha olmaydi…» (`ShareButton.tsx:84`). Several formats: download list opens. ONE format: the file downloads at once, no menu at all | `tg-prepared` (≥ 8.0, linked account): `shareMessage` picker — works; < 8.0 `tg-save-forward`; no account `download-only` | same as TG phone | desktop is a dead end: no choice, no explanation beyond a toast, the single-format case saves a file nobody asked for. A rejected `share()` (second tap) shows an error toast and starts a download |
| 2 | «⋯ → Boshqa formatda ulashish…» — `ResultActions.tsx:348` | file | same as #1 | same as #1 | same as #1 | same as #1 | same |
| 3 | Share sheet rows — `components/files/DownloadSheet.tsx:549` (`SendRow`) → `ResultActions.pick :240` | file in a chosen format | per format via `canShareFile` | n/a (sheet only opens when something is shareable, else #1) | same as #1 | same as #1 | a format the browser refuses switches the sheet to the download list (works) |
| 4 | Referral card «Ulashish» — `components/profile/ReferralCard.tsx:126` (Hamyon tab, profile) | referral link: bot deep link `https://t.me/<bot>?start=ref_<code>` or `<app>/uz?ref=<code>` — public by design, random code, no auth data | `navigator.share({title,text,url})`; AbortError ignored; other error → silent copy | no `navigator.share` → silently runs «Nusxalash»: only a 13 px line «Havola nusxalandi» under the buttons; no Telegram option, no sheet. Looks like nothing happened | `openTelegramLink(t.me/share/url…)` — works | same call — works when `Telegram.WebApp` is loaded; otherwise falls to the desktop row | desktop: no fallback UI; a `share()` rejection other than Abort silently copies outside the tap |
| 5 | Referral card «Nusxalash» — `ReferralCard.tsx:121`, own `copyText` `:30` | same link | Clipboard API, else select + `execCommand` | same | same | same | works; copy implementation duplicated (3rd copy in the repo) |
| 6 | Teacher game link panel — `components/files/GameSharePanel.tsx` (copy `:194`, button `:282`, QR `:154`) | public game link `/o/<token>` (the intended student link) + QR | copy only; NO «Ulashish» (teacher cannot hand the link to Telegram/WhatsApp from the phone sheet) | copy only; no share, no Telegram | copy only | copy only | `navigator.clipboard?.writeText(...).then(...)` — when `navigator.clipboard` is undefined (HTTP, old webviews) `undefined.then` throws inside the click handler: nothing happens, no message. No `execCommand` fallback |

## 2. Telegram-side share (server-built, not touched)

| Where | What | Status |
|---|---|---|
| `lib/server/bot/screens.ts:272`, `lib/server/bot/bonus.ts:83` | inline-keyboard `url: t.me/share/url?…` («Do'stlarga yuborish», bonus «taklif» task); `copy_text` when the link is not public https | native Telegram buttons — identical on every Telegram client incl. Desktop. No change |
| `lib/server/bot/profile.ts:127` | `copy_text` invite link | native. No change |
| `lib/server/telegram-files.ts:221` (`savedMarkup`), `lib/server/telegram.ts:774` | «📤 Ulashish» `switch_inline_query` under a saved file; inline answer resolves the file for its owner | native on all clients. No change |
| `app/api/generations/[id]/telegram/share/route.ts` | prepared inline message behind #1 `tg-prepared` | back end of #1. No change |
| `app/api/generations/[id]/share/route.ts` | creates/lists game links (`/o/<token>`) behind #6 | no change |

## 3. Not share actions (checked, left alone)

- `components/admin/ui/CopyButton.tsx:8` — admin copy of ids / request ids / the admin enrol URL
  (a private link that must NOT be shared). Copy-only is correct; its `copyText` (textarea
  fallback) is the second duplicate of the clipboard code and is folded into the shared helper.
- `SaveToBotButton.tsx:182 openBotLink`, `ResultActions.tsx:480` toast «Botni ochish»,
  `MiniAppBridge.tsx:423`, `ChannelGate.tsx:115` — OPEN a t.me link (bot / channel), no sharing.
- `WalletPage.tsx:132` «Do'st taklif qilish», `ProfileHome.tsx:93` — scroll/navigate to #4.
- Personal sign-in links (`?bt=`) are created only by the bot server code and are opened, never
  shared; the web client never reads or forwards `bt`. There is no public/signed URL for a
  generated FILE (downloads are owner-only, `/api/dl/<token>` is self-authorising), so the file
  share can never offer a link — its fallback is «Yuklab olish».

## 4. Downloads on desktop / Telegram Desktop («Yuklab olish», «Saqlash»)

Static review of `lib/downloads/deliver.ts`, `lib/telegram-webapp.ts` (`downloadCapability`), R1
and the existing tests, plus the desktop Chromium smoke of this branch:

- Desktop browser: `downloadCapability` = `browser` → fetch with % progress → `<a download>`;
  works in Chrome/Edge/Firefox/Safari. Nothing to fix.
- Telegram Desktop ≥ 8.0: `Telegram.WebApp.downloadFile` (tdesktop has the downloads panel);
  < 8.0: «Botga yuborish» / «Brauzerda ochish» fallback rows. Nothing to fix.
- «Saqlash» is shown only for a session with a Telegram id; in a browser it toasts «Fayl bot
  chatiga yuborildi», in Telegram it closes the Mini App after ~1 s. Works on desktop.
- Verdict: no defect found; no change made to download/save logic.

## 5. Plan

1. `lib/share.ts` (env-injected, unit-tested): `shareLink` (Telegram sheet in Mini App → native
   `navigator.share` → «fallback»), AbortError = cancelled, any other error = fallback;
   `canShareFile`/`canShareFiles`; `copyToClipboard` (Clipboard API → selected field/hidden
   textarea + `execCommand`); `openTelegramShare`; `isShareableUrl` (rejects `bt=`, `/api/dl/`,
   Telegram launch fragments).
2. `components/share/ShareMenu.tsx` + `useLinkShare` — the fallback sheet: «Havolani nusxalash»,
   «Telegramda ulashish»; `useDialog` (Esc, focus trap, back button), rows ≥ 44 px, bottom sheet
   on phones / centred card on md+, theme tokens (light + dark), «Nusxalandi» confirmation.
3. Migrate #4, #5 (+admin copy), #6 (new «Ulashish» button), #1–#3 (`canShareFile` from the helper;
   the nothing-shareable case opens the download list instead of auto-downloading a single file).
4. Tests: unit (`tests/share.test.mts`), UI per entry point, two mutations, Playwright smoke at
   1366 px and 390 px, light and dark.

## 6. Result (what changed per environment)

| Entry point | Phone browser (Web Share) | Desktop without Web Share | TG phone | TG desktop |
|---|---|---|---|---|
| Referral card «Ulashish» | unchanged: `navigator.share({title,text,url})`; cancel = silent | **fallback menu**: «Havolani nusxalash» (toast-style «Nusxalandi»), «Telegramda ulashish» (new tab) | unchanged: `openTelegramLink(t.me/share/url…)` | same as TG phone |
| Game panel | **new «Ulashish»**: same flow as above (link + title + text) | menu | Telegram's sheet | same |
| Game panel «Nusxalash» | works without `navigator.clipboard` (used to throw) and says so when every route fails | same | same | same |
| File «Ulashish» (result header, «⋯», sheet rows) | unchanged (two taps, `navigator.share({files})`) | download list + reason toast; a ONE-format file is no longer saved unasked; a failed second tap says «Ulashib bo‘lmadi…» and downloads | unchanged (`shareMessage`) | unchanged |

Decisions: icons (lucide `Link2`, `Send`) instead of emoji, matching the rest of the UI; a file has no
public link, so its fallback is the existing download list (`DownloadSheet`, 56 px rows, focus trap,
Esc) rather than a second menu. The link menu is a bottom sheet below `sm`, a centred card above.

Verification (branch `fix/share-everywhere`):

- `tests/share.test.mts` 20/20; `tests/ui/share-everywhere.test.mts` 31/31; `save-share-formats` 31/31
  (4 new), `referral-card` 10/10 (one assertion rewritten: «without Web Share → copy» became «→ the
  menu, and «Havolani nusxalash» copies»), `result-actions` 33/33, `game-share-panel` 11/11,
  `panel-container` 15/15 (the game panel uses `@md:` container variants, not viewport ones).
- Mutations, each red then restored: fallback removed (17 UI tests), AbortError as error (5 tests),
  menu without `useDialog` (2), single-format auto-download restored (1), `?bt=` allowed (3), Telegram
  sheet skipped (2), unit-level fallback removed (4).
- Chromium smoke (real Chrome 153 on Linux = no `navigator.share`; 1366×768 and 390×844 @3x touch, light and
  dark; API answered by route fixtures, dev server without a database): 156/156 checks, covering the
  menu in view, ≥ 44 px controls, no horizontal overflow, the clipboard holding the exact link,
  execCommand route when the Clipboard API is denied, Telegram tab URL, focus trap / Esc / focus return,
  Web Share unchanged, AbortError silent, Telegram Desktop stub, and the file flows including a real
  browser download from «Yuklab olish».
