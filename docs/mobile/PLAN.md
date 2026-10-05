# Mobile sprint — plan, owner decisions, contracts

Branch `feat/mobile` (from `main` = prod `060e731`). Most users open SlaydX as a Telegram Mini App on a phone,
so every change is designed for 360–412 px touch screens inside the Telegram webview first; desktop must not regress.

Research (read-only, local test DB, synthetic data): `R1-download.md`, `R2-telegram-share.md`,
`R3-mobile-editing.md`, `R4-essay-level.md`, `R5-phone-audit.md`.

## 1. Owner requests
1. One «Yuklab olish» button → sheet with the formats that fit the tool → file saved on the device; slow
   downloads must show progress (today users think the app froze).
2. «Ulashish» → Telegram chat picker → the content itself is posted into the chosen chat.
3. «Saqlash» → the Mini App closes and the bot sends the material into the user's bot chat.
4. Phone-friendly slide text editing: the style block must be compact and never cover the edited text.
5. Essay CEFR level A1–C2 that controls sentence complexity and terminology.
6. Main condition: every screen optimal on a phone inside the Mini App.

## 2. Key findings
- **Downloads save nothing inside the Telegram Mini App on phones** (R1 §4): we fetch → blob → `<a download>`;
  Android bot webviews have no download handler, iOS only handles `.pkpass`. The fix is `WebApp.downloadFile`
  (Bot API 8.0) with a short-lived signed HTTPS URL (the Telegram client downloads without our cookie; iOS sends HEAD
  first; Android ignores calls later than 10 s after a touch).
- The PPTX itself is served in ~0.1–0.2 s; the felt slowness is network (5–10 MB decks, no progress) plus synchronous
  PDF (LibreOffice 1.5–3 s locally, queue up to 20 s, 90 s timeout above nginx's 60 s → 504 risk).
- Bot transport is JSON-only, swallows error codes; no upload path; `/start <payload>` is always treated as a login nonce;
  inline mode of `@SlaydX_bot` is **off** (`getMe.supports_inline_queries = false`, checked 2026-10-04).
- Slide style panel covers the edited text by 33–100 % at 390 px (R3 §2), 16/16 controls < 44 px, runs off-screen in
  zoom mode; no keyboard (visualViewport) handling anywhere; editing opens only on double tap without a hint.
- Essay: no level today; polish/«Tuzatish» rebuild from `doc.essay`, so the level must live in `EssayModel`; four
  places push text upward (judge, thesis/topic-sentence minimums, figurative/hedging guidance, free-text `extra`).

## 3. Owner decisions (2026-10-04)
| # | Question | Decision |
|---|---|---|
| O1 | Formats per tool | **Wide set** (R1 §3): native + PDF where it applies; slides also PNG images (ZIP); images PNG/JPG; glossary and game results CSV; audio transcript TXT |
| O2 | Where the file is uploaded for «Ulashish» | **Into the user's own bot chat** (share ⇒ also saved; no storage channel) |
| O3 | Essay level default / IELTS | **B2 default; IELTS has no level control** (band-style C1) |
| O4 | Slide text edit gesture on touch | **Double tap (reliable detector) + one-time hint**; the edited text auto-zooms on phones |
| — | Already stated by the owner | «Saqlash» closes the Mini App; style controls sit at the top edge of the frame |

Phone audit decisions (R5, owner 2026-10-05):
| # | Question | Decision |
|---|---|---|
| O5 | Touch targets | **44 px everywhere on touch** (global coarse-pointer rule; some chip rows get taller) |
| O6 | Duplicate back inside the Mini App | **Hide the in-app «←» inside Telegram**, keep Telegram's BackButton; browsers keep «←» |
| O7 | Home file list on phones | **2-column cards with a 2-line title clamp** |
| O8 | Swipe-to-minimise | **Disable vertical swipes app-wide in the Mini App** (`disableVerticalSwipes`, Bot API 7.7) |
Lead (R5 recommended): form ⓘ hints become tap-to-expand inline hints on touch; inputs ≥ 16 px on touch (no iOS focus
zoom); result header title 2 lines + the single «Yuklab olish»; topbar keeps all icons with 44 px hit areas;
fullscreen Mini App mode out of scope.

Lead decisions (recommended options from the research, owner may override):
- PDF/derived files are prepared when the sheet opens; 24 h derived-file disk cache moved to a docker volume.
- Resume lists PDF first. Slide images ZIP at 150 dpi.
- Fallback when `downloadFile` is unavailable/refused: «Botga yuborish» (same server path as «Saqlash»), then «Brauzerda ochish».
- Share targets: users, groups, channels (no bot chats). Caption button links to `https://t.me/<bot>`.
- After «Saqlash» in Telegram: toast, then `WebApp.close()` after ~1 s. Outside Telegram «Saqlash» is hidden for
  accounts without `telegram_id`.
- Phone style bar replaces the slide toolbar while editing (in-flow, 44 px); font list and size presets in a small
  sheet (chips, no native `<select>` on touch); «Tayyor» commits. Desktop keeps the floating panel with a measured-height
  placement fix.
- Document editors (Word/article/teacher/resume) get a phone «Bekor / Tayyor» bar above the keyboard and a visible
  «Tahrirlash» entry; no global `interactive-widget` viewport change.
- Essay level is shown only in the report panel (not printed in the document); one automatic repair pass when the
  measured text misses the level; a visible one-line caption under the level control; languages uz/ru/en as today.
- Owner action required: enable inline mode for `@SlaydX_bot` in @BotFather (`/setinline`, placeholder «SlaydX…»);
  `shareMessage` may need it. Until then «Ulashish» falls back to save + forward.

## 4. Contracts (binding for all packages)

### 4.1 Format registry — `lib/downloads/formats.ts` (pure, client-safe, single source of truth)
```ts
export type DownloadFormatId =
  | "native" | "pdf" | "slides-png" | "jpg" | "transcript-txt" | "glossary-csv" | "results-csv";
export type DownloadFormat = {
  id: DownloadFormatId; label: string; hint?: string; ext: string; mime: string;
  cost: "instant" | "convert"; needs?: "pdf" | "pdftoppm";
};
export function downloadFormats(
  g: { type: string; format: string; translationKind?: string | null; imageCount?: number; hasResults?: boolean },
  features: { pdf: boolean },
): DownloadFormat[];
```
UI lists exactly these rows; the server rejects any format not returned for that generation. Every id has a server
producer and a differential test (project rule: no decorative options).

### 4.2 Download server
- `POST /api/generations/{id}/download {format}` (cookie, ownership in SQL) → `{state:"ready", url:"/api/dl/<token>",
  fileName, size, mime, expiresAt}` or `{state:"preparing", retryAfterMs}`; 429/503 with Retry-After. No request is held
  longer than ~8 s; soffice timeout ≤ 50 s.
- `GET|HEAD /api/dl/{token}` (no cookie): HMAC token (HKDF from `SESSION_SECRET`, info `download-v1`) binding
  `{g,u,f,v:file_version,exp:+15 min}`; multi-use within TTL; HEAD never converts and never counts; headers
  `Content-Disposition: attachment` (ASCII fallback), `Content-Length`, `Access-Control-Allow-Origin: https://web.telegram.org`,
  `Cache-Control: private, no-store`, `nosniff`, `Referrer-Policy: no-referrer`. Stale `file_version` → 410.
  Minting a link pins its derived file for 20 min; a GET miss regenerates within 45 s, else `503 busy` + Retry-After;
  a HEAD miss never converts (`503` + Retry-After). nginx: `location /api/dl/` with `proxy_read_timeout 120s`.
- Producers in `lib/server/downloads/`; derived files cached by `{genId, sha(bytes), format}`.
- Server-side bytes for any format: `produceDownload(genId, userId, format) → {bytes, fileName, mime}` — the Telegram
  package (4.4) calls this, never its own conversion.

### 4.3 Telegram Mini App client accessor — `lib/telegram-webapp.ts`
Typed `getTelegramWebApp()`, `tgVersionAtLeast(v)`, `downloadFile(params)`, `shareMessage(id)`, `requestWriteAccess()`,
`close()`, `onEvent/offEvent` wrappers, plus pure `shareCapability(...)` / `saveCapability(...)` /
`downloadCapability(...)`. Only this module touches `window.Telegram.WebApp` for these APIs (MiniAppBridge keeps login + BackButton).

### 4.4 Telegram server
- `lib/server/telegram.ts`: `callBot(method, payload, {multipart?, timeoutMs?})` → `{ok:true,result} | {ok:false,code,description}`;
  keep 429-once retry and `TelegramTransientError`; `/start <payload>` that is not a login nonce → welcome, not «eskirgan».
- Migration `035_telegram_files.sql` (additive): `(generation_id, format)` → `file_id`, `file_version`, `media`, counters.
- `lib/server/telegram-files.ts`: `saveToBot(genId, user, format)`, `prepareShare(genId, user, format)` (upload into the
  user's own bot chat when no valid `file_id`, then `savePreparedInlineMessage` with users/groups/channels allowed).
- Routes `POST /api/generations/{id}/telegram/save {format?}` and `.../telegram/share {format?}`; errors
  `409 no_telegram|bot_unreachable|not_ready`, `429`, `503 telegram_unavailable`, `501 share_unavailable`.
  Recipient is always the session user's `telegram_id`; the client additionally refuses when the Mini App user differs.
  Also `409 telegram_id_unsupported` (id above 2^53) and `413 too_large`. For a `cost:"convert"` format with neither a
  valid cached `file_id` nor a ready derived file: `202 {state:"preparing", retryAfterMs, format}` — the shared
  background preparation was started; the client repeats the same POST after `retryAfterMs`. Instant serializations
  whose bytes can change without a `file_version` bump (results-csv, transcript-txt, glossary-csv) never reuse a cached
  `file_id`.

### 4.5 Result actions (client)
`components/files/ResultActions.tsx` owns the result header actions: one «Yuklab olish» button (label visible on
phones) + «Ulashish» + «Saqlash» (+ existing delete in the overflow). `DownloadSheet` (`useDialog`, phone bottom sheet /
desktop popover, ≥ 44 px rows, per-row state machine idle → preparing → ready → delivering → done | error) is reused with
`mode: "download" | "share" | "save"`; one-format tools skip the sheet. `lib/downloads/deliver.ts` picks
Telegram `downloadFile` (gesture window tracking, `fileDownloadRequested`), browser fetch with % progress, navigation fallback.

### 4.6 Phone hooks — `lib/hooks/useCoarsePointer.ts`, `lib/hooks/useVisualViewport.ts`
SSR/jsdom-safe (false / window size); `useVisualViewport` returns `{height, offsetTop, keyboardOpen}`, writes `--vv-h`
and `--kb-h` on `<html>`, listens to `visualViewport` and Telegram `viewportChanged`.

## 5. Work packages
| WP | Scope | Files (exclusive) | Model | Depends |
|---|---|---|---|---|
| F0 Foundation | 4.1 registry + tests, 4.3 accessor + tests, 4.6 hooks + tests | `lib/downloads/formats.ts`, `lib/telegram-webapp.ts`, `lib/hooks/*`, tests | opus | — |
| A Download server | 4.2: token, prepare route, `/api/dl`, producers (native, pdf, slides-png, jpg, transcript-txt, glossary-csv, results-csv), derived cache, soffice timeout, `next.config.ts` header rules, compose volume | `lib/server/downloads/*`, `app/api/generations/[id]/download/`, `app/api/dl/`, `lib/server/pdf-cache.ts`, `lib/server/pdf.ts`, `next.config.ts`, `docker-compose*.yml` (volume only), tests | opus | F0 |
| B Telegram server | 4.4 | `lib/server/telegram.ts`, `lib/server/telegram-files.ts`, `lib/server/migrations/035_telegram_files.sql`, `app/api/generations/[id]/telegram/`, tests | opus | F0, A's `produceDownload` signature |
| C Result actions | 4.5: driver, sheet, Share/Save buttons, header integration; ImageViewer tiles, GameSharePanel CSV and TranslationViewer via the driver | `lib/downloads/deliver.ts`, `lib/api-client.ts` (download section), `components/files/{ResultActions,DownloadSheet,ShareButton,SaveToBotButton,ResultView,GameSharePanel}.tsx`, `components/viewers/{ImageViewer,TranslationViewer}.tsx`, tests | opus | F0 (A/B via contract stubs) |
| D Slide editing on phones | R3 S1+S2 | `components/viewers/SlideEditor.tsx`, `components/viewers/slide-edit/*`, `SlideToolbar.tsx`, `SlideStage.tsx`, `SlideViewer.tsx`, `ResultLayout.tsx` (compact-while-editing prop only), tests | opus | F0 hooks |
| E Document editors on phones | R3 D1 | `components/viewers/EditDoneBar.tsx`, `WordViewer.tsx`, `ArticleEditor.tsx`, `resume/ResumeEditor.tsx`, `ResumeViewer.tsx`, `toolbar.tsx`, `editable.ts`, tests | sonnet | F0 hooks, after D merges `ResultLayout` |
| G Essay level | R4 WP1–3 (core level module, engine/review/polish wiring, EssayComposer UI); live harness cases (no runs) | `lib/generation/essay/*`, `lib/generation/essay-params.ts`, `components/forms/EssayComposer.tsx`, `scripts/live-engine.mts` (cases), `scripts/level-measure.mts`, tests | opus | — |
| P12 Touch layer + form primitives | R5 P1+P2: coarse-pointer CSS (44 px hit areas, 16 px inputs), fix the unlayered `* { border-color }` rule that overrides `border-*` utilities, form primitives sizes, tap-to-expand hints | `app/globals.css`, `components/forms/fields.tsx`, `components/forms/compact.tsx`, `components/forms/shared/index.tsx`, tests | sonnet | — |
| P3 Form chrome + keyboard | R5 P3: sticky submit bar vs keyboard, scroll padding, suggestion chips | `components/forms/ToolChrome.tsx`, `components/forms/useKeyboardInset.ts`, `components/shell/AppShell.tsx` (scroll padding only), tests | opus | P12 |
| P4 Shell + topbar | R5 P4: 44 px topbar, drawer, search, notifications, pay/login dialogs | `components/shell/TopBar.tsx`, `Sidebar.tsx`, `components/overlays/*` (not `useDialog.ts` logic), tests | sonnet | P12 |
| P5 Home + catalogue | R5 P5 + O7: 2-column cards, 2-line titles, delete in overflow, catalogue group chips + search | `components/home/*`, `CreateGrid.tsx`, tests | sonnet | — |
| P8 Telegram shell | R5 P8 + O6 + O8: disableVerticalSwipes, header/background colours from theme, hide in-app «←» in Telegram, safe-area vars | `components/telegram/MiniAppBridge.tsx`, `lib/telegram-miniapp.ts`, `components/nav/BackLink.tsx`, tests | opus | — |
| P9 Guard | phone audit script + touch-target tests | `scripts/phone-audit.mts`, `tests/ui/touch-targets.test.mts` | sonnet | P12–P5 |
| (C) | also R5 P6: compact phone result header, 2-line title, FAILED page retry/back | (C files) | | |
| (E) | also R5 P7: viewer toolbars 44 px, resume reading mode, rail text sizes | + `components/viewers/toolbar.tsx`, `reading/*` | | |
| R Reviews | independent reviewers per package: security (A, B), correctness (A–G), UX/phone smoke (C, D, E, P) | read-only | fable / opus | each package |

Order: F0 ∥ G → (A ∥ B ∥ D) → C → E → P → integration + reviews → owner device check → deploy on owner's word.

## 6. Verification
- Every package: typecheck, its own test files, mutation checks on new assertions, Playwright smoke in a Telegram stub at
  360×740, 390×844 (touch, DPR 3) and 1366×768; the stub records `web_app_request_file_download`, `shareMessage`,
  `close`, `requestWriteAccess` calls.
- Integration: full `npm test`, `test:ui`, `test:viewer`, build; CI green.
- Essay level: `npm run live` matrix from R4 §5 (paid, small) before release, with the level measurer.
- Owner device check before deploy: Android + iPhone Telegram — download a PPTX and a PDF, «Ulashish» to a chat,
  «Saqlash», slide text editing with the real keyboard.

## 7. Status
| WP | Status |
|---|---|
| Research R1–R5 | ✅ done |
| F0 Foundation | ✅ merged (`cb5abaf`; registry 16, accessor 21, hooks 18 tests; boundary lock `cd15619`) |
| G Essay level | ✅ merged (19 mutations caught; thresholds to calibrate in the live run) |
| A Download server | ✅ merged (24 mutations; bench: PDF cold 1.4–2.1 s, cached 4–81 ms) |
| B Telegram server | ✅ merged (31/32 mutations; migration 035) |
| D Slide editing | ✅ merged (overlap 33–100 % → 0 % at 360/390) |
| Integration 1 | ✅ npm test 4289/4289, test:ui 1092/1092, test:viewer 251/251 |
| Security review A+B (fable) | APPROVE WITH FIXES → fixed in ABF (`053f011..d75be29`) → re-verified **APPROVE** (proofs 11/11) |
| Correctness review G+D | APPROVE WITH FIXES → fixed (d6666a3, 463792e, e58b39c) → re-verified **APPROVE** |
| C Result actions | ✅ merged (smoke 459/459; 23 mutations) |
| P12 Touch layer | ✅ merged (form targets < 44 px 1378 → 474, inputs < 16 px 336 → 0) |
| P12b Composer targets | ✅ merged (code + tests); TopicChips wiring + audit running |
| P8 Telegram shell | ✅ merged (smoke 78/78; 17 mutations) |
| P3 Form keyboard | ✅ merged (15/15; mutation results re-checked by the UX reviewer) |
| P4 Shell + overlays | ✅ merged (all phone targets < 44 px → 0; 21 mutations) |
| E Document editors | ✅ merged (30/30 after review fixes; E1 double-tap switch fixed) |
| UX review (fable) | APPROVE WITH FIXES → C fixes (M1, M2 + 9 minors), E fixes (E1–E3), lead fixes (m8–m10, rail text, CSP test) |
| GPU smoke launcher | `scripts/smoke/gpu-launch.cjs` (owner-approved, 351fd65) |
| P5 Home + catalogue | ✅ merged (title chars 16→37 @390, small targets 25→0) |
| E, P3, P4, P9, UX review, live essay calibration | next |

## 8. Essay level — live calibration (2026-10-05, 9 essays, gemini-3.7-flash)
| Case | Lang | Level | Mean words/sentence | Verdict (after calibration) |
|---|---|---|---|---|
| acad-en-a2 / b2 / c2 | en | A2 / B2 / C2 | 10.8 / 18.7 / 23.8 | green / green / green |
| acad-ru-b1 / c1 | ru | B1 / C1 | 13.3 / 20.6 | green / green |
| dtm-a1 / default(B2) / c1 | uz | A1 / B2 / C1 | 5.4 / 13.7 / 20.2 | green / green / green (was yellow: uz C1 hi 20 → 23) |
Means rise monotonically with ≥ 20 % gaps in every language. uz C1/C2 bands raised (C1 14–23 target 18, C2 16–28
target 22); other bands unchanged. Not run: `essay-lvl-acad-uz-a2` (paused), `essay-lvl-dtm-b1` doc not saved.
Native-reader check of A1 and C2 Uzbek texts still recommended.

## 9. Release (2026-10-05)
- CI green on `e6383b9` (npm test, test:viewer, test:ui, build); `main` fast-forwarded; DEPLOYED to production.
- Backup `slaydx-20261005-151845.dump` (+ Google Drive); rollback `060e731` + images `slaydx-{web,worker}:pre-mobile`.
- Prod smoke: health 200, pages 200, `/api/dl` 404 with `private, no-store` + ACAO web.telegram.org, 0 errors in web/worker logs,
  migration 035 applied, `derived-cache` volume mounted, ledger mismatch 0.
- nginx unchanged: production `location /` already has `proxy_read_timeout 300s`.
- Bot: inline mode ON (owner); webhook `allowed_updates` = message, callback_query (inline_query answers inactive — optional).
- Pending: owner device check (Android + iPhone): download PPTX/PDF in the Mini App, «Ulashish», «Saqlash», slide/doc editing with the real keyboard.

## 10. Hotfix 1 (2026-10-05) — DEPLOYED `926fcc7`
Owner feedback: (1) saved file in the bot chat now carries «📤 Ulashish» (`switch_inline_query f_<gen32>_<format>`; the bot answers
the owner's inline query with the cached file, ownership in SQL); (2) «Ulashish» never stays loading (settles on return/timeout,
recovers tg-web-app.js's stuck flag via postEvent, Android 10-s gesture re-tap); (3) two Telegram accounts on one phone: a genuine
Mini App whose signed user differs from the session asks «Akkauntni almashtirasizmi?» and switches only on «O'tish» (server:
auth_date ≤ 10 min, never for phone-login sessions). Security review: first REJECT (Android in-app browser login-CSRF) → fixed →
APPROVE. CI green; backup slaydx-20261005-171149.dump; rollback e6383b9 + images :pre-hotfix1 + webhook allowed_updates back to
[message, callback_query]. Webhook allowed_updates now [message, inline_query, callback_query]. Prod smoke: health 200, errors 0, ledger 0.
