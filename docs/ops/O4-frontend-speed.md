# O4 — Frontend speed for the Telegram Mini App on phones (research only)

Sources: CI run 37333293185 (main `926fcc7`, `npm run build` step; raw log saved at `scratchpad/ops/o4-ci.log`, route table at lines 42179-42345),
static code reading, the prod `.next` HTML of 2026-10-04 left in the working tree (`.next/server/app/uz/article.html`, fonts/CSS; a prod build, not dev),
prod snapshot (`prod-snapshot.txt`), real generated decks in `eval-out/`. No local `next build`, no prod requests.
Bundle composition was measured with **esbuild** (already in node_modules via tsx, ~1 s per entry, run through `scripts/heavy.sh -m 1G`; script `scratchpad/ops/o4-esb.mjs`):
minified + gzip -9, react/next external, `import()` NOT split — so only entries without dynamic imports are valid (layer, home, /o). Treat as +-15 % estimates of the Next numbers.
`next experimental-analyze` does not exist in Next 15.5 (it is 16.1+), so it was skipped; proposal for a CI-side analysis is in §5.

## 1. First Load JS per route (CI, gzip as reported by Next)

Shared by all: **227 kB** (6 chunks 11-59 kB + 35.5 kB other + CSS 22.7 kB).

| Route | page | First Load | note |
|---|---|---|---|
| `/` | 0 | 202 | `redirect("/uz")` is a CLIENT redirect (prerendered `__next_error__` shell): whole 202 kB JS loads before it fires |
| `/uz` (home / my files) | 55.5 | **274** | biggest consumer route; pulls the whole slide layout engine for thumbnails |
| `/uz/files/[id]` (result) | 35.4 | 254 | viewers already lazy per type (FE-11); static part still carries DownloadSheet, GameSharePanel, ArticleReviewPanel, EditActions, ShareButton |
| `/uz/[slug]` (22 tool forms) | 20.7 | 240 | composers lazy per tool; the 12 `lazy()` chunks do NOT show in First Load |
| `/uz/create`, `/profile`, `/purchase`, `/login` | 0.3-3 | 219-222 | shell only |
| `/o/[token]` (public game, students) | 8.7 | **211** | no AppShell, but still the full tools registry (see 2.1) |
| `/admin/*` | 3-21 | 219-273 | same baseline |

What the 227 kB shared layer is made of (esbuild, gz): React/ReactDOM/Next runtime ~ 150 kB (not reducible), CSS 22.7 kB, app code **~68 kB**, of which
**~37-46 kB is the tools registry** (see 2.1). So ~16-20 % of the shared layer is data tables most routes never use.

### 1.1 Root cause: `lib/store.ts` -> `lib/tools.ts` -> 7 registries on EVERY route
- `lib/store.ts:8` imports `setClientPriceAdjustments/parsePriceAdjustments` from `./tools`; `lib/ui.ts:5` imports `TOOL_BY_ID`; `components/shell/Sidebar.tsx:6` imports `TOOLS`.
- `lib/tools.ts:1-20` imports registries of game, audio, infographic, article (3), work (2), essay (3), teacher, slide-params, languages.
- Measured: `lib/store.ts` alone = 138 KB min / **46 kB gz**; `app/layout.tsx` alone = 165 KB min / 55 kB gz, of which teacher 32 K, essay 16 K, tools 16 K, games 15 K, article 14 K, work 14 K, audio 11 K, infographic 9 K (min). So `/admin`, `/o/[token]`, `/uz/login` all ship the teacher/essay/article/game registries.

### 1.2 `/uz` home pulls the slide engine (`FilePreview.tsx:8` -> `SlideCanvas` -> `planSlide`, visuals/*)
- Home bundle 356 KB min / 109 kB gz vs layer 68 kB gz = **+41 kB**; `SlideCanvas` alone = 130 KB min / **34 kB gz** (visuals 70 K, slide-layout 33 K). Matches the CI page chunk 55.5 kB.
- Needed only for decks that have `preview.slide` (first slide thumb).

### 1.3 Word viewer carries KaTeX unconditionally
- `components/viewers/WordViewer.tsx:3` `import katex` (262 KB min = **75 kB gz**) + `app/globals.css:9` imports `katex.min.css` globally (3.5 kB gz, in render-blocking CSS of EVERY page; its 20 @font-face are lazy so no font cost).
- Formulas exist only in some article/work/teacher docs; essays/referats/coursework (the common ones) pay 75 kB for nothing.

### 1.4 Already good (do not touch)
12 tool composers `lazy()` (ToolWorkspace.tsx:30-41), 6 viewers `retryableLazy` (ArtifactViewer.tsx:19-26), professions.json (127 kB gz) lazy in ResumeComposer, QR lib `import("qrcode")` on demand, `next/image` intentionally off, lucide-react named imports (Next optimizes them), no pdf.js / jszip / docx / pptxgenjs in any client bundle (verified by grep: only `lib/server/**`, `lib/generation/render-*`, `lib/extract-text.ts`).

## 2. Fonts, images, CSS

### 2.1 Fonts — the single biggest cold-start waste (measured on the prod HTML)
`app/layout.tsx:6-21`: Geist (latin + latin-ext), Geist Mono (latin), Tinos (latin, latin-ext, cyrillic; weights 400/700 x normal/italic). next/font preloads every subset file -> **15 `<link rel=preload as=font>` = 356 KB on every page**, including login and home:
- Tinos 12 files = **287 KB** (400/700 x normal/italic x 3 subsets; latin-ext files 47-56 KB each). Tinos is used ONLY by the document viewer (`--font-doc`).
- Geist Mono 23 KB: used by admin and a few code fields.
- Geist latin-ext 16.5 KB: Uzbek Latin (o', g' U+02BB/BC) is in the `latin` file.
Only Geist latin (29 kB) is needed on first paint. The preloads compete with JS for the same (likely HTTP/1.1, see 3.4) connections.
Fix: Tinos `preload: false` (+ drop `italic`/`700` preloads, @font-face stays and loads on first use), Geist Mono `preload: false`. **Saves ~310-330 KB (-90 %) of cold-start font transfer.**
Caveat (must be tested): `useMeasuredPages` (measure.tsx:49) and WordViewer measure pagination in `useLayoutEffect` with no `document.fonts` gate (grep: no `fonts.ready` anywhere). Tinos is metric-compatible with Times and next/font adds a size-adjusted fallback, so drift is small, but add a re-measure on `document.fonts.ready`/`loadingdone` to keep "DOCX = viewer" pagination parity.

### 2.2 CSS
One shared stylesheet 22.7 kB gz (Tailwind 4 purge + 17 KB hand-written globals + KaTeX 3.5 kB). Fine; moving the KaTeX import into the lazy formula module saves 3.5 kB gz of render-blocking CSS everywhere.

### 2.3 Images
- UI images: only `logo.png` (6 kB, preloaded, `<img>`), icons; template gallery `public/samples/tpl-*.jpg` 31-299 kB (avg 98 kB, 940x627) loaded only for the selected template. Fine.
- **Slide images are the heaviest bytes in the product.** Real decks from `eval-out/` (Gemini 1024x1024 JPEG, stored untouched as assets): 600-1000 KB per image, avg ~750 KB. pro-slide 10 slides/4 images = 3.4 MB; "defense" 14 slides/6 images = 4.2 MB; open-lesson-pro 12 slides/4 images = 2.4 MB. Displayed at ~140-360 CSS px on a phone (slide canvas is scaled `transform: scale`).
  - `SlideCanvas.tsx:180` `<img>` has no `loading`/`decoding`; the rail (SlideRail.tsx:205/335) renders a full `SlideCanvas` per slide, so all images are requested/decoded at once (browser dedups the fetch by URL, not the decode).
  - Asset route already sets `private, max-age=86400, immutable` (`assets/[assetId]/route.ts`), so repeat views are free; the first view is not.
  - Re-encoding at worker time (sharp already in the worker image; 1024 px q80 mozjpeg ~ 150-220 kB, or 768 px q75 ~ 60-90 kB) cuts a 4-image pro deck from ~3.4 MB to **~0.4-0.9 MB (-75-90 %)**. It also shrinks `generation_assets` (181 MB of the 413 MB DB, a big part of the 4.9 GB backups).

## 3. Telegram Mini App startup and data fetching

### 3.1 Cold-start chain (phone, inside Telegram, first open without cookie)
HTML (static shell, 44 KB, Suspense fallback "Yuklanmoqda..." only) -> 15 font preloads + ~17 async JS chunks (202-274 kB gz) -> hydrate -> `Providers` effect: `GET /api/auth/session` -> in parallel `MiniAppBridge` effect `setInTelegram` -> re-render -> **second effect injects `https://telegram.org/js/telegram-web-app.js`** (MiniAppBridge.tsx:59-76, 160-176; new DNS+TLS to telegram.org) -> `ready()/expand()` (late: Telegram shows its own splash until then) -> `POST /api/auth/telegram` (only after BOTH script and `sessionChecked`) -> `GET /api/generations` -> home cards -> N x `GET .../thumb` (DOCX/PPTX) .
That is 5-6 sequential round trips after the JS finished, none of which can start before hydration.
- telegram-web-app.js is injected from React effects (not in HTML). It could start with the first byte of HTML: a tiny inline head script that repeats the existing detection (`TelegramWebviewProxy` / `window.external.notify` / framed by telegram.org / `tgWebAppData` in hash) and appends the same `<script async>`; `loadTelegramWebApp()` already de-dups by `script[src]` and handles "already loaded". CSP already allows `https://telegram.org`. Security property is kept: ordinary browsers still load nothing, and the existing `isGenuineMiniApp` check still gates login.
- The first `/api/auth/session` request can likewise be started by the same inline script (store a promise on `window`, consumed by `api.fetchSession`) so it overlaps with the JS download instead of waiting for hydrate.
- Result page: `ResultView.tsx:117` waits for `sessionChecked && loggedIn` before the first `GET /api/generations/:id`; the viewer chunk (`SlideViewer` 121 kB gz standalone, WordViewer 224 kB gz standalone incl. shared) is requested only after the doc arrives and `lazy` renders. Waterfall: session -> generation -> viewer chunk -> slide images.
- `/` is a client-side `redirect("/uz")`; all bot buttons already use `${APP_URL}/uz` (telegram.ts:487, 661), but the BotFather menu button / Mini App link may still point at `/` (owner to check): then every launch downloads 202 kB of JS before redirecting.
- Hydration: `useCoarsePointer` uses `useSyncExternalStore` with server snapshot `false` (15 call sites), so on a phone every card/bar renders the desktop variant first and re-renders the phone variant (double render of the home list, small layout shift). Home thumbnails mount a full `SlideCanvas` DOM per deck card (up to 50 items, first page).

### 3.2 doc_json size (does the result page fetch it in one go?)
- Yes, one request: `GET /api/generations/:id` returns `doc` (+ `html` only when `doc_json IS NULL`, lean mode) every poll; `live` only when changed (`since`). While IN_PROGRESS, doc is null so polls are tiny; the completed doc comes once.
- Size measured on real pro-slide decks (`eval-out/*.doc.json`, which still hold inline base64 images, i.e. pre-`extractAssets`): without inline images the 10-slide pro-slide doc is **17 KB raw / 5.5 kB gz** (1.7 KB per slide); production stores URLs (`extractAssets`, worker.ts:599), so a 20-slide deck is ~35-60 KB raw / ~10-15 kB gz. doc size is NOT a problem. The images are (2.3).
- `GET /api/generations` (home) returns up to 50 rows each with `preview.slide` (first slide model, ~1.7 KB) -> ~100 KB raw / ~15 kB gz per call; polled every 3 s -> x1.5 -> 15 s while anything runs (HomeFiles.tsx). Acceptable; could poll only running ids or send ETag/304 (bytes only).

### 3.3 Caching headers
`next.config.ts` applies `private, no-store` to every `/api/*` except byte routes (assets `private, max-age=86400, immutable`, thumb with `?v=`, listening audio, resume photo). Candidates for private caching:
- slide/image assets: `max-age=86400` -> `max-age=2592000` (30 d; id = content hash) — Telegram webviews keep their HTTP cache, repeat deck opens after day 1 stop refetching MBs. (Config rule precedence: keep route in `BYTE_ROUTES`.)
- `/api/curriculum` (static reference data, login-gated, 60/min limit): `private, max-age=3600`.
- `/api/generations/:id` when COMPLETED: `private, no-cache` + ETag from `docVersion/fileVersion` (saves bytes only; DB still read) — low value.
- `/api/auth/session` and `/api/generations`: keep no-store (balance/pricing/status).
Static: `/_next/static/*` immutable (Next default), HTML pages `s-maxage=31536000` for SSG => browsers revalidate each time (fast, small).

### 3.4 nginx (from prod snapshot `nginx slaydx`)
- The 443 server block has **`listen 443 ssl;` with no `http2`** (and no `http2 on;`), only certbot's `options-ssl-nginx.conf`. If confirmed (owner can run `curl -sI --http2 https://slaydxx.uz | head -1`; I did not touch prod), the Mini App fetches 15 fonts + ~17 chunks + API over HTTP/1.1 (6 connections, queued). Adding `http2` is a one-word change in OUR file (note: on nginx < 1.25 `http2` on a `listen` is per ip:port socket, so other sites' blocks on 443 also speak h2 — harmless).
- Global `gzip on` with `gzip_types` commented out compresses only text/html; irrelevant because Next compresses its own responses (`compress` default true; not disabled in next.config.ts). No brotli module.
- `proxy_buffering off` + every `/_next/static` file served (and gzipped per request) by the Node web container (2 GB limit, 97 MB used). A `location /_next/static/ { proxy_pass ...; proxy_cache ...; proxy_cache_valid 200 365d; }` (hashed names, safe) or edge CDN removes that CPU; no effect on latency.

## 4. Service worker / prefetch (no extra server load)
- No service worker today. Not recommended now: Telegram iOS runs Mini Apps in WKWebView, which has no service workers for arbitrary origins; Android WebView has them. Immutable `/_next/static` already sits in the HTTP cache after the first open. A SW would add deploy-skew/cache-invalidation risk (the app already has `chunk-reload` handling for stale hashes) for gain on Android only. Revisit after 1-5.
- Zero-server-load alternatives, in order: (a) start viewer chunk prefetch as soon as the type is known — `useAppStore.generations` already has `type` for files opened from the list, so `ResultView` can `import("./SlideViewer")` etc. on mount (and on `touchstart`/`pointerenter` of a file card), in parallel with session/generation; (b) fire the generation request without waiting for `sessionChecked` (cookie authenticates it; 401 handler already exists) so session and generation overlap; (c) `next/link` already prefetches static routes in viewport in prod; `/uz/files/[id]` is dynamic (loading.tsx only), so (a) is the right lever; (d) optional: keep the last home list (ids, topic, type, status, no previews, no PII beyond titles) in `sessionStorage` for instant skeleton cards while the fresh list loads — decision for owner (privacy: titles on shared phone; current design deliberately avoids persisting generations, store.ts:327).

## 5. Quick wins, ranked (impact / effort), with estimates

| # | Change | Where | Saving (estimate) | Effort |
|---|---|---|---|---|
| 1 | Tinos / Geist Mono `preload:false` (+ fonts.ready re-measure in Word pagination) | `app/layout.tsx:6-21`, `components/viewers/measure.tsx`/`WordViewer.tsx` | **-310-330 KB** cold transfer on every page; on 3G/4G (1-4 Mbit/s effective) ~ -0.6-2 s of contention with JS | XS (3 lines) + S (re-measure) |
| 2 | `http2` on slaydxx.uz 443 (verify first) | `/etc/nginx/sites-enabled/slaydx` (owner/ops) | ~ -0.3-0.8 s cold load on a fresh webview (~35 parallel requests); 0 KB | XS, ops |
| 3 | Break `store.ts`/`ui.ts` -> `tools.ts` edge: new tiny `lib/price-adjust.ts` (parse/set adjustments), `ui.ts` filter map without `TOOL_BY_ID` | `lib/store.ts`, `lib/ui.ts`, `lib/tools.ts` (move 2 functions), new file | `/o/[token]` 211 -> ~170 kB, `/admin/*` -35-45 kB, `/uz/login` etc. unchanged until #4 | S |
| 4 | Light nav catalogue for Sidebar/TopBar/Search + precomputed default price per tool for CreateGrid (generated + equality test vs `TOOLS`), registries only in lazy form chunks | `components/shell/Sidebar.tsx`, `components/home/CreateGrid.tsx`, `components/overlays/SearchDialog.tsx`, new `lib/tool-nav.ts` | every `/uz/*` route **-35-45 kB gz (-15-20 %)**; 227 -> ~185 kB shared | M (invariant tests, "every param must work") |
| 5 | Lazy `SlideThumb` on home (`React.lazy` + same-aspect placeholder) | `components/home/FilePreview.tsx` (+ `tests/viewer/file-preview.test.mts` expects SSR `SlideCanvas`) | `/uz` 274 -> ~240 kB (**-34 kB gz**) | S |
| 6 | KaTeX lazy: `Formula` in its own module, preload it only if the flow contains a formula item BEFORE first measure; move `katex.min.css` import into it | `WordViewer.tsx:3,1363`, `app/globals.css:9` | essay/referat/coursework result pages **-75 kB gz JS**, global CSS -3.5 kB | M (pagination parity, SSR tests) |
| 7 | Telegram script + first `/api/auth/session` started from an inline head script (same detection) | `app/layout.tsx`, `MiniAppBridge.tsx`, `lib/api-client.ts` (`fetchSession` consumes the early promise) | -0.3-0.9 s to "logged in + generations requested" in the Mini App (removes the hydrate->effect->inject->download chain); `ready()` earlier = shorter Telegram splash | M |
| 8 | Result page: prefetch viewer chunk from store `type` on mount / card touch; run generation GET in parallel with session | `components/files/ResultView.tsx`, `components/home/PhoneFileCard.tsx` | -1-2 RTT, ~ -150-500 ms to first slide/page | S |
| 9 | Slide image derivatives (worker, sharp q80 1024 px or 768 px): serve smaller asset to viewer, keep original for PPTX rebuild if needed; `loading="lazy" decoding="async"` on rail/thumb `<img>` (check print/present mode) | `lib/server/worker.ts`/`assets.ts`/`slide-images.ts`, `SlideCanvas.tsx:180` | pro deck first view **3.4 MB -> 0.4-0.9 MB**; DB/backup size down (assets 181 MB) | M (touches generation pipeline; coordinate with server/DB agents) |
| 10 | ResultView static imports -> lazy: `DownloadSheet`, `GameSharePanel`, `ArticleReviewPanel`, `ShareButton`, `SaveToBotButton` | `components/files/ResultView.tsx:21-27` | `/uz/files/[id]` -6-10 kB gz (est.) | S |
| 11 | `/` -> `redirect()` in `next.config.ts` (server 307) + check BotFather menu URL = `/uz` | `next.config.ts` | removes 202 kB JS + client redirect for any launch via `/` | XS |
| 12 | Asset `max-age` 1 d -> 30 d; `/api/curriculum` private 1 h | `assets/[assetId]/route.ts`, `curriculum/route.ts`, `next.config.ts` | repeat views >1 day apart skip MBs | XS |
| 13 | nginx `proxy_cache` for `/_next/static` (or Cloudflare proxy for static) | nginx / DNS (owner) | web container CPU only; Brotli (-15-20 % JS) only with CDN | S / owner |
| 14 | CI performance budget: parse the build route table, fail PR if `/uz`, `/o/[token]`, shared exceed N kB; optional CI-only build with `productionBrowserSourceMaps` + `source-map-explorer` uploaded as artifact (zero laptop/prod load) | `.github/workflows/ci.yml`, `scripts/perf-budget.mjs` | prevents regressions; gives exact per-package numbers | S |

Sum of safe-and-cheap items (1, 2, 3, 5, 8, 10, 11, 12): cold open of home ~ -330 KB fonts, -34 kB JS (home), -40 kB JS (/o, /admin), 1-2 RTT; with 4, 6, 7, 9: shared -40 kB more, Word pages -75 kB, Mini App login-ready -0.3-0.9 s, deck view -2.5-3 MB.
Not measured (no local build / no prod access): real FCP/LCP/TTI on a device, actual HTTP version served, actual per-chunk gz from Turbopack. Verification plan: Playwright with Chromium CPU 4x + Fast 3G throttling against the CI-built app and the test DB (:55440), before/after on `/uz`, `/uz/files/<essay>`, `/uz/files/<pro-slide>`, `/o/<token>`, with the existing Telegram stub from `scratchpad/mobile/r5/lib.cjs`.

## (b) Concrete proposed changes (summary)
1. `app/layout.tsx`: `Tinos({ preload: false, ... })`, `Geist_Mono({ preload: false })`; optionally `Geist` subsets `["latin"]` only if cyrillic/latin-ext glyph coverage is not needed in UI (it is lazy anyway via unicode-range; keep, just no preload for latin-ext is not selectable — leave).
2. `lib/price-adjust.ts` (new): `parsePriceAdjustments`, `setClientPriceAdjustments`, `PriceAdjustMap`; `lib/tools.ts` re-exports; `lib/store.ts` imports the new file; `lib/ui.ts` takes the type->filter map from a small constant.
3. `components/home/FilePreview.tsx`: `const SlideThumb = lazy(() => import("./SlideThumb"))` with an aspect-ratio placeholder.
4. `components/viewers/FormulaView.tsx` (new, imports katex) lazy; WordViewer awaits the import before measuring only when the doc has formulas; `katex.min.css` imported there.
5. Inline head script in `app/layout.tsx` (nonce not needed: CSP has `unsafe-inline`) — same detection as `lib/telegram-miniapp.ts` — adds the telegram script and starts `/api/auth/session`; unit test the script string against `isGenuineMiniApp` truth table (it must never fire in an ordinary browser tab).
6. `ResultView`: early `import()` of the viewer chunk by `generations.find(id)?.type`; generation GET not gated on `sessionChecked`.
7. Worker: viewer-size JPEG for slide assets (decision O-3 below).
8. nginx `listen 443 ssl http2;` + optional `/_next/static` cache; `next.config.ts` `redirects()` for `/`.

## (c) Work packages (exclusive file ownership)
- **WP-A Fonts + head** (S): `app/layout.tsx`, `components/viewers/measure.tsx`, font-ready re-measure in `WordViewer.tsx` measure effect only (coordinate: WP-D owns the rest of WordViewer — do WP-A's `WordViewer` edit first or let WP-D own both).
- **WP-B Registry decoupling** (S then M): `lib/store.ts`, `lib/ui.ts`, `lib/tools.ts`, new `lib/price-adjust.ts`, phase 2 `lib/tool-nav.ts`, `components/shell/Sidebar.tsx`, `components/home/CreateGrid.tsx`, `components/overlays/SearchDialog.tsx`, tests (`tests/` tool/price invariants).
- **WP-C Home thumbs + result lazies** (S): `components/home/FilePreview.tsx`, `components/files/ResultView.tsx`, `components/files/ResultActions.tsx`, `components/files/GameSharePanel.tsx` usage, `tests/viewer/file-preview.test.mts`.
- **WP-D Word viewer katex** (M): `components/viewers/WordViewer.tsx`, new `FormulaView.tsx`, `app/globals.css` (1 line), parity tests under `tests/viewer/`.
- **WP-E Telegram startup** (M): `components/telegram/MiniAppBridge.tsx`, `lib/api-client.ts` (`fetchSession`), `lib/telegram-miniapp.ts`, inline-script helper — needs `app/layout.tsx` for one line: schedule AFTER WP-A merges.
- **WP-F Slide image derivatives** (M, server): `lib/server/worker.ts`, `lib/server/assets.ts`, `lib/generation/slide-images.ts`, `components/viewers/SlideCanvas.tsx` (`loading/decoding`) — coordinate with DB/backup agents.
- **WP-G Ops/headers** (XS): `next.config.ts` (redirect `/`, asset cache), nginx file (owner), `.github/workflows/ci.yml` + `scripts/perf-budget.mjs` (budget guard).

## (d) OWNER decisions
1. Font strategy: (a) **Tinos/Mono no preload, fonts.ready re-measure** (recommended, -320 KB); (b) keep Tinos preload only on the result route via a nested layout (more code, keeps today's pagination exactly); (c) leave as is.
2. HTTP/2 + static caching: (a) **enable `http2` in our nginx file now, check with curl, add `/_next/static` proxy_cache later** (recommended); (b) Cloudflare free proxy in front of slaydxx.uz (Brotli, HTTP/3, edge cache; but payment-callback IP allow-lists and `TRUST_PROXY` must be re-checked); (c) nothing.
3. Slide image weight: (a) **viewer copy 1024 px q80 (~-75 %), keep original for PPTX rebuild only when the deck is edited** (recommended: best quality/size, DB grows less than it shrinks); (b) replace the stored asset by a 768 px q75 copy for everything (~-90 %, PPTX rebuilt after edit would use the lower-res image); (c) keep.
4. Startup scope: (a) **do WP-A/B-phase-1/C/G first (all low risk, ~1-2 days), measure on a throttled phone, then decide WP-B-phase-2/D/E/F** (recommended); (b) all at once; (c) only fonts + http2. Also: persist last file list for instant home (privacy trade-off, §4d) yes/no.

## (e) Risks and rollback
- Fonts (#1): pagination drift if measured before Tinos loads -> mitigated by fonts.ready re-measure + the existing viewer parity tests; rollback = remove `preload:false` (single revert).
- Registry decoupling (#3-4): price/field logic is "single source of truth" and covered by the "every param must work" differential tests; keep `lib/tools.ts` re-exports so no importer breaks; tool-nav needs an equality test against `TOOLS`; revert per commit.
- Lazy SlideThumb/Formula (#5-6): a flash of placeholder; SSR snapshot tests (`file-preview.test.mts`, parity) must be updated; formula height must be known before pagination (preload gate) — rollback by reverting the import to static.
- Inline Telegram script (#7): must never run for ordinary browsers (login-CSRF note in `lib/telegram-miniapp.ts`) -> test with the existing truth table; CSP `unsafe-inline` already present; rollback = remove the inline script, the React effect path is untouched.
- Image derivatives (#9): touches the generation pipeline (PPTX parity "ko'rdim = oldim", rebuild path `assetImageResolver`); ship behind a flag, backfill not required (old decks keep originals); rollback = flag off.
- http2 (#2): affects every site on that 443 socket if they lack h2 (benign; clients negotiate); rollback = remove word and `nginx -s reload`; always `nginx -t` first; do not touch other projects' files.
- Nothing here was applied; all numbers are estimates until a throttled-device before/after run (§5 verification plan).
