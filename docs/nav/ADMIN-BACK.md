# Admin panel back navigation — findings and fix (2026-10-10)

Owner report: on a phone, Profil → «Admin panel» opens the panel and then neither the phone's back
button/gesture nor any in-app control returns to the profile.

Setup: Chromium 390×844 (mobile, touch), Next dev (turbopack), throwaway Postgres DB on the test
instance, an owner admin account (simple mode, `ADMIN_2FA_REQUIRED` off), real session cookie.
Telegram Mini App emulated with a `window.Telegram.WebApp` stub (`BackButton.show/hide/onClick/offClick`,
`isVersionAtLeast`) plus `TelegramWebviewProxy` and a `#tgWebAppVersion=8.0&tgWebAppPlatform=android`
launch fragment (a reply-keyboard style launch, so no signed `initData` is needed).

## What actually happens (before the fix)

Format: `url  history.length  history.state.sx` (`sx.i` = the nav engine's entry index; `o` = overlay marker).

### Browser

| Step | Result |
|---|---|
| `/uz` → tab Profil → «Admin panel» | `/admin  len=4  sx{i:2}` |
| `page.goBack()` | `/uz/profile  sx{i:1}` — works |
| `goBack()` again | `/uz  sx{i:0}` — works, no ping-pong |
| `/admin` → Narxlar (drawer) → `history.back()` | `/admin  sx{i:2}` → `/uz/profile  sx{i:1}` — works |
| Phone back with the admin nav drawer open | drawer closes, stays on `/admin` — works |
| Fresh tab at `/admin/pricing` | `/admin/pricing  len=2  sx{i:0}` — **no in-app back control at all** (the mobile header has only the menu button), the system back leaves the site |

The consumer nav layer hands over cleanly: `NavProvider` is mounted in the root `Providers` (not only
under `/uz`), so the engine keeps stamping `sx.i` on `/admin` entries, no sentinel/duplicate entries are
left behind, no stale `pushState` patch. The doc line «not mounted on admin» is true only of the consumer
`AppShell` and of `MiniAppBridge` (see below). Plain browser history back from the profile → admin flow
works; the missing piece in browsers is an in-app «←» (deep link, fresh tab, installed PWA).

### Telegram Mini App (the reported failure)

| Step | BackButton |
|---|---|
| `/uz` (root) | hidden, 1 click handler |
| `/uz/profile` | shown (`show`), 1 handler |
| click «Admin panel» → `/admin` | **still visible, 0 handlers** (log: `onClick,hide,show,offClick`) |
| press BackButton / Android back | nothing happens, URL stays `/admin` |
| Fresh Mini App launch directly at `/admin` | **never shown, never wired** (log empty) |

## Root cause

1. `components/providers.tsx:~60` renders `{onAdmin ? null : <MiniAppBridge />}`. Navigating profile →
   `/admin` unmounts the bridge: `useTelegramBack`'s cleanup calls `BackButton.offClick(handler)`, but
   nothing calls `hide()`, so Telegram keeps the button **visible with no click handler** — a dead
   button, and Android's hardware back (which fires `backButtonClicked` while the button is visible) does
   nothing. On a direct launch at `/admin` the bridge is never mounted at all.
2. `lib/nav/parents.ts:~48` maps `/admin` to `parent: null` (a root). Even with the bridge mounted,
   `telegramBackState` (`lib/telegram-miniapp.ts:210`, `!isRootPath`) would hide the button on `/admin`,
   and `backTo()` would have no fallback target.
3. `components/admin/shell/AdminShell.tsx` has no back control on phones (menu button + brand + theme
   only), so a fresh-tab/deep-link visit cannot go back in-app; the only exit is «Saytga qaytish» in
   the drawer (→ `/uz`, a push).

## Fix

- `lib/nav/parents.ts`: `/admin` → `/uz/profile` (login/enroll stay roots). Sections → `/admin`,
  details → last list URL, as before.
- `components/telegram/MiniAppBridge.tsx` + `components/providers.tsx`: the bridge stays mounted on admin
  paths with `admin` mode — Telegram shell, script, BackButton hand-over — but it does NOT run the
  consumer login/account-switch or the `?bt=` link exchange there (the panel has its own session). One
  bridge instance across profile ↔ admin means no unmount, no stale button.
- `components/admin/shell/AdminShell.tsx`: a «←» (`BackLink`) in the mobile header (hidden inside a
  working Telegram BackButton, as everywhere); a plain click is back when the previous entry is in-app,
  else a REPLACE with the parent (`/admin` → `/uz/profile`, section → `/admin`).

## After the fix

See the PR description for the re-run table (same scenarios, all passing).
