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

## Contract for N1–N4 (N0 delivered, 2026-10-04)

N0 is merged on top of `feat/back-nav`. Everything below is live, unit-tested (jsdom) and smoke-tested in Chromium (web 390×844 + Telegram stub). **Do not re-implement any of it; wire it.**

### What already works without your changes
- **Every `useDialog` user has a history entry** (on by default). Phone back / `page.goBack()` closes only the top dialog, the URL stays the same, and Next never sees the pop. Escape and Tab now act on the top dialog only. Closing the dialog yourself (button, Escape, unmount) pops its entry exactly once.
- **`close(); router.push(x)` / `close(); router.refresh()` are safe** (verified with the real Next 15.5 router, SearchDialog → «Balansni to'ldirish»). Same-URL pops are hidden from Next, so they cannot discard a pending navigation.
- **"open login, then navigate" in one click** (SearchDialog tool pick, Sidebar tool links, HomeFiles «Yaratish») keeps the login over the destination page with its own entry.
- **Route change closes the overlay store** (`lib/ui.ts`) when the overlay was left open from the previous page (NavProvider; same-page search-param changes do not count).
- **An internal `<a>`/`<Link>` inside a `useDialog` panel replaces the dialog's entry** (the dialog's own `onClick` still runs). `target`, `download` and `/api/…` links are untouched.
- **Index stamping, `#main` scroll restore on back/forward, admin list-URL memory** (`/admin/{users,generations,payments,broadcasts}` with filters, recorded from every URL change including `history.replaceState(null, …)`).
- **Telegram Mini App:** the BackButton is shown iff an overlay is open or the route is not a root. Its click closes the top overlay, otherwise it runs `backTo()`. Closing confirmation is on while a leave guard has pending edits. Everything is version-gated, and `offClick` runs on unmount.
- **Admin:** `NavProvider` is mounted in the root `Providers`, which `/admin/**` shares. **No admin-layout mount is needed.**

### API
```ts
// lib/nav/parents.ts (pure)
parentOf(pathname: string, search?: string | URLSearchParams | null): string | null // null = root
isRootPath(pathname: string): boolean           // /, /uz, /o/*, /admin, /admin/login, /admin/enroll
// A new app/**/page.tsx MUST get a ROUTE_RULES entry: tests/nav-pure.test.mts fails otherwise.

// components/nav/NavProvider.tsx
useNav(): {
  backTo(fallback?: string): Promise<boolean>   // guards save first; back if the previous entry is in-app,
                                                // else router.replace(fallback ?? parent). Never leaves the site.
  navigateFromOverlay(href: string, opts?: { external?: boolean }): void
                                                // overlay entry REPLACED by href (back → page under the overlay);
                                                // no overlay → push; external → pop overlay entries, then location.assign
  systemBack(): void                            // close the top overlay (history.back) else backTo()
}

// components/nav/useOverlayHistory.ts — for overlays that do NOT use useDialog
useOverlayHistory(open: boolean, onClose: () => void, opts?: { enabled?: boolean }): { isTop(): boolean }

// components/overlays/useDialog.ts — unchanged signature plus an opt-out
useDialog(open, close, opts?: { history?: boolean })  // history:false ONLY when open state lives in the URL

// components/nav/useLeaveGuard.ts — owner decision 1 (auto-save, then leave)
useLeaveGuard(pending: number, save: () => Promise<boolean | void>, opts?: { onError?(e: unknown): void }): { saving: boolean }
// save resolves false / throws = failure → navigation cancelled, onError called.

// components/nav/BackLink.tsx — «←» everywhere (real <a href={parent}>; plain click = backTo)
<BackLink fallback?="/uz" className=… aria-label="Orqaga">{icon}</BackLink>
```
Module-level equivalents (`backTo`, `navigateFromOverlay`, `systemBack`, `onNavigate`, `subscribeNav`/`getNavSnapshot`) live in `lib/nav/history.ts`. Prefer `useNav()` in components (it is bound to the component's own router context).

### N1 (consumer)
- **ToolChrome «←»** (`ToolChrome.tsx:57-63`): replace the `<Link href="/uz/create">` with `<BackLink className="…same…"><ArrowLeft className="h-5 w-5" /></BackLink>`. The parent `/uz/create` comes from the map.
- **Mobile drawer** (`AppShell.tsx` `mobileOpen`): there is no public setter, so NavProvider cannot close it. Add one line: `useOverlayHistory(mobileOpen, () => setMobileOpen(false));`. Back then closes the drawer, and a route change that leaves it open closes it.
- **Sort popover** (`HomeFiles`, store `"sort"`): it is not a `useDialog`. Add `useOverlayHistory(overlay === "sort", close)`.
- **SearchDialog / LoginModal `onDone`:** these work as they are. `navigateFromOverlay` is optional: `const nav = useNav(); close(); nav.navigateFromOverlay(href)`.
- **PayDialog → checkout:** replace `window.location.href = checkoutUrl` with `nav.navigateFromOverlay(checkoutUrl, { external: true })`. That pops the dialog's entry, so returning from Click/Payme does not land on a dead entry.
- **`?returnTo` strip:** you can strip it with `router.replace(…)` before or after opening the login. A same-page URL change while an overlay is open is carried down when it closes.

### N2 (result / viewers)
- **ResultView «←»** (`:507-513`): `<BackLink>` (parent `/uz`). After delete, use `router.replace("/uz")`, not `push`.
- **Already done by `useDialog`:** the ResultLayout sheet and the ImageViewer. Add nothing there.
- **SlideViewer present mode, SlideToolbar «Boshqa amallar», the V5a overflow menu (`toolbar.tsx`), reading mode if it is an overlay:** use `useOverlayHistory(open, close)`. For present mode, pass `present` as `open` and `() => setPresent(false)` as `onClose`. Keep the existing fullscreen exit.
- **`useDocEdit`:** call `useLeaveGuard(pending, save, { onError: () => {/* save() already sets error */} })` inside the hook. Keep the `beforeunload` effect as it is.

### N3 (admin)
- **Detail «←»** (`UserDetail`, `GenerationDetail`, `OrderDetailPage`, `BroadcastDetail`): `<BackLink>`. A plain click goes back, or to the remembered filtered list, or to the bare list. The list memory is automatic; write nothing.
- **AdminShell «Saytga qaytish»:** keep it a normal `Link` to `/uz`, because it is a section switch, not a back. The AdminShell drawer and `Modal`/`Drawer`/`Confirm`/`StepUp` already have entries through `useDialog`.
- **Audit/Errors `?id=` drawers:** these already work, verified by the unit test "same-page URL change is carried". If you switch them to the R4 design (open with `router.push(?id=)`, close with `backTo()`), the URL entry *is* the history entry. In that case pass `{ history: false }` through `Drawer` → `useDialog(open, close, { history: false })`, which needs a `history?: boolean` prop on `admin/ui/Drawer.tsx`.

### N4 (game `/o/[token]`)
- **Owner decision 2:** mid-play confirmation. `useLeaveGuard` already implements "ask before leaving". Pass the confirm as `save`, and `false` means stay:
  ```ts
  useLeaveGuard(playing ? 1 : 0, () => confirmLeave(/* «O'yindan chiqasizmi? Javoblaringiz saqlanmaydi» */), { onError: () => {} });
  ```
  - `confirmLeave` must return a `Promise<boolean>`.
  - This covers phone back, links and Telegram closing confirmation.
  - `/o/*` is a root. After a confirmed back, an `/o` page opened from a QR code with no in-app history does the real `history.back()`.
  - Use `0` before the game starts and after it ends.

### Gotchas
- **The overlay count drives the Telegram BackButton**, and only overlays with a history entry count. A `{history:false}` dialog does not make the button appear on a root.
- **`useDialog` now reads `close` through a ref.** Its effect no longer re-runs when the identity of `close` changes. Behaviour on open and close is unchanged; 768/768 existing consumer UI tests are green.
- **Unit tests that render overlays:** jsdom history is real. Call `__resetNavForTests()` from `lib/nav/history.ts` between tests that count entries (see `tests/ui/nav-history.test.mts`).
- **Device check is still owed** (lead gate):
  - Android Telegram hardware back → `backButtonClicked`;
  - iOS Telegram swipe;
  - iOS Safari edge swipe on an open dialog.
