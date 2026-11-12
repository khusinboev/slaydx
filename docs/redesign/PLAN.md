# Redesign — bottom tabs, variant A «Iliq» (2026-10-07)

Owner request: new overall UI — bottom navigation, professional look, short pleasant animations between sections, multi-step
profile settings, stronger home, each section designed on its own, perfect back navigation (phone back, Telegram BackButton,
laptop two-finger back), slightly larger text everywhere. Inventory: `R1-inventory.md`. Approved mockup:
https://claude.ai/artifact/HmDv1nFFhdeadHCxWLc8eg (variant **A**).

## Owner decisions
| # | Decision |
|---|---|
| D1 | Bottom bar: **Bosh · Ishlarim · [+] · Hamyon · Profil**, centre raised «+» opens the tool sheet |
| D2 | Bottom bar on **every screen size** (desktop too: centred floating pill, max ~560 px) |
| D3 | Visual: **variant A «Iliq»** — current brand (cream + amber) evolved; floating rounded bar, raised «+», warm cards, gradient balance hero |
| D4 | **Light AND dark mode** both designed (Kun / Tun / Avto), toggle in Profil → Ko'rinish and a quick sun/moon in the Bosh header |
| D5 | Release **once**, when everything is reviewed + browser-smoked (branch `feat/redesign`, nothing to `main` before) |

## Lead decisions (binding for agents)
- Routes: `/uz` = **Bosh** (new hub), `/uz/files` = **Ishlarim** (today's HomeFiles list, URL view state kept), `/uz/wallet` = **Hamyon**,
  `/uz/profile` = **Profil** index, `/uz/profile/<step>` = steps (`shaxsiy`, `oqish`, `ish`, `korinish`, `xavfsizlik`).
  `/uz/purchase` → redirect to `/uz/wallet` **keeping the query** (`?order=` payment return). `/uz/create` stays = full catalogue («Barchasi»).
- Back: `/uz` is the only root. Tab switch between non-home tabs **replaces** the entry (history = [Bosh, current tab]); tab → Bosh goes back
  when the previous in-app entry is `/uz`, else replace. Back from any tab → Bosh; back on Bosh → leaves (Telegram closes). Profile steps are
  real routes (push) so phone/trackpad back returns to the profile index. «+» sheet is a `useDialog` overlay (back closes it).
- Tab bar hidden on: `/uz/[slug]` tool forms (submit bar owns the bottom), `/uz/files/[id]` result/viewer, `/uz/login`, while the keyboard is
  open, and under modal sheets. `--tabbar-h` CSS variable (0 when hidden) feeds ScrollToTop, its spacer, the result toast.
- Motion: CSS only (no new dependency). Tab content enter: 180–240 ms fade + 16–24 px slide in the tab direction; step pages slide from the right;
  sheet slides up 300 ms; reduced-motion → none. Prefetch tab routes. No layout shift of the bar.
- Typography: shell, home, files, wallet, profile, sheet, tool forms, overlays: +1–2 px (body 15.5–16 px, secondary ≥ 13 px, captions ≥ 12.5 px,
  section labels 13 px uppercase tracking). NEVER change viewers/document/slide rendering (R1 §6). Do not change root rem.
- Tokens: keep brand (`--primary` #f59e0b, cream `--page-bg`, warm dark). Add `--accent-soft` (#fdecc8 / rgba(245,158,11,.16)), `--hero`
  gradient (amber → #ea7a0a, dark text), surfaces `--card` with 1px `--border`, radius 20 px cards / 24 px bar, tool colours from `TOOLS[].tc`.
- Sidebar, TopBar, mobile drawer are REMOVED from AppShell (files may be deleted once nothing imports them). Admin shell untouched.
- No backend changes; profile uses `PATCH /api/users/me` allowlist only. Payments flow (PayDialog / orders) reused unchanged.

## Work packages
| WP | Scope | Files (exclusive) | Model | Order |
|---|---|---|---|---|
| F0 Foundation | tokens + motion utilities in `globals.css` (light+dark A), `TabBar`, `CreateSheet` («+», reuse CreateGrid data + login gate), AppShell restructure (no sidebar/topbar/drawer; tab bar; `--tabbar-h`; keyboard/route hiding; page-enter animation wrapper), route files (`app/uz/files/page.tsx`, `wallet`, `profile/[step]`, purchase redirect), `lib/nav/parents.ts` rules + list memory → `/uz/files`, tab history behaviour, `PageHeader` component (title + actions, used by every tab page), temporary placeholders for Bosh/Hamyon/Profil pages, shell tests migration | `app/globals.css` (tokens/motion section), `components/shell/*`, `app/uz/**/page.tsx` + layouts, `lib/nav/*`, `lib/ui.ts`, shell/nav tests | opus | first |
| W1 Bosh | new hub: header (brand, greeting, theme quick toggle, bell, search), search box → SearchDialog, «Tez boshlash» 4 tool cards, «Davom ettirish» recent files (reuse files API), all tools by group strip | `components/home/HomeHub.tsx` (+ new files in `components/home/hub/`), tests | opus | after F0 |
| W2 Ishlarim | `/uz/files` list restyle: header, chips, sort, cards/list, empty state, URL view state, back to list memory | `components/home/HomeFiles.tsx`, `PhoneFileCard.tsx`, `FileMenu.tsx`, `FilePreview.tsx` (styling only), home tests | opus | after F0 |
| W3 Hamyon | `/uz/wallet`: balance hero (tanga + ball), «To'ldirish» → PayDialog, packages, order return banners (`?order=` polling from PurchasePage), ledger (from `fetchMe` transactions), referral card | `components/wallet/*` (new), `components/purchase/PurchasePage.tsx` (logic moved/reused), `components/profile/ReferralCard.tsx` (style), purchase/referral tests | opus | after F0 |
| W4 Profil | index (avatar, name, @username, groups of rows with value hints, admin link, logout) + steps with progress (shaxsiy: name/author/city; oqish: university→course; ish: position/organization/subject/teacher; korinish: Kun/Tun/Avto; xavfsizlik: logout / logout-all), autosave, validation, unsaved-change guard via existing nav | `components/profile/*` (except ReferralCard), profile tests | opus | after F0 |
| W5 Chrome & type | tool form chrome (`ToolChrome` header/back/submit bar look), overlays (Login, Search, Pay, Notifications, OverlayFrame), result page header (`ResultView` header area only), ScrollToTop/toast offsets with `--tabbar-h`, typography bump in `components/forms/**` shared primitives | `components/forms/ToolChrome.tsx`, `components/forms/compact.tsx`, `components/forms/shared/*`, `components/overlays/*`, `components/files/ResultActions.tsx` (toast offset only), `components/files/ResultView.tsx` (header only), related tests | sonnet→opus | after F0 |
| R Review | UI correctness + browser smoke (Chromium GPU, Telegram stub, 360×740, 390×844, 1366×768, light+dark, back paths) | read-only | opus | after W1–W5 |
| S Review | payments/auth regressions on wallet/profile/login gate | read-only | fable | after W3/W4 |

## Status
| WP | Status |
|---|---|
| R1 inventory | ✅ |
| Mockups A/B/C | ✅ owner chose A + day/night |
| F0 Foundation | ✅ merged b2d621e (29/30 mutations, smoke 127 checks; ThemeMode auto, `/uz/purchase`→`/uz/wallet`) |
| W1 Bosh, W2 Ishlarim, W3 Hamyon, W4 Profil | running (4 agents) |
| W5 Chrome & type | queued; also owns F0 hand-offs: ResultLayout `--app-topbar-h` → `var(--shell-topbar-h,0px)`, NotificationsPanel phone anchor, ResultView delete → `/uz/files`, `/uz/purchase` links → `/uz/wallet` (ToolChrome, SearchDialog, PayDialog, sitemap) |
| W1–W6, review fixes | ✅ merged; reviews S (fable) APPROVE, R (opus) APPROVE after fixes |
| Release | ✅ DEPLOYED prod 28e20aa (PR #21), 2026-10-07 |

## Home variant C «Xizmatlar panjarasi» (owner decision 2026-11-06)
Supersedes W1's home layout (and the W1 `Tez boshlash` / all-tools rows above). Data: 73 % of jobs are slides, 91 % slide + mustaqil ish + referat,
92 % of users use one tool. Mock-up: https://claude.ai/artifact/51rXgVYzggQTdMHaEF5sVv (variant C). `components/home/HomeHub.tsx`, top to bottom:
1. Header: greeting (20 px on a phone), balance chip, search icon (the shell binds Cmd/Ctrl+K; no search field in the page), theme, bell. No subtitle.
2. `HubBanner`: one `--hero` card, fixed height, snap carousel with dots from two slides up. **Auto-advance (owner 2026-11-12):** every 5 s
   (`BANNER_ROTATE_MS`) to the next slide, wrapping after the last; a dot or a swipe restarts the period. Holds while the mouse is over it, keyboard
   focus is inside (not the focus a tap leaves on a dot), a finger / mouse button is down (until released anywhere), the document is hidden, or
   within 800 ms of the user's own scroll; one slide or the skeleton = no timer; the timer is cleared on unmount. Reduced motion: still turns, but
   jumps (`motion-safe:scroll-smooth`). `aria-roledescription="carousel"`, slides `role="group"` labelled «N / M», `aria-live` off while turning,
   polite while held. Slides, in order: market (`useMarketOn`), Titul («Titul varag‘i — bepul», always), AI yordamchi (`chat`), Test ishlash
   (`tests`), Studio (always), domla (`domla`).
3. `HubGrid` (owner 2026-11-12): 12 cells, 4 × 3 on a phone, 6 × 2 from 1024 px, equal heights, labels on up to two lines. `homeCells` order:
   Slayd (ringed), Pro slayd, Mustaqil ish, Referat, Konspekt, Kurs ishi, Insho, Test ishlash, Studio, AI yordamchi, Qattiqqo‘l domla, Barchasi
   (`/uz/create`, always last). A switched-off service (tests, chat, domla) takes the next fallback, in grid order, from `homeFallbackCells`:
   O'yinlar (`/uz/create?group=oyinlar`), Rezyume, Tarjimon, Maqola — always 12 distinct targets. O'yinlar is no longer a fixed cell (reachable
   via «Barchasi»). A tool without its provider key stays, disabled.
4. «Bepul xizmatlar» (`FreeRow`, `homeFreeItems`): compact cards with icon, name, one-line promise and a «Bepul» badge — Titul, AI yordamchi
   (`chat` only), Fayl konvertatsiya, Alifbo o'giruvchi; routes from the tool / service registries. One sideways-scrolling snap row on a phone,
   wrapping from 640 px; drawn even with one card.
5. «Davom ettirish»: 3 latest files, side by side from 1024 px; signed out `SignedOutCard`; signed in without a file, no section.
6. `MarketRail`.

Until the session is known the banner and the three switch cells (Test ishlash, AI yordamchi, Qattiqqo‘l domla) are same-size skeletons. All
links (banner, grid, free row) keep `useLoginGate`. The catalogue lives in «Barchasi» and the «+» sheet; a free tool there shows the «Bepul»
badge (`FreeBadge`, `formatPrice(0)`) instead of «0 so'm dan».
