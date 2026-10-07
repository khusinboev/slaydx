# R1 — Shell redesign inventory (2026-10-07)

Read-only research for the redesign sprint (`docs/redesign/PLAN.md`). Paths are relative to the repo root.

## 1. Routes
Inside AppShell (`app/uz/layout.tsx:6`, also mounts `ReferralCapture` — keep):
- `/uz` → `HomeFiles` («Mening fayllarim», «Yaratish» CTA :221, filter chips/select, sort overlay, cards grid, «Yana ko'rsatish»; view state in URL `?filter&sort&desc`).
- `/uz/create` → `CreateGrid` (PageBack, search, sticky group chips :86, tool cards from `visibleToolGroups()`).
- `/uz/purchase` → `PurchasePage` (PageBack, `?order=` pay banners, top-up card → `PayDialog`, recent orders).
- `/uz/profile` → `ProfilePage` (avatar card + tanga, top-up link, Ball/Balans stats, `ReferralCard`, 11 autosaved writer fields, ledger, logout this device / everywhere).
- `/uz/files/[id]` → `ResultView` (BackLink :496, sticky header, viewer, `ResultActions`, `ResultLayout` side panel/sheet, `DownloadSheet`).
- `/uz/[slug]` → `ToolWorkspace` → Composer inside `ToolChrome` (BackLink, h1, form, sticky submit bar with price + top-up link).
- `/uz/login` → `LoginForm`; `/uz/admin` → redirect `/admin`.
Outside AppShell: `app/page.tsx` (→ /uz), `app/admin/**`, `app/o/[token]` (GamePlayer). `Providers` mounts `NavProvider` + `MiniAppBridge` except admin (`components/providers.tsx:56-59`).

## 2. Shell and where its features move
- `AppShell.tsx`: desktop aside + mobile drawer (:71-87, `useOverlayHistory` :42); Cmd+K search, Alt+T notifications (:48-64); `<main id="main">` single scroller (:106-119, submit-bar scroll padding, ScrollToTop spacer); mounts ScrollToTop, LoginModal, SearchDialog, NotificationsPanel, PayDialog (:123-127), SessionBanner (:137).
- `Sidebar.tsx`: brand → /uz (:56), «Yaratish» (:74), 22 tools grouped with login gate when signed out (:39-45, :83), Admin link if `isAdmin` (:117), profile card / «Tizimga kiring» (:127-170).
- `TopBar.tsx`: drawer toggle (:60), search (:74), theme toggle (:84), notifications (:94, panel is an empty stub), balance pill → `/uz/purchase` (:110), avatar → `/uz/profile` (:130), «Kirish» (:151).

| Lost feature | New home |
|---|---|
| Tool list + login gate | «+» sheet (reuse CreateGrid / `catalogue-filter.ts`) |
| Admin link | Profil |
| Theme toggle | Profil → Ko'rinish |
| Search + Cmd+K | Bosh / Ishlarim header icon |
| Balance pill | Hamyon (tab + Bosh header chip) |
| Brand | Bosh header |
| Notifications (stub) | Bosh header bell (kept) |
| Login CTA | Profil when signed out |
`PageBack.tsx` (CreateGrid:49, PurchasePage:114, ProfilePage:105) is not needed on tab roots.

## 3. Bottom collisions
| Element | Ref | Note |
|---|---|---|
| Tool submit bar | `ToolChrome.tsx:117-119` | sticky bottom-0, `[data-submit-bar]` sticky/inline via `useKeyboardInset` |
| EditDoneBar | `EditDoneBar.tsx:89-93` | fixed z-30, bottom `var(--kb-h)` |
| ScrollToTop | `ScrollToTop.tsx:54,58,307,312` + spacer `AppShell.tsx:116` | fixed z-30 |
| Result toast | `ResultActions.tsx:460-467` | z-70 bottom 16px, env() only |
| ResultLayout sheet | `ResultLayout.tsx:355-371` | z-40/z-50 |
| DownloadSheet | `DownloadSheet.tsx:375-394` | z-60/61 |
| FileMenu | `FileMenu.tsx:36-46` | |
| Present mode | `SlideViewer.tsx:511` | fixed inset-0 z-50 |
| Overlays | `OverlayFrame.tsx:49` | |
Viewer height math: `ResultLayout.tsx:270` hard-codes `--app-topbar-h: 3.5rem`; `--result-fill-h` = 100svh − topbar − header; `useVisiblePage.ts:26` reads it.
Safe areas: `components/shell/safe-area.ts` (`SAFE_BOTTOM = var(--tg-safe-bottom, env(...))`, written by `lib/telegram-miniapp.ts:300-321`); Telegram bottom-bar colour `MiniAppBridge.tsx:289`.
Hide the tab bar on: `/uz/[slug]` (submit bar owns the bottom), `/uz/files/[id]` (viewer), `/uz/login`, keyboard open, under modal sheets. Show on `/uz`, `/uz/files`, `/uz/wallet`, `/uz/profile/*`. Add `--tabbar-h` for ScrollToTop, spacer, toast.

## 4. Back navigation
- `lib/nav/parents.ts`: `ROUTE_RULES` (:48, first match wins); `UZ_RESERVED` (:43) — add `wallet` (else `/uz/wallet` falls into `[slug]`); `isRootPath` (:96) drives the Telegram BackButton (`lib/telegram-miniapp.ts:209-213`, bridge `MiniAppBridge.tsx:348-415`).
- List memory: `HOME_LIST="/uz"`, `HOME_VIEW_KEYS` (:129-131), `isListPath`/`listParentOf` (:134-141) — must point to `/uz/files` if the list moves; `/uz/files/[id]` parent → `/uz/files`.
- Proposed: `/uz/files`, `/uz/wallet`, `/uz/profile` parent `/uz` (`/uz` stays the only root so back from a tab returns home instead of closing the Mini App); `/uz/profile/<step>` parent `/uz/profile`; `/uz/purchase` → alias/redirect to wallet.
- «+» sheet: `useDialog`/`useOverlayHistory` so back closes it (new `Overlay` in `lib/ui.ts:8`).
- `NavProvider` restores `#main` scrollTop per history index (:65-121), closes overlays on navigation (:49-63) — keep `id="main"`. Trackpad back = same popstate engine.
- `tests/nav-pure.test.mts:46` fails on a page without a rule; :57-103 parent table + `isRootPath`.

## 5. Tests locking today's structure
shell-phone (:140-343 TopBar/Sidebar sizes, overlays anchored at 3.5rem), nav-consumer (:114-144 drawer, :164-235 HomeFiles URL state, :266-296 ToolChrome/PageBack parents), scroll-to-top (:718-941 AppShell wiring, spacer, drawer), topup-cta:57 (balance pill), theme:96,110 (toggle in TopBar), store-hydration:32-57, ui-strings:41 (TopBar aria), pricing:603 (Sidebar + CreateGrid call `visibleToolGroups()`), subs-removed (:140 profile Ball/Balans + top-up, :151 Sidebar, :160 search → purchase), home-phone, home-files, purchase-poll, referral-card, session-resilience:149, login-returnto, tool-chrome-keyboard:367 (PageBack 32/44), miniapp-shell, nav-telegram, result-layout, result-flow.

## 6. Typography
No `html` font-size; body 16px (`globals.css:253`); coarse-pointer inputs 16px (:218-221). In `components/` outside viewers/admin: 124× `text-[10-12px]`, 87× `text-xs`, 84× `text-[13-15px]`, 153× `text-sm` (densest: forms/shared/index.tsx, ArticleComposer, GameSharePanel, TranslationForm, TemplateGallery, LoginModal).
DO NOT CHANGE (must match DOCX/PPTX): `components/viewers/**`, `.word-sheet` and doc pt sizes (`globals.css:310-469`), `measure.tsx:104`, `WordViewer.tsx:678` (14pt), SlideCanvas, FilePreview/SlideThumb, ResumePage. Do not raise the root rem (viewer chrome uses rem; 44 px tests pin px) — bump classes per component.

## 7. Tokens and motion
`globals.css` `:root` (:20-77), `.dark` (:80-130), `@theme inline` (:133-177; Geist sans, Tinos doc); custom dark variant (:18); keyframes only `slx-shimmer`/`slx-typing` with reduced-motion (:557-596). No framer-motion / tw-animate / View Transitions; no new dependency — CSS transitions/keyframes only. Icons: lucide-react; `TOOL_ICONS` (`components/shell/icons.tsx`, test-locked).

## 8. Profile data
`api.updateProfile` → `PATCH /api/users/me` (`app/api/users/me/route.ts:23-59`), allowlist: name, language, university, faculty, department, group, course, author, subject, teacher, city, position, organization (strings ≤ 200, 30 req / 300 s). GET returns user + 30 transactions. `ServerUser` also: telegramId, username, photoUrl, points, quota, balance, phone, isAdmin.
Possible without backend: name, study (university → faculty → department → group → course), teaching (position, organization, subject, teacher), city, theme, referral, ledger, logout(-all), admin link. Needs backend: phone change, photo upload, notification prefs, account deletion, paginated ledger > 30, Telegram link/unlink.
