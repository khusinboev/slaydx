# R5 — Phone-first audit of the user-facing app (Telegram Mini App, 360x740 / 390x844, DPR 3, light + dark)

Repo `main` @ `060e731` (read-only; audited from a throw-away detached worktree, now removed). DB `slaydx_r5` (dropped), dev server :3205 stopped.
Artifacts: `scratchpad/mobile/r5/` — `lib.cjs` (Telegram.WebApp stub + MEASURE), `audit.cjs`, `probe.cjs`, `seed.mts`, `metrics-{360,390}-{light,dark}.json` (93 screens each), `probe.json`, `shots/`, montages `m1..m8.png`.

## 0. Method and limits
- Emulation: Chromium 153, `isMobile`, `hasTouch`, DPR 3, Android Telegram UA, `TelegramWebviewProxy` + `#tgWebAppData` so the app really enters Mini App mode; stub `Telegram.WebApp` (viewport, safe areas, themeParams, BackButton, enable/disableClosingConfirmation, version 8.0). Session via cookie (bot token empty, so no initData login; the logged-in flow is identical because the bridge never replaces an existing session).
- 93 screens x 4 combos (360x740 and 390x844, light and dark): home (+ drawer, sort select, search, notifications, balance link), `/uz/create`, all 23 tool forms closed and with every «Sozlamalar» `<details>` open, 25 result pages (23 completed types + running + queued + failed; 4 with the panel sheet open), profile, purchase, login, logged-out home, login modal, 2 public games + invalid token, 3 x 404.
- Per screen: horizontal overflow (document, `#main`, elements wider than the viewport and not clipped), touch targets < 44 / < 32 (nested duplicates removed, inline text links counted separately), text < 12 px, fixed/sticky elements, ellipsis truncation, dialog height vs viewport, CLS/LCP/FCP, Telegram BackButton state, and a keyboard probe on every form (tap the first field, shrink viewport to 420 px).
- Seed: synthetic docs from `lib/generation/*/samples.ts` for every type. Seed artefacts that are NOT product bugs: `/api/generations/*/thumb` 404s on home (no thumbs seeded), black image/infographic viewer (seeded `doc.images` has no `url`), prod-less «Telegram kirish sozlanmagan» on `/uz/login`. A dummy `GEMINI_API_KEY` was set only so forms are not blocked; nothing was submitted, no paid calls.
- Dev-mode timings (LCP 0.9–2.1 s, result page 5–6 s incl. my fixed 3.5 s settle) are not representative; I did not profile a production bundle on a throttled network (see risks).

## 1. Headline
- **No screen overflows horizontally** at 360 or 390 (document, `#main`, wide elements: 0 of 372 screen-runs). No console errors other than the seed thumbs. CLS ≈ 0 everywhere (max 0.006 on 404-file). The earlier viewer redesign holds: one page scroll, sticky header, reading mode («O'qish») for paged docs, bottom sheet for panels, dialogs fit (Login/Pay fit even at 420 px height).
- The real phone problems are **density and ergonomics**, not layout breakage:
  1. Tap targets: forms average **30 targets < 44 px** (worst: pro-slide 65, slide 56, referat 47, coursework 46), result toolbars 28 px, the file-card delete 24 px, topbar 32–38 px.
  2. **All text inputs are 13–15 px** (probe: slide 7/7, coursework 14/14, resume 9/9, test 12/12 inputs < 16 px) → iOS Telegram zooms the page on focus. The public game input already uses 16 px — the forms do not.
  3. Hints are `title` tooltips (ⓘ, 11 px) — **do not exist on touch**; ~79 ⓘ marks across the audited forms carry content nobody can read on a phone.
  4. Keyboard: sticky submit bar (73 px) + 56 px topbar leave 291 of 420 px; a textarea that grows is hidden under the bar (translation: caret area 347–390 under the bar 347–420).
  5. Result header: title shows ~12 characters, header + toolbar eat 152 px (18 % of 844; 20 % of 740), 188 px with the game chip row (listening/sorting/crossword/flashcards/test).
  6. No Telegram viewport/theme/swipe integration at all (see 3.G).

## 2. Findings table (P1 = blocks a task, P2 = ugly/awkward, P3 = polish)

No P1 was found that blocks a task outright on a phone; the closest are the two P2s marked (*) which make a task error-prone.

| # | Pri | Screen(s) | Finding (measured) | Shot / data |
|---|---|---|---|---|
| F1 | P2* | all 23 forms | Form controls are desktop-sized: `Segmented` buttons 24 px high (25–60 px wide), `Switch` 36x20, `SelectField` h-8 (32), ColorDots 24x24, summary toggle chevrons. Avg 30 targets < 44 px per form, 12–40 < 32 px. Adjacent 24 px chips (reja bandlari 3/4/5/6, nazorat testi, 14 template-colour dots) invite mis-taps. | `shots/390-light/form-slide-open-tall.png`; `metrics-390-light.json` `touch` |
| F2 | P2* | all forms (iOS) | Every input/textarea/select < 16 px (13 / 14 / 15 / 12.5 px). iOS focus-zoom pulls the layout sideways; user has to pinch back. Game name input is 16 px (correct). | `probe.json inputFont` |
| F3 | P2 | forms | Hints live only in `title=` on a 11 px ⓘ → invisible on touch; also ⓘ is 11 px text (< 12). | `compact.tsx` Row; 79 hits |
| F4 | P2 | forms + keyboard | Sticky submit bar stays over the keyboard-shrunk viewport (73 px of 420). With topbar 56 → 291 px usable; textarea rows end behind the bar (translation: textarea bottom 390 vs bar top 347). No `scroll-padding-bottom` for the bar. Topic-suggestion chips (5 rows x 28 px) push the field list down in slide/pro-slide. | `shots/390-light/form-translation-keyboard.png`, `m6.png` |
| F5 | P2 | result (all types) | Header title truncated to ~115 px at 360 (≈12 chars; «Oliy ta'limda a…»), subtitle «Kurs ishi · Tayyor · 3,0…»; PDF + download + delete + back in one row. Sticky stack 112 px + viewer toolbar 40 px = 152 px (13 %+5 %); 188 px (22 %) on 5 game/teacher types with the «O'yin havolasi» chip row. | `result-article.png`, `result-listening.png` (hdr 92 px), data `headerStack` |
| F6 | P2 | result viewers | Viewer toolbars: prev/next/zoom 28x28 (slides 20x20 for «Slaydni chapga/o'ngga surish»), «O'qish/Varaq» toggle 24 px high. Reading mode fixed paged docs, but resume and slides have none. | `result-slide.png`, `result-resume.png` |
| F7 | P2 | result-resume | A4 fitted to 390 px = 46 %: body text 11.3 px effective, 33 spans < 12 px (contacts, skills). No reading mode for resume; no visible pinch affordance. Slides: stage 28 %, text unreadable until fullscreen — acceptable for a deck but thumbnails grid text is 10 px. | `result-resume.png` |
| F8 | P2 | result-failed/queued | Failed/revoked page is a dead end: message + «tanga qaytarildi», **no «Qayta urinish» / «Formaga qaytish» button** (the `expired` branch has one). | `result-failed.png`, `ResultView.tsx` FAILED block |
| F9 | P2 | home (file list) | 2-column grid at 360/390: card title truncates to ~10 chars («Iqtisodiyotda r…», 23 truncated nodes), subtitle «Kurs ishi ·» then empty; delete icon 24x24 right next to the title link (mis-tap risk; double-tap confirm mitigates). Two identical ⇅ icons (sort field + direction) beside a 40 px select. No compact list view. | `home.png` |
| F10 | P2 | `/uz/create` | 23 tools in one column of ~130 px cards (≈3 000 px tall), no search/jump chips/group nav; the group headings are 12 px caps. Search exists only behind the top bar icon. | `create.png` |
| F11 | P2 | topbar (every page) | Menu 32x32, avatar 32x32, balance pill 32 px, search/theme/bell 38x38 (`size-10 scale-95`), back arrow 32x32 (`ToolChrome`, `ResultView`, profile/purchase). 4–7 targets < 44 on every screen. | `create.png` data |
| F12 | P3 | pay dialog | Amount chips 64x40, close 28x28; panel is a floating card with 16 px margins rather than an anchored bottom sheet; fits at 420 px. «Orqaga» text link in login modal ≈ 12 px. | `m8.png` |
| F13 | P3 | all pages | Small text: card headers `text-[11.5px]` (98 hits), counters «0 / 300» 11 px (30), ⓘ 11 px (79), file-card subtitle 12→11, slide rail numbers 10 px, footer «SlaydX» 11 px, `SummaryChips` 11 px. | `smallText` |
| F14 | P3 | Telegram | In-app «←» **and** Telegram's BackButton are both visible on every non-root page (create, forms, results, profile, purchase, 404) — duplicate controls. Public game `/o/*`: BackButton absent by design. | `tg` field |
| F15 | P3 | dark | Dark theme is consistent (no contrast failures seen). Podcast/slide thumbnails keep a white card in the dark grid (glaring). | `shots/360-dark/*` |
| F16 | P3 | 404 / error | Fine: 404 has «Bosh sahifaga» (48 px, ok). The generic invalid-game message is plain but fine. `game-invalid` never reached network idle in 20 s (only 2 API calls seen; likely a held connection — not chased). | `404-slug.png`, `game-invalid.png` |
| F17 | P3 | all | No `env(safe-area-inset-*)` anywhere in `app/` or `components/` although `viewport-fit=cover` is set (`app/layout.tsx:57`). Chromium with insets 47/34 px honours `env()` but nothing uses it → in Telegram fullscreen / iOS standalone the sticky submit bar sits under the home indicator. Not visible in normal Mini App mode. | `probe.json safeEnv` |
| F18 | P3 | forms | `StandardForm`/`ToolChrome` uses `pb-28`; with a 73 px sticky bar the last field clears the bar only just on 360x740 (open settings, last row 8 px above bar). | tall shots |

What I checked and found fine: no horizontal overflow; dialogs/sheets never taller than the screen and scroll internally (`SearchDialog` 60vh scroller; panel sheet 85svh); login and pay modals fit at 420 px; loading states cause no layout shift; BackButton show/hide and closing confirmation follow the route; AppShell `h-svh` + single `#main` scroller works with the shrunk viewport; dark mode applies everywhere.

## 3. Root causes by shared component

### A. `components/forms/compact.tsx` + `components/forms/shared/index.tsx` (F1, F2, F3, F13)
Primitives were designed for a 1366 px density ("bir parametr — bir qator", «≤1 200 px @1400»).
- `Segmented` button `px-2.5 py-1 text-xs` (24 px), `Switch` `h-5 w-9`, `SelectField` `h-8 text-[13px]`, `Row` label `text-[13px]`, `Card` title `text-[11.5px]`, ⓘ `text-[11px]` + `title` only, `SettingsDetails` summary 11.5 px.
- `fields.tsx` `TextInput`/`TextArea` `text-[15px]` (< 16 → iOS zoom); other composers inline `text-[13px]`.
- ColorDots (`shared`) `size-6`.
### B. `ToolChrome.tsx` + `AppShell.tsx` (F4, F10, F11, F18)
Sticky submit bar (`sticky bottom-0`, 73 px) has no keyboard awareness; `AppShell` is `h-svh` with `#main` as scroller; no `scroll-padding-bottom`. Back link `h-8 w-8`. `TopBar.tsx` buttons 32/38 px.
### C. `ResultView.tsx` header + `ResultLayout.tsx` (F5, F8, F12-ish)
Header is a single flex row with title `truncate text-[15px]` and 3 `h-9` buttons; chips row `h-8`, panel close `size-8`; FAILED block has no action.
### D. Viewer toolbars (`components/viewers/toolbar.tsx`, `SlideToolbar.tsx`, `ResumeViewer`) (F6, F7)
Tiny 28 px icon buttons in a dark bar; resume has no reflow mode.
### E. Home (`HomeFiles.tsx`, `CreateGrid.tsx`) (F9, F10)
Fixed `grid-cols-2` card with `truncate` title and 24 px delete; one-column catalogue without navigation.
### F. Overlays (`PayDialog`, `LoginModal`) (F12) — minor.
### G. Telegram integration gaps (`MiniAppBridge.tsx`, `lib/telegram-miniapp.ts`) (F14, F17, risks)
No `disableVerticalSwipes()` (swipe-down at scrollTop 0 can minimise the app while dragging the price slider, slide stage, sorting/crossword game), no `setHeaderColor/setBackgroundColor` (header uses Telegram's colour, app bg is cream `#faf5ef`/`#111`), no `viewportChanged`/`safeAreaChanged` use, no `env(safe-area-inset-*)`, BackButton + in-app «←» duplicate.

## 4. Proposed fixes (shared-primitive first)

1. **Global coarse-pointer layer** in `app/globals.css`: under `@media (pointer: coarse)` give `button, a[role=button], [role=radio], [role=switch], summary, select, input` a ≥ 44 px hit area without changing visuals where possible (use `min-height: 44px` for rows/inputs; for dense chips use a `::after` hit-area expander `inset: -10px 0` so wrapping chip groups keep their look but the tappable area grows; keep ≥ 8 px gaps so expanded areas do not overlap). Also `input, textarea, select { font-size: 16px }` under the same query (or `max-width: 767px`). This single change addresses F1/F2/F11/F12 for ~all screens; then fix the few non-standard components individually (F9 delete, F6 toolbars).
2. **compact.tsx**: `Segmented` → 36 px high chips with 44 px expanded hit area and `overflow-x-auto` single row when > 4 options; `Switch` → 44x28 visual (or whole `Row` becomes the tap target: wrap Row with `<label>` for switch rows); `SelectField` h-11; `Card`/`SettingsDetails` titles 12 px; `Row` hint: replace `title` with a tappable ⓘ (44 px hit, 16 px glyph) that toggles an inline hint paragraph (`aria-expanded`), keep `title` for desktop. Counter text 12 px.
3. **fields.tsx / composers**: unify input class (`h-11 text-base`), remove the inline `text-[13px]` inputs (grep `text-\[13px\]` in `components/forms`).
4. **ToolChrome**: sticky bar → `position: sticky` + `padding-bottom: max(12px, env(safe-area-inset-bottom))`; while an input is focused and `visualViewport.height < 0.6 * window.innerHeight` (keyboard open) switch the bar to non-sticky/hidden (Telegram resizes the webview, so use `window.innerHeight` drop; also listen to `Telegram.WebApp.onEvent('viewportChanged')`), plus `scroll-padding-bottom: 5rem` on `#main`. Back link → 44x44 (negative margin to keep alignment). Collapse topic suggestion chips to one horizontally scrollable row.
5. **TopBar/AppShell**: topbar icons 44 px hit areas (`size-11`, drop `scale-95`), menu 44, balance pill 44 tall; keep 56 px bar. Hide Topbar's search/theme under 380 px if cramped (owner decision O5).
6. **ResultView header** (coordinate with the downloads owner, see §6): two-line header on phones — row 1: ←, title (2-line clamp `line-clamp-2`), single «Yuklab olish» button (the sheet replaces PDF/delete); delete moves to the overflow/sheet. Target header ≤ 64 px, toolbar 40 px → ≤ 104 px sticky (≈12 %). Collapse the header when scrolling down (already `group-data-[compact]` exists — extend it to hide the title row).
7. **FAILED/REVOKED**: add «Qayta urinish» (`/uz/<slug>` with the old values if draft exists) and «Fayllarimga qaytish» (44 px).
8. **Viewer toolbars**: 40–44 px buttons on `(pointer: coarse)`; page nav in a bottom pill for reading mode; resume gets the same «O'qish» reflow (use `planResume` blocks) or at least pinch-zoom hint + «To'liq ekran»; slide rail numbers 12 px.
9. **Home**: 1-column list (thumb 72 px + 2-line title + status) below 420 px, or keep grid but `line-clamp-2` title; delete → overflow «⋯» (44 px) with confirm sheet; give the direction toggle a different icon/label (ArrowUp/Down) than the sort field; add a group-chip row on `/uz/create` (Umumiy · Talaba · O'qituvchi · O'yinlar · Media) with anchors, and a visible search field.
10. **MiniAppBridge**: on mount call `disableVerticalSwipes()` (v7.7+, version-gated) for form/result/game routes, or at minimum on pages with sliders/drag; `setHeaderColor`/`setBackgroundColor`/`setBottomBarColor` to the theme `--page-bg` on theme change; hide the in-app «←» when `Telegram.WebApp.BackButton.isVisible` (BackLink reads a store flag) — or keep it and accept the duplicate (owner O3).
11. **Safe areas**: `padding: env(safe-area-inset-*)` on sticky/fixed bars, sheets and dialogs; and `Telegram.WebApp.safeAreaInset`/`contentSafeAreaInset` CSS vars (`--tg-safe-area-inset-*`) once the bridge sets them (needed only if the owner ever enables fullscreen).
12. **Regression guard**: extend the Chromium smoke (reuse `audit.cjs`/`MEASURE`) as a script `scripts/phone-audit.mts` run by hand before deploy; assert per screen: docOv=0, touch<44 ≤ agreed budget, inputs ≥ 16 px, header stack ≤ 110 px at 360x740.

## 5. Work packages (file ownership; no overlap with other agents)
Excluded (owned elsewhere): downloads/format sheet, Telegram share/save buttons, slide text-editor toolbar, essay-level option. So **do not touch** the download/PDF/share/save controls inside `ResultView.tsx`/`EditActions.tsx`, `components/viewers/slide-edit*` / SlideEditor text toolbar, `EssayComposer.tsx` level field.

| WP | Scope | Files (owned) | Model | Depends |
|---|---|---|---|---|
| P1 touch layer | coarse-pointer CSS (hit-area expander, 16 px inputs), `fields.tsx` input classes | `app/globals.css`, `components/forms/fields.tsx` | sonnet | — |
| P2 form primitives | Segmented/Switch/SelectField/Row hint-toggle/Card/Summary sizes, ColorDots | `components/forms/compact.tsx`, `components/forms/shared/index.tsx` (+ `tests/viewer/*form*` size-agnostic) | sonnet | P1 (merge together) |
| P3 form chrome + keyboard | sticky bar behaviour, scroll-padding, back link 44 px, suggestion chips row, DraftNotice | `components/forms/ToolChrome.tsx`, `components/forms/useKeyboardInset.ts` (new), `components/shell/AppShell.tsx` (scroll padding only) | opus | P1 |
| P4 shell/topbar | 44 px topbar controls, drawer rows 48 px, search dialog rows, notifications, pay/login dialogs sizing | `components/shell/TopBar.tsx`, `Sidebar.tsx`, `components/overlays/*` | sonnet | P1 |
| P5 home + catalogue | list/grid card, truncate, delete overflow, sort icon, group chips + search on `/uz/create` | `components/home/HomeFiles.tsx`, `FilePreview.tsx`, `CreateGrid.tsx` | sonnet | — |
| P6 result header/failed | compact phone header, title 2-line, FAILED actions (coordinate: downloads owner changes the button cluster — agree one merge order: downloads first, P6 second) | `components/files/ResultLayout.tsx` (header/chips), `ResultView.tsx` header block + FAILED block only | opus | downloads WP |
| P7 viewer toolbars | 40–44 px buttons, resume reading mode, rail text sizes | `components/viewers/toolbar.tsx`, `SlideToolbar.tsx`, `ResumeViewer.tsx`, `reading/*` | opus | slide-editor WP (avoid same lines) |
| P8 Telegram bridge | disableVerticalSwipes, theme/header colours, BackLink dedupe, safe-area vars | `components/telegram/MiniAppBridge.tsx`, `lib/telegram-miniapp.ts`, `components/nav/BackLink.tsx` | opus | share/save WP touches the same bridge — sequence after it |
| P9 guard | phone audit script + tests | `scripts/phone-audit.mts`, `tests/ui/touch-targets.test.mts` | sonnet | P1–P5 |

## 6. OWNER questions
1. Touch-target budget: (a) **44 px everywhere incl. a global coarse-pointer rule** (recommended; some chip rows get taller); (b) 44 px only for primary actions, 36 px for chips; (c) keep current density, fix only the worst (delete 24 px, toolbars 28 px).
2. Form hints (ⓘ): (a) **tap-to-expand inline hint** (recommended); (b) hints only on desktop; (c) remove hints on phone.
3. Duplicate back (in-app «←» + Telegram BackButton) inside Mini App: (a) **hide the in-app arrow in Telegram, keep it in browsers** (recommended); (b) keep both; (c) hide the Telegram button.
4. Result header on phones: (a) **title 2 lines + one «Yuklab olish» (sheet has PDF/delete)** (recommended; matches the download sprint); (b) keep today's 3-button row with icon-only PDF/delete; (c) hide header on scroll.
5. Topbar on 360 px: (a) **keep all icons, 44 px hit areas** (recommended); (b) move theme toggle into profile; (c) move search into the menu.
6. Home file list: (a) **1-column list with 2-line titles on phones** (recommended); (b) 2-column grid with 2-line clamp; (c) unchanged.
7. Swipe-to-minimise: (a) **disable vertical swipes app-wide in Mini App** (recommended; safest for slider/drag/games); (b) only on drag-heavy routes; (c) leave it. Needs a real-device check (Android + iOS).
8. Fullscreen Mini App mode (Bot API 8): out of scope now (a, recommended) — or plan safe-area work (b).

## 7. Risks
- Global `pointer: coarse` rules change the look of chip groups; viewer/parity surfaces (`.word-sheet*`, slide stage, reading mode) must be excluded from the global rule (scope it under `[data-ui=chrome]` or exclude `.word-sheet`). Forms size tests (≤ 1 200 px @1400 closed, `docs/research/forms3-etalon.md` §5) are desktop-only and stay valid; phone height will grow ~10–15 %.
- 16 px inputs change wrapping in tight rows (price + «tanga», author rows); re-measure the long forms (pro-slide, coursework, article).
- Keyboard handling differs: Telegram Android resizes the webview (assumed here), iOS Telegram resizes too but WKWebView also scrolls the visual viewport; real devices needed (the Chromium viewport-shrink emulation cannot show the iOS focus-zoom or the Android IME animation). `h-svh` in AppShell may need `dvh`/`--tg-viewport-stable-height` — verify on device.
- `disableVerticalSwipes` is available only from Telegram 7.7 (the stub reported 8.0); code must stay version-gated like the BackButton code.
- I did not measure a throttled production build (bundle size, cold start inside Telegram on 3G); the dev-mode numbers here are only relative. Recommend one `next build` + Lighthouse-style run with 4x CPU / Slow-4G on `/uz`, `/uz/slide`, a result page before the sprint ends.
- Unverified: `/o/<invalid>` network-idle hang (F16), real iOS focus-zoom (inferred from font-size), Telegram header-colour mismatch (needs a device screenshot).
