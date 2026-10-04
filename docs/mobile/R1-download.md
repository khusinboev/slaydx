# R1 — «Yuklab olish»: one button → format sheet → reliable download (research)

Repo `main` @ `060e731`. Read-only research. Artefacts: `scratchpad/mobile/r1/`
(`bench.mts`, `bench-big.mts`, `bytea.cjs`, `out/results*.json`, generated sample files in `out/`,
Telegram client sources `tg-android-*.java`, `tg-ios-*.swift`, `tdesktop-*.cpp`).
A dev server was not started (R3 and R5 already had 2 running), so there are no screenshots. Every server path
was timed by calling the real functions (`renderPptx`, `toPdf`, `getOrConvertPdf`, `PdfDiskCache`,
`pdftoppm`, pg BYTEA) through `scripts/heavy.sh`. Test DB `slaydx_r1` was created and then dropped.

## TL;DR

1. **Downloads inside the Telegram Mini App on phones save nothing today. That is the "frozen" feeling.**
   `downloadGeneration` does fetch → `Blob` → `URL.createObjectURL` → `<a download>.click()`
   (`lib/api-client.ts:571-636`).
   - **Telegram Android:** bot Mini App webviews get **no `DownloadListener` at all** (`if (!bot) setDownloadListener(…)`), and blob
     URLs are dropped even in the in-app browser (`"we can't get blob binary from webview :("`). Source:
     `r1/tg-android-BotWebViewContainer.java:4963-4984`.
   - **Telegram iOS:** `WKDownload` is handled only for `.pkpass` (`r1/tg-ios-WebAppController.swift:672-727`).
   - What the user sees: the button greys out for the whole fetch (no spinner and no label on a phone), then re-enables, and no file appears.
   - The same applies to the image tile/lightbox `<a download>` (`ImageViewer.tsx:283`) and the results CSV
     `<a download>` (`GameSharePanel.tsx:349`).
2. **The fix is `Telegram.WebApp.downloadFile({url, file_name})` (Bot API 8.0+).** The *Telegram client* downloads the file
   itself: Android uses the system `DownloadManager`, iOS uses `URLSession`, and both show a native progress UI. No cookies or headers are sent,
   so we need a **short-lived signed URL**. There is also an Android rule: the call is ignored silently, with no event, unless it
   comes **within 10 s of a touch** in the webview.
3. **Server time is not the bottleneck for the stored format. File size and network are.**
   - A 15-slide deck with 11 photographic images is **8.1 MB PPTX**.
   - Reading it from Postgres takes **94–146 ms**. A re-render (only after edits) takes **186 ms**.
   - On mobile data the 8 MB body takes 13 s (5 Mbit/s) to 65 s (1 Mbit/s), with no progress shown.
4. **PDF is the slow path.**
   - LibreOffice takes **1.5–3.0 s per conversion locally**: 2.4 s cold, 2.5–3.0 s for the image deck, 1.9 s for a 26-page DOCX.
   - Under load it can also wait up to **20 s** for one of 2 `soffice` slots, and it has a **90 s** timeout behind nginx's **60 s** `proxy_read_timeout`.
   - A second download is a disk-cache hit (**0–9 ms**). The cache is in the web container's `/tmp`, so it is lost on every deploy and expires after 24 h.

## 1. Inventory — current download affordances per tool

Shared parts used by every tool:

| Part | Where | Label / format | Endpoint / transport |
|---|---|---|---|
| **H1** main button | `components/files/ResultView.tsx:529-556` (handler `:142-175`) | «Yuklab olish» + `FORMAT` chip. On a phone (<640 px) it is **icon only**: the label is `hidden sm:inline` and the chip is `hidden md:inline`. | `GET /api/generations/{id}/file` via fetch→blob (`api-client.ts:571`). For a stale file it first calls `POST …/rebuild` (`ensureGenerationFresh`, `api-edit.ts:279`). |
| **H2** PDF button | `ResultView.tsx:567-594` + notice `:622-635` | «PDF» (spinner + «PDF…» while working). Hidden in the compact (scrolled) header. Shown only when `features.pdf` is set and `format ∈ {docx, pptx}` (`:819`). | `GET …/file?format=pdf` (LibreOffice, disk cache) |
| Delete | `ResultView.tsx:595-610` | «O'chirish» | — |

So **H1 + H2 sit side by side** for every docx/pptx tool, while png/zip/mp3/xlsx/txt/md/csv results show **H1 only**.

| Tool (id → slug) | Stored format | Today's affordances | Notes |
|---|---|---|---|
| slide → slide | pptx | H1 PPTX + H2 PDF | Stale after edit → rebuild (render) before download |
| pro-slide → pro-slide | pptx | H1 + H2 | Gemini images ≈ 790 KB each → 5–10 MB files |
| image → rasm | png / jpg (1 image) or **zip** (N images, `image-studio.ts:205-236`) | H1 (PNG or ZIP). For N>1 also per-tile ⬇ (`ImageViewer.tsx:110-112`, `:270-276`) and lightbox ⬇ (`:174-178`), both via `<a download href=/assets/…>` (`:283-295`) | Tile/lightbox `<a download>` does nothing in the Telegram webview. The asset route sends no `Content-Disposition`. |
| infographic → infografika | png | H1 | |
| coursework, referat, mustaqil-ish | docx | H1 + H2 | |
| essay | docx | H1 + H2 | |
| article, thesis | docx | H1 + H2 | rewrite/polish bump `doc_version` → rebuild on download |
| resume | docx | H1 + H2 | PDF is what HR asks for |
| translation | **same as input**: docx/pptx/xlsx/txt/md/csv; PDF input → docx | H1, plus H2 only for docx/pptx. The «Fayl» tab is an `<iframe src=?format=pdf&inline=1>` (`TranslationViewer.tsx:176-195`) | The Android WebView has no PDF renderer, so the iframe is likely blank in the Mini App (not verified on a device) |
| lesson-plan, texnologik-xarita, glossary, keys, test | docx | H1 + H2 | glossary and test are table-shaped (CSV/XLSX would be meaningful) |
| crossword, flashcards | docx | H1 + H2 | printable sheets |
| sorting, listening | docx (printable) | H1 + H2, plus «CSV» results link in the share panel (`GameSharePanel.tsx:347-355`, `<a download>` → `GET …/results?format=csv`) | CSV `<a download>` has the same Telegram problem |
| podcast, greeting | mp3 | H1 MP3. The player streams `…/file?inline=1` (`AudioViewer.tsx:30`) | No transcript export |

There are no download affordances on the files list (`components/home/FilePreview.tsx` only shows `/thumb`) or in admin
(an admin route exists: `app/api/admin/generations/[id]/file`).

## 2. Server side — routes under `app/api/generations/[id]/`

| Route | What it does | Production | Cache / headers |
|---|---|---|---|
| `file` GET | Stored file; `?format=pdf`; `?inline=1` | **Stored BYTEA** (`generation_files`, `storage.ts:85`). Before serving, `ensureFreshFileShared` (`lib/server/fresh-file.ts`) re-renders if `file_version < doc_version` (single-flight, 30/h limit). PDF → `pdfResponse` (`lib/server/pdf-serve.ts`) → `getOrConvertPdf` (`pdf-cache.ts`) → `toPdf` (`pdf.ts`, `soffice --convert-to pdf`, fresh profile per run, 90 s timeout) through `sofficeGate` (2 slots, 20 s wait, 20 waiters, then 503 + Retry-After 15). Per-user PDF limit 10/10 min (429). | `Content-Disposition: attachment` (`inline` with `?inline=1`), RFC 5987 `filename*`, `Content-Length`, `private, no-store`, `Accept-Ranges` for audio (but no real Range support). PDF disk cache: `/tmp/slaydx-pdf-cache`, key = gen id + sha256(bytes), 500 MB LRU, 24 h, single-flight. `maxDuration 60`. Every GET increments `downloads`. |
| `thumb` GET | First-page JPEG | soffice → pdftoppm. **Uses the same `getOrConvertPdf` cache**, so opening the file list already pre-warms the PDF for docx/pptx (until the next deploy) | asset `thumbAssetId(fileVersion)`; `?v=` immutable caching |
| `assets/[assetId]` GET | Slide/image media | stored BYTEA | `max-age=86400, immutable`, no Content-Disposition |
| `results` GET | Game results JSON / `?format=csv` stream | streamed | `attachment; filename="natijalar-xxxx.csv"` |
| `share` POST/GET | Game public link (not a file share) | — | — |
| `doc`, `doc/restore`, `rebuild`, `rewrite`, `polish`, `photo`, `slides/[i]/image` | Editing | `rebuild` = `rebuildFile` (`slide-commit.ts:245`): render + write BYTEA + drop thumb, in a transaction | — |
| `route.ts` GET/DELETE | Detail / delete | — | — |

### Measurements

These are local runs (12-core laptop, LibreOffice 24.2, `heavy.sh`) on a synthetic 15-slide «lecture/atlas» deck covering
title, agenda, bullets, twoCol, stats, process, compare, table, quote and closing layouts. The image variants use 11 distinct 1600×900 JPEGs. Raw data: `r1/out/results.json` and `r1/out/results-big.json`.

| Path | 15 slides, no images | 15 slides, 135 KB images | 15 slides, 720 KB images (≈ Gemini) |
|---|---|---|---|
| PPTX size | 220 KB | 1.7 MB | **8.1 MB** |
| `renderPptx` re-render (only when stale) | 6 ms | 71 ms | 186 ms |
| BYTEA read of the stored file (pg, test DB) | — | — | **94–146 ms** (insert 156 ms) |
| PPTX→PDF `toPdf` (fresh profile) | 1.45 s (first ever 2.36 s) | 1.75 s | **2.5–3.0 s** → 6.0 MB PDF |
| `getOrConvertPdf` miss / **hit (2nd download)** | 1.51 s / **0 ms** | 2.00 s / **2 ms** | 2.85 s / **9 ms** |
| PDF→PNG all pages, pdftoppm 110 dpi | 1.65 s (657 KB) | 3.40 s (3.8 MB) | 3.15 s (7.2 MB) |
| PDF→PNG 150 dpi | 2.77 s | 7.52 s | 5.23 s (12.2 MB) |
| PNG → zip (STORE) | 3 ms | 15 ms | 35–66 ms |

Text document: referat with 8 chapters → `renderDocx` 50 ms, 12 KB; **DOCX→PDF 1.88 s**, 26 pages, 100 KB.

### Where the time goes for «presentation download is slow»

- **PPTX (stored).** The server spends about 0.1–0.2 s (plus ~0.2 s render if edited). The rest is the **network body**: 8 MB at 1–5 Mbit/s is
  13–65 s. The client buffers the whole body into a Blob, shows **no progress** (even though `Content-Length` is sent), and on a
  phone the button is icon-only with no spinner (`ResultView.tsx:548-554`). In the Telegram webview the result is then discarded
  (see §4).
- **PDF.** soffice takes 1.5–3 s locally. Expect 2–3× that on the shared production VPS: `docs` says "2–90 s", and production is a 2-GB-limited web container on
  a box shared with other projects. If 2 conversions (or thumbnails, which take `N−1` slots) are running, a request waits up to 20 s and then
  fails with 503. Then comes another 6 MB of transfer.
  - Risk: `TIMEOUT_MS = 90 s` is longer than nginx's `proxy_read_timeout 60s` (`deploy/nginx/slaydx.conf.example:91`), so a slow conversion
    can surface as a 504 HTML page.
- **Second download.** The PDF is a cache hit (~0–9 ms) until the next deploy or 24 h. The PPTX has no cache because it is already stored.
  A thumbnail visit warms the PDF.

## 3. Meaningful extra formats per tool (cost / existence)

Legend:
- **E** = exists today.
- **C** = cheap (existing pieces, < 0.5 day).
- **N** = new renderer (estimate shown).
- ✗ = not recommended.

| Tool | Recommended order in the sheet |
|---|---|
| slide, pro-slide | **PPTX** (E) · **PDF** (E, soffice) · **Slide images PNG (ZIP)** (C: cached PDF → pdftoppm 110–150 dpi → zip, 2–7 s; ~0.5 day incl. cache) · ✗ speaker-notes TXT (low value) |
| coursework, referat, mustaqil-ish, essay, article, thesis | **DOCX** (E) · **PDF** (E) · TXT/MD ✗ for v1 (needs an `AcademicDoc`→text serializer, ~0.5–1 day, low value; «Matnni nusxalash» would be better if wanted) |
| resume | **PDF first?** (owner Q) · DOCX (E) |
| lesson-plan, texnologik-xarita, keys | DOCX (E) · PDF (E) |
| glossary | DOCX · PDF · **CSV** (C: `terms[]` → CSV with BOM, reuse `csvCell` from `results/route.ts`; ~2 h) · XLSX (N: minimal OOXML via jszip, ~0.5–1 day, or reuse the translate XLSX helpers) |
| test | DOCX · PDF · CSV of questions/answers (C/N ~0.5 day; nice for Google Forms/Kahoot import, owner Q) |
| crossword, flashcards | DOCX (printable) · PDF (E). PDF is the better print default. |
| sorting, listening | DOCX · PDF · **Natijalar CSV** (E, `results?format=csv`, move it into the same sheet/driver) |
| translation | **Same format as source** (E: docx/pptx/xlsx/txt/md/csv) · PDF only for docx/pptx (E; the web image has no `libreoffice-calc`, so XLSX→PDF is impossible without a bigger image) · TXT of the translated text (C from `t.pairs`) for text-mode input |
| image (rasm) | single: **PNG/JPG as stored** (E) · **JPG** (C, sharp, ~50 ms) · WebP ✗ (poor support in phone galleries and Telegram) · multi: **ZIP** (E) + each image individually (E as assets; route them through the driver) |
| infographic | **PNG** (E) · **JPG** (C) · **PDF A4 poster** (N: tiny PDF writer embedding a JPEG with DCTDecode, ~0.5 day; or wrap in DOCX → soffice) |
| podcast, greeting | **MP3** (E) · **Transcript TXT** (C: `doc.audio.script`, ~2 h) · other audio codecs ✗ (no ffmpeg in the image; MP3 is universal) |

## 4. Downloading inside Telegram and in browsers

What I verified in client source code (fetched with `gh api`, saved under `r1/`):

| Client | `<a download>` + blob (today) | `<a download href=https…>` | `WebApp.downloadFile` (8.0+) |
|---|---|---|---|
| **Android** (`BotWebViewContainer.java`) | **No-op.** Bot webviews register no `DownloadListener` (`:4963`); blob is ignored even in the in-app browser (`:4983`) | **No-op** for bot webviews | `web_app_request_file_download` (`:2814-2860`): **ignored without any event unless < 10 s since the last ACTION_DOWN touch** (`:2815`, `:5188-5190`). Then the server check `bots.checkDownloadFileParams`, then a native alert, then `BotDownloads` → Android **DownloadManager** (`BotDownloads.java:203-215`) with **no cookies or custom headers**, saved to `Downloads/`, progress in the notification and in the bot "Downloads" list. Event `file_download_requested {status: downloading/cancelled}`. A URL already downloaded is re-downloaded without the popup (`getCached`). |
| **iOS** (`WebAppController.swift`) | `WKDownload` delegate handles **only `.pkpass`** (`:672-727`); anything else is saved to temp and dropped, or the webview navigates. Effectively broken. | same | `downloadFile` (`:2910+`): **HEAD request for size** (`FileDownload.getFileSize`) + `checkBotDownload` → alert "Download <file> (size)?" → `URLSession` (separate cookie store, so **no session cookie**) with a progress toast. On finish, `.jpg/.png/.gif/.tiff` go to **Photos**; documents open the **"Save to Files" picker**. No touch-recency check in this handler. |
| **Desktop** (tdesktop `attach_bot_webview.cpp`) | not verified | not verified | Supported, with a downloads panel (progress, retry, cancel) |
| **Telegram Web** (K/A, iframe) | browser behaviour | browser behaviour | The official docs require the response to carry `Content-Disposition: attachment; filename="…"` **and `Access-Control-Allow-Origin: https://web.telegram.org`** (the web client fetches the file cross-origin). |

API facts (core.telegram.org/bots/webapps; latest Mini Apps Bot API 10.1, 2026-06-11):
- `downloadFile(params[, callback])` was added in 8.0. `DownloadFileParams = {url: HTTPS URL, file_name}`.
- The callback gets a boolean "accepted". Event `fileDownloadRequested`.
- Call it only when `WebApp.isVersionAtLeast("8.0")`; older clients throw `WebAppMethodUnsupported`.

**Implications for the server URL.** It must be HTTPS and self-authorizing (signed token in the path), because no cookie reaches it.
- **Multi-use within the TTL:** iOS sends HEAD then GET, and Android's DownloadManager retries.
- **Answer HEAD cheaply:** Next auto-maps HEAD to GET (`node_modules/next/dist/server/route-modules/app-route/helpers/auto-implement-methods.js:39-44`), which would read 8 MB and bump `downloads`, so add an explicit HEAD handler.
- **Headers:** send `Content-Length`, `Content-Disposition: attachment` with an ASCII fallback (already in `contentDisposition()`), `ACAO: https://web.telegram.org`, and `X-Content-Type-Options`.
- **The file must already exist when `downloadFile` is called.** Because of Android's 10 s gesture window we cannot tap → wait 30 s for the PDF → call `downloadFile`.

**Outside Telegram (normal mobile/desktop browsers).** fetch → blob → `<a download>` works in Chrome, Android, iOS Safari 13+ and Firefox,
and it lets us show **real % progress** from `Content-Length` via `res.body.getReader()`. The fallback is plain navigation to the signed URL,
which hands the transfer to the browser's own download UI.

**Recommended strategy, in order:**
1. **Telegram ≥ 8.0:** prepare → signed URL → `downloadFile` (directly if the tap was < 8 s ago, otherwise a «Tayyor — yuklab olish» button the user taps).
   - Listen for `fileDownloadRequested`. If no event arrives within ~2 s on Android, assume the call was dropped by the gesture rule and show the tap-button again.
2. **Telegram < 8.0, or `downloadFile` throws or is cancelled twice:** offer «Botga yuborish» (the bot sends the file into the chat, the R-«Saqlash» package; the most robust path on every client)
   and «Brauzerda ochish» (`WebApp.openLink(signedUrl)` → external browser downloads it via `Content-Disposition`).
3. **Normal browser:** fetch the signed URL with a progress bar → blob → `<a download>`. If that fails, navigate to the signed URL.

## 5. Progress UX

**Today.**
- Phone, native format: tapping the icon only dims it. There is no spinner, no text (`Fayl yangilanmoqda…` is hidden below `sm`) and no progress while the
  8 MB body downloads. In the Telegram webview nothing is saved at the end.
- Phone, PDF: a spinner + «PDF…» and a notice «PDF tayyorlanmoqda — bu 1 daqiqagacha…», but the PDF button disappears in the compact header.
- Errors: a single red line in the header (`ResultView.tsx:629-633`).

**Proposed.** Each row of the sheet is a small state machine:
`idle → preparing (server) → ready → delivering (Telegram/browser) → done | error(retry)`.
- **Immediate feedback (< 100 ms):** the sheet opens with no network call. A tapped row shows a spinner, «Tayyorlanmoqda…» and an elapsed-seconds counter, and
  the other rows stay usable.
- **Preparation is asynchronous.**
  - `POST /api/generations/{id}/download {format}` answers within ≤ 8 s with `{state:"ready", url, fileName, size}`.
  - Otherwise it answers `{state:"preparing", retryAfterMs}` and the client polls the same endpoint every 1.5 s.
  - The work runs in the web process: single-flight, the existing soffice gate, and a timeout lowered to **50 s** so it stays under nginx's 60 s.
  - No request stays open longer than ~8 s, so a 504 can no longer happen.
- **Delivering:**
  - In Telegram, show «Telegram yuklab olmoqda — bildirishnomada/yuklamalarda ko'rasiz» once `downloading` arrives.
  - In a browser, show a real % bar + «3,1 / 8,1 MB».
  - Show the size before downloading («PPTX · 8,1 MB»), since `size_bytes` is already stored.
- **Timeouts and retry:** a 60 s preparing budget, then an error with «Qayta urinish». A 503/429 shows the server text + Retry-After (reuse `withRetryHint`).
  Network loss during the body → «Aloqa uzildi — qayta urinib ko'ring».
- **Uzbek strings (draft):**
  - «PDF tayyorlanmoqda… (odatda 5–15 soniya)»
  - «Tayyor — yuklab olish uchun bosing»
  - «Yuklab olinmoqda — 45%»
  - «Fayl telefoningizga saqlandi» (only when known)
  - «Telegram yuklab olishni boshladi»
  - «Yuklab olish bekor qilindi»
  - «PDF navbati band — 15 soniyadan keyin qayta urinib ko'ring»
  - «Fayl muddati tugagan yoki o'chirilgan»
  - «Telegram ilovangiz eski — faylni botga yuboramizmi?»
- **Pre-warming (owner decision).** Recommended: start PDF preparation when the **sheet opens** (cheap and intent-driven) and keep the 24 h disk cache.
  - Alternative: warm on completion for pptx/resume only.
  - Storing the PDF in the DB permanently doubles BYTEA. The cache could move to a docker volume so deploys don't wipe it.
- **Caching:** generalize `PdfDiskCache` to a `DerivedFileCache` keyed by `{genId, sha(bytes), format}` for PDF, PNG-zip and JPG.

## 6. Proposed contract

### `lib/downloads/formats.ts`: pure, client-safe single source of truth (the project's "one source" rule)
```ts
export type DownloadFormatId = "native" | "pdf" | "slides-png" | "jpg" | "transcript-txt" | "glossary-csv" | "results-csv";
export type DownloadFormat = {
  id: DownloadFormatId;
  label: string;          // «PowerPoint (PPTX)», «PDF», «Slaydlar rasm (PNG, ZIP)»
  hint?: string;          // «Tahrirlash uchun», «Chop etish va yuborish uchun»
  ext: string; mime: string;
  cost: "instant" | "convert";   // UI: convert → shows «tayyorlanadi» hint + spinner
  needs?: "pdf" | "pdftoppm";    // server feature flags (features.pdf)
};
/** Ordered list for a finished generation; used by DownloadSheet AND by the server route (rejects anything not listed). */
export function downloadFormats(g: { type: ToolId; format: string; translationKind?: string; imageCount?: number },
                                features: { pdf: boolean }): DownloadFormat[];
```
The server producer map lives in `lib/server/downloads/produce.ts`: `Record<DownloadFormatId, Producer>`. A test asserts that every id in
the registry has a producer and a differential probe (per the "every param must work" rule).

### Routes
- `POST /api/generations/{id}/download` (cookie auth, ownership in SQL).
  - Body: `{format}`. It validates `format ∈ downloadFormats(gen)`, runs `ensureFreshFileShared`, then produces or caches.
  - Response: `{state:"ready", url:"/api/dl/<token>", fileName, size, mime, expiresAt}` or `{state:"preparing", retryAfterMs}`, plus 429/503 with Retry-After.
  - The token is minted only when bytes exist, and it binds `{g, u, f, v:file_version, exp:+15 min}`.
- `GET|HEAD /api/dl/{token}` (no cookie).
  - Token: HMAC-SHA256 with a key derived by HKDF from `SESSION_SECRET` (`info "download-v1"`, same pattern as `admin-crypto.ts`), base64url, constant-time compare.
  - Loads with `WHERE id=$g AND user_id=$u` and requires `file_version = v`; otherwise 410 «Fayl yangilangan — qayta yuklab oling».
  - Serves from the stored file or the derived cache.
  - Headers: `attachment`, `Content-Length`, `ACAO https://web.telegram.org`, `Cache-Control: private, no-store`, `nosniff`, `Referrer-Policy: no-referrer`.
  - HEAD returns headers only. `downloads++` only on GET.
  - Add `/api/dl` to the `BYTE_ROUTES` / cache-header list in `next.config.ts`, and exempt it from session middleware.
- Keep `GET …/file` for the audio `<audio>` source and the translation iframe (back-compat); switch its `?format=pdf` to the shared producer.

### Client
- `lib/downloads/deliver.ts`:
  - `prepareDownload(id, format, onState)` handles polling.
  - `deliver({url, fileName, size}, env)` picks Telegram `downloadFile` (with gesture-time tracking: record `performance.now()` on every pointerdown inside the sheet), browser fetch-with-progress, or navigation.
  - Plus `onFileDownloadRequested`.
- `components/files/DownloadSheet.tsx`:
  - Phone (`usePhone()` from `result-layout/prefs`): bottom sheet. Desktop: popover anchored to the button.
  - Uses `useDialog(open, close)`, so the phone back button and the Telegram BackButton close it (history layer, `docs/nav/PLAN.md`).
  - Rows come from `downloadFormats`. Each row has an icon, label, size/hint and state, with ≥ 44 px targets and safe-area padding at the bottom.
- `ResultView` header becomes **one** «Yuklab olish» button: a visible label on phones too (icon + «Yuklab olish»), and it opens the sheet.
  The PDF button and the PDF notice go away. Stale-file handling moves to the server (`ensureFreshFileShared` in POST).
- ImageViewer tile/lightbox ⬇ and the GameSharePanel CSV go through `deliver()` with format ids (`image:<assetId>` or `results-csv`),
  otherwise they stay broken in Telegram.

## (a) Root causes

1. **Download transport is incompatible with the Telegram webview** (fetch → blob → `<a download>`). Android bot webviews have no download
   handler and ignore blobs; iOS drops non-`.pkpass` downloads. Most users are in the Mini App on a phone.
2. **No feedback on a phone.** The icon-only button has no spinner or label, and there is no transfer progress despite `Content-Length`.
3. **Large decks.** Pro/slide decks with images are 5–10 MB. The network dominates; the server spends only ~0.1–0.3 s.
4. **Synchronous PDF.** It runs inside the request: 1.5–3 s locally, 2–3× on production, up to +20 s queue, a 90 s timeout above nginx's 60 s, and a cache that is lost on deploy.
5. **Many uncoordinated affordances** (2 header buttons, image tile/lightbox, results CSV, translation iframe) with different transports.

## (b) Design

See §6:
- a format registry shared by UI and server;
- POST prepare (≤ 8 s, then poll) → signed 15-min URL → `GET|HEAD /api/dl/{token}`;
- a delivery driver: Telegram `downloadFile` → bot fallback → browser fetch with % → navigation;
- `DownloadSheet` on `useDialog`;
- a generalized derived-file disk cache;
- prepare on sheet open.

## (c) Work packages (no file overlap)

| WP | Scope | Files owned | Effort |
|---|---|---|---|
| **D1 Registry** | Format registry + unit tests (per-tool matrix, translation/image variants, features gating) | `lib/downloads/formats.ts`, `tests/download-formats.test.mts` | 0.5 d |
| **D2 Server prepare + signed URL** | Token sign/verify; prepare route (async budget, polling); `/api/dl/[token]` GET+HEAD with Telegram headers; derived cache (generalize `pdf-cache.ts`); lower soffice timeout to ≤ 50 s; producers native/pdf | `lib/server/downloads/{token,produce,derived-cache}.ts`, `app/api/generations/[id]/download/route.ts`, `app/api/dl/[token]/route.ts`, `lib/server/pdf-cache.ts`, `lib/server/pdf.ts` (timeout), `next.config.ts` (header rules), tests `tests/download-{token,route,produce}.test.mts` | 1.5–2 d |
| **D3 New producers** | slides-png zip (pdftoppm from cached PDF), image JPG (sharp), audio transcript TXT, glossary CSV, (opt.) test CSV, infographic PDF | `lib/server/downloads/producers/*.ts` + tests | 1–1.5 d |
| **D4 Client driver** | `prepareDownload`, `deliver` (Telegram `downloadFile`, gesture window, `fileDownloadRequested`, browser % progress, navigation fallback, Uzbek errors); remove/replace `downloadGeneration`+`saveBlob` | `lib/downloads/deliver.ts`, `lib/api-client.ts` (download section only), `tests/ui/download-deliver.test.mts` | 1 d |
| **D5 DownloadSheet + integration** | Sheet UI (phone sheet / desktop popover, `useDialog`), single header button in `ResultView`, removal of PDF button/notice; ImageViewer + GameSharePanel CSV via driver; translation «Fayl» tab fallback for webviews without PDF rendering | `components/files/DownloadSheet.tsx`, `components/files/ResultView.tsx`, `components/viewers/ImageViewer.tsx`, `components/files/GameSharePanel.tsx`, `components/viewers/TranslationViewer.tsx` | 1.5 d |
| **D6 Telegram bridge glue** | Typed `WebApp.downloadFile`/`isVersionAtLeast("8.0")`/event wrapper. **Shared with the Ulashish/Saqlash packages**, so one owner for all of `MiniAppBridge.tsx` + `lib/telegram-miniapp.ts` | `lib/telegram-miniapp.ts`, `components/telegram/MiniAppBridge.tsx` | 0.5 d |
| **D7 Verification** | Playwright smoke with a `tgapp.cjs`-style stub capturing `postEvent('web_app_request_file_download')` (360/390/1366); throttled-network run for progress; on-device check (Android + iOS Telegram) by the owner | `scratchpad` smoke scripts only | 0.5 d + device time |

Order: D1 → (D2 ∥ D4 ∥ D6) → D3 → D5 → D7. «Botga yuborish» (sendDocument) belongs to the Saqlash package. D4 only calls it as a fallback,
so its interface needs to be agreed early.

## (d) Owner questions

1. **Format menu per tool.**
   - (A, recommended) the §3 matrix: native + PDF everywhere it applies; PNG-zip for slides; JPG for images; CSV for glossary and results; TXT transcript for audio.
   - (B) native + PDF only.
   - (C) A plus TXT/MD for text documents.
2. **PDF readiness.**
   - (A, recommended) prepare when the sheet opens, plus a 24 h disk cache moved to a docker volume.
   - (B) always pre-generate right after generation for pptx and resume only.
   - (C) pre-generate and **store** PDF for everything (doubles DB storage).
   - (D) keep on-demand only.
3. **Resume default format.** (A, recommended) PDF listed first. (B) DOCX first.
4. **Fallback for old Telegram clients or a refused `downloadFile`.**
   - (A, recommended) «Botga yuborish» (bot sends the file to the chat).
   - (B) open in the external browser.
   - (C) both.
5. **Slide images.** (A, recommended) one ZIP at 150 dpi. (B) 110 dpi, smaller. (C) don't offer.

## (e) Risks

- **Android 10 s gesture window.** A late `downloadFile` is dropped with no event. Mitigations: «Tayyor — bosing» re-tap, and a timeout on the missing event.
- **Telegram server check.** `bots.checkDownloadFileParams` has unknown criteria. If it says false, the user gets `cancelled`, so the bot fallback is required.
- **Signed URL is a bearer link** for 15 min. Telegram may keep it in its Downloads list. Mitigations: bind it to user + file_version, keep the TTL short, use `no-referrer`, and don't log query/paths with tokens.
- **iOS sends HEAD.** HEAD must not trigger conversion or the `downloads` counter. A token must survive HEAD + GET + retries.
- **soffice on the shared VPS.** A 2 GB web container and 2 slots. Prepare-on-open increases conversions. Keep per-user limits and the 503 Retry-After path, and lower the timeout below nginx's.
- **Disk cache lost on deploy.** The first PDF after a deploy is slow again. A volume or the DB fixes it, at a storage cost.
- **Translation «Fayl» tab** PDF iframe likely renders blank in Android webviews, and on iOS it relies on WKWebView's PDF view. This needs a device check; it may need page images (thumb pipeline) instead.
- **Not verified on devices:** iOS `<a download>` behaviour for http (not blob) URLs, Desktop/Web behaviour, and that Telegram Web needs `ACAO` exactly `https://web.telegram.org` (also add `https://web.telegram.org/k|a`? the origin is the same host).
- **Existing tests** pin the two-button header and the `downloadGeneration` behaviour (`tests/ui/*`, `api-client` tests). D4/D5 must update them deliberately.
