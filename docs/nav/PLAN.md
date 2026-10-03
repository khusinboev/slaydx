# Back navigation — plan (2026-10-04)
Research: `R4-back-nav.md` (inventory, Next 15.5 history internals, Telegram Mini App API, design, parent map, work split).
Owner request: in-app «←» buttons and the phone's hardware/gesture back must work professionally everywhere — website (mobile browsers) and Telegram WebApp.
## Owner decisions
1. Unsaved document edits on back: **auto-save then leave** (no prompt). If the save fails, stay on the page and show the error. `beforeunload` stays for tab close.
2. Public game `/o/…` mid-play back: **confirm** «O'yindan chiqasizmi? Javoblaringiz saqlanmaydi» (no prompt before the game starts or after it ends).
## Design (from R4 §5, binding)
`lib/nav/` (history index stamped into history.state with in-memory/sessionStorage mirror, `backTo(fallback)` = back when the previous entry is in-app else `router.replace(parentOf(path))`, pure `parentOf` map), `NavProvider` (route change closes overlay store + drawer, scroll restore of `#main`), `useOverlayHistory` built into `useDialog` (push on open, popstate closes top, programmatic close pops once, nested LIFO, orphan skip, `navigateFromOverlay` replaces), `useLeaveGuard` (auto-save per decision 1), Telegram BackButton in `MiniAppSession` (visible iff overlay open or non-root route; onClick → close top overlay or backTo; closing confirmation while saving pending; root routes `/uz`, `/o/*`), `<BackLink>` replacing fixed «←» Links.
## Work packages
| WP | Files | Model | When |
|---|---|---|---|
| N0 core | `lib/nav/*`, `components/nav/*`, `components/providers.tsx`, `components/overlays/useDialog.ts`, `components/telegram/MiniAppBridge.tsx`, `lib/telegram-miniapp.ts`, unit tests | opus | first |
| N1 consumer | `AppShell.tsx`, `Sidebar.tsx`, `lib/ui.ts`, overlays (LoginModal, SearchDialog, PayDialog, NotificationsPanel), `ToolChrome.tsx`, `HomeFiles.tsx`, `PurchasePage.tsx` | sonnet | after N0 |
| N2 result/viewers | `ResultView.tsx`, `ResultLayout.tsx` sheet, `ImageViewer.tsx`, `SlideViewer.tsx`, `SlideToolbar.tsx`, `toolbar.tsx` menu, `reading/*`, `files/useDocEdit.ts` (leave guard) | opus | after N0 |
| N3 admin | `AdminShell.tsx`, detail BackLinks, `AuditPage.tsx`, `ErrorsPage.tsx`, list-URL memory | sonnet | after N0 |
| N4 game | `components/game/Player.tsx` confirm | haiku | after N0 |
| Gate | Playwright web + Telegram stub at 390/1366/1920; device check by the owner (Android Telegram back, iOS swipe) | lead | last |
