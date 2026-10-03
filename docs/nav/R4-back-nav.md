# R4 — Back navigation across SlaydX (web + Telegram Mini App)

Worktree `51a3efc`, Next `15.5.26`.

**Headline:** there is no `router.back()`, `pushState`, `popstate` or Telegram `BackButton` anywhere in the code.
- Every «←» is a fixed `<Link>` push.
- No overlay creates a history entry, so phone back always changes the route and can silently drop unsaved edits.

## 1. In-app back affordances

| Route | Affordance | Today |
|---|---|---|
| `/uz/[slug]` (all composers, ToolChrome) | ← | `<Link href="/uz/create">` (`components/forms/ToolChrome.tsx:57-63`) |
| `/uz/files/[id]` | ← | `<Link href="/uz">` (`components/files/ResultView.tsx:507-513`) |
| same, after delete | — | `router.push("/uz")` (`ResultView.tsx:183`); the deleted page stays in history |
| same, expired / empty | «Qaytadan yaratish», «Bosh sahifaga» | `<Link>` (`ResultView.tsx:672-677`, `:900`) |
| LoginModal | «Orqaga», «Bekor qilish» | change the form stage only (`components/overlays/LoginModal.tsx:285-294`, `:381-391`) |
| `/o/[token]` | «Orqaga» | goes to the previous question (`components/game/Player.tsx:229-237`) |
| `/admin/**` details | ← | `<Link>` to the **bare list, which drops the URL filters** (`UserDetail.tsx:48-51`, `GenerationDetail.tsx:202-204`, `OrderDetailPage.tsx:31-34`, `BroadcastDetail.tsx:144-146`) |
| admin shell | «Saytga qaytish» | `<Link href="/uz">` (`components/admin/shell/AdminShell.tsx:47-53`) |

`/uz/create`, `/uz/purchase`, `/uz/profile` and `/uz/login` have no back control. The profile «Bekor qilish» is an inline cancel (`ProfilePage.tsx:201-206`).

**With no history:** `router.back()` is just `history.back()`.
- In a fresh tab it does nothing.
- If the previous entry is external (Google, a Telegram link, the Click/Payme checkout from `PayDialog.tsx:59`), it **leaves the site**.
- So a naive switch to `router.back()` is unsafe.

**The fixed Links cause ping-pong:** generate, press ← (pushes `/uz`), then hardware back returns to the result.

## 2. Overlays a back press should close first

None of these pushes a history entry. A back press is a popstate, and Next soft-navigates (`next/dist/client/components/app-router.js:339-353`).

| Overlay | Code | Hardware back today |
|---|---|---|
| `useDialog` users (17); the hook does Escape, focus and scroll lock only (`components/overlays/useDialog.ts:17-72`) | LoginModal `:19`, SearchDialog `:22`, PayDialog `:29`, Notifications `:10`, TemplateGallery `:284`, ArticleTypeGallery `:85`, PublicationProfileDialog `:108`, ResumeTemplateDialog `:122`, PhotoCropDialog `:37`, admin `Modal.tsx:47` (Confirm/StepUp/…), `Drawer.tsx:30`, AdminShell drawer `:132`, ImageViewer `:48`, ResultLayout sheet `:115` | Leaves the route. When dialogs are nested, each one has its own window Escape listener (`useDialog.ts:26-30,52`), so one Escape closes all of them. |
| Overlay store `lib/ui.ts:23-35` (login, search, notifications, pay, sort); AppShell persists (`app/uz/layout.tsx:4`) | global zustand | The route changes but **the modal stays open**, because the store is never cleared on navigation. |
| Mobile sidebar drawer | `components/shell/AppShell.tsx:14,44-56` (no useDialog) | Navigates, and **the drawer stays open**. Only a link's `onNavigate` closes it (`Sidebar.tsx:36,48`). |
| Result sheet | `components/files/ResultLayout.tsx:99,107,115,197,210` | Leaves the page. |
| Image lightbox | `components/viewers/ImageViewer.tsx:42-48,148` | Leaves the page. |
| Slide present / presenter | `components/viewers/SlideViewer.tsx:110-111,214-235,441` | **Android Chrome:** probably exits fullscreen first, then `present=false` (`:228-234`); unverified. **iPhone:** no element fullscreen, so it is a CSS overlay and back leaves the page (cleanup at `:220-225`). |
| SlideToolbar «Boshqa amallar» | `components/viewers/SlideToolbar.tsx:145-205` | Leaves the page. |
| V5a overflow menu | not merged yet | Must use the same layer. |
| HomeFiles sort popover | store `"sort"` (`components/home/HomeFiles.tsx:214,221-236`) | Same as the overlay store. |
| Admin Drawer / Confirm / StepUp | `Drawer.tsx:30`, `Modal.tsx:47`, `StepUpDialog.tsx:120-158` | Leaves the page. The Audit/Errors drawers are `?id=` set with `router.replace` (`AuditPage.tsx:62-72,243,274`, `ErrorsPage.tsx:60`), so back skips them. |
| Game `/o` | stages, not overlays (`Player.tsx:74-83`) | Leaves mid-play; the answers are lost. |

**Unsaved edits are lost.**
- Every edit hook wraps `useDocEdit`.
- `useDocEdit` guards only `beforeunload` (`components/files/useDocEdit.ts:337-347`), which a popstate or Link soft navigation never fires.
- It does not flush on unmount (`:277-283`).
- So hardware back, or ←, while «Saqlash · N» is pending **drops the queue silently**. This violates FE-03 (`:39`).

## 3. Navigation semantics today

**Consumer pages**
- **HomeFiles:** filter, sort and desc are `useState` (`HomeFiles.tsx:27-29`), so they reset after back. `?returnTo=` (`:37-38`) is never removed, so a refresh reopens login.
- **Purchase:** `?order=` comes back from the external checkout (`PurchasePage.tsx:23-26`). Back from there returns to the provider.
- **Scroll:** the scroller is `<main id="main">` (`AppShell.tsx:61`), so list scroll is not restored.

**Admin lists** keep their state in the URL with replace, which is correct.
- `router.replace`: `payments/list-state.ts:71`, `AuditPage.tsx:70`, `ErrorsPage.tsx:72`, `PricingPage.tsx:71`, `Dashboard.tsx:42`, `AiPage.tsx:54`.
- `replaceState(null,…)`: `GenerationsTable.tsx:231`, `BroadcastsTable.tsx:60`, `LinksTable.tsx:132`. This is safe because Next copies its internals (`app-router.js:144-155,323-331`).
- Row clicks push the detail page (`UsersPage.tsx:194`, `OrdersTable.tsx:256`, `GenerationsTable.tsx:416`, `BroadcastsTable.tsx:149`).

**After generation**
- Every composer calls `router.push('/uz/files/<id>')`, e.g. `ToolWorkspace.tsx:248`, `SlideComposer.tsx:220` and 9 more.
- Running and done share one URL (`ResultView.tsx:319-320,647`), so back goes to the **filled form**, not to a "running" page.
- The form is filled because the server draft is flushed before submit (`SlideComposer.tsx:216`) and cleared only by «Tozalash» (`:188-190`).
- A resubmit within 30 s reuses the idempotency key (`lib/api-client.ts:482,509-520`).

**Unsaved edits:** only `beforeunload` (§2); there is no route-leave guard.

## 4. Telegram Mini App

**Today**
- The bridge does `ready()`/`expand()` plus auto-login only (`components/telegram/MiniAppBridge.tsx:11,67-103`).
- There is **no** BackButton, `backButtonClicked`, closing confirmation or `disableVerticalSwipes`.
- It is mounted on every non-admin path, including `/o` (`components/providers.tsx:56`).
- The Mini App opens at `/uz` (`lib/server/telegram.ts:400,412`).

**API** (core.telegram.org/bots/webapps, fetched 2026-10-03)

| Since | Members |
|---|---|
| 6.1 | `BackButton.isVisible/show/hide/onClick/offClick`, event `backButtonClicked` |
| 6.2 | `enableClosingConfirmation` / `disableClosingConfirmation`, `isClosingConfirmationEnabled` |
| 7.7 | `disableVerticalSwipes` |
| — | `isVersionAtLeast`, `onEvent` / `offEvent` |

**Platform behaviour.** This is not in the docs and needs a device check.
- **Android:** hardware or gesture back fires `backButtonClicked` when the button is visible. Otherwise it closes the app, asking first if confirmation is enabled. It never walks WebView history.
- **iOS:** there is no hardware back. The BackButton replaces «Close». Swipe-down minimizes or closes the app. The edge-swipe history gesture is probably off.

**Integration** (in `MiniAppSession`)
1. Show the button iff `overlays > 0 || !isRoot(pathname)`, where the roots are `/uz` and `/o/*`. Gate this on `isVersionAtLeast('6.1')`. At a root the button is hidden, so back closes the app.
2. onClick: if an overlay is open, call `closeTopOverlay()` (via `history.back()`); otherwise call `backTo(parentOf(pathname))`. Call `offClick` on unmount (StrictMode).
3. While `pending > 0`, call `enableClosingConfirmation()`; turn it off at 0. Call `disableVerticalSwipes()` in present mode and the crossword (owner's call).
4. Keep the decision pure: `telegramBackState({overlays, pathname, pending, version})` in `lib/telegram-miniapp.ts`.

## 5. Design for the Next 15 App Router

**Verified in the installed 15.5.26**
- `pushState`/`replaceState` are patched to copy `__NA` and the tree into custom data and to sync `usePathname` (`app-router.js:290-331`).
- A popstate with `__NA` traverses, which is a no-op for the same URL (`:339-353`).
- `preserveCustomHistoryState` is true for the initial render and for traverse, so custom keys survive reload and back. It is **false for navigate, refresh, server actions and HMR** (`router-reducer/{navigate:161,refresh:28,server-action:147}`).
- So a `router.refresh()` **wipes custom keys on the current entry** (`MiniAppBridge.tsx:100`, `LoginModal.tsx:48`). Keep in-memory mirrors.
- bfcache: Next resyncs on `pageshow.persisted` (`:209-229`).

**`lib/nav/` plus `NavProvider`** (mounted in `providers.tsx`)
1. **Index**
   - On every committed URL change, write `replaceState({...history.state, sx:{i}})`. The state carries `__NA`, so it passes straight through (`:311-313`).
   - A new entry gets `i = prev + 1`. The boot entry gets 0 unless it is already stamped (reload).
   - Mirror `i` in memory and sessionStorage.
2. **`backTo(fallback?)`**
   - Check the leave guard first.
   - If `i > 0`, call `router.back()`. Otherwise call `router.replace(fallback ?? parentOf(path))`, using replace so there is no ping-pong.
   - `<BackLink>` renders `<a href={parent}>` and calls `backTo` on click.
3. **`parentOf`** is a pure map (§6). Admin details read the last list URL from sessionStorage, written on every list replace.
4. **`useOverlayHistory(open, onClose)`**
   - **Stack:** module-level LIFO of `{token, onClose}`.
   - **Open:** `pushState({...state, sx:{i, o:token}}, '')` with no URL.
   - **Popstate:** if `state.sx.o !== top.token`, pop the top and call `onClose()`, marking it popped so it gets no extra `back()`.
   - **Programmatic close or unmount:** call `history.back()` exactly once (count in-flight backs). This prevents double pops and loops.
   - **Closing a non-top overlay:** use `history.go(-n)`.
5. **useDialog**
   - Add the layer inside `useDialog` (on by default, `{history:false}` opts out). One change covers all 17 users, and their `close` is unchanged.
   - Only the top dialog handles Escape.
   - The store, drawer, menus and present mode call the hook directly.
6. **Navigating from an overlay**
   - Applies to SearchDialog `close(); router.push()` (`SearchDialog.tsx:74-75,91-92,125-126`), LoginModal `onDone` and the drawer links.
   - `navigateFromOverlay(href)` marks the entry consumed and calls `router.replace(href)`.
   - Do not rely on the order of the effect cleanup vs Next's `useInsertionEffect` push; that order is **unverified**.
   - PayDialog strips the marker with `replaceState` before redirecting.
7. **Orphans** (marker but no live overlay, after a refresh or an exit while open): skip them in the direction of travel with `history.go(±1)`, comparing `i`.
8. **Route change:** NavProvider calls `useUi.close()` and closes the drawer, without `back()`.
9. **Leave guard**
   - `useDocEdit` registers `useLeaveGuard(pending, save)`.
   - While `pending > 0` it pushes one guard entry. Back pops it and asks «Saqlash va chiqish / Qolish / Saqlamasdan chiqish».
   - `backTo` and a capture-phase listener on internal `<a>` clicks consult it.
   - It also drives the Telegram confirmation, and `beforeunload` stays.
10. **Scroll:** save `#main.scrollTop` per `i` and restore it on traverse.

**Edge cases**
- **iOS Safari swipe:** an ordinary popstate (a snapshot shows first).
- **bfcache:** the overlay and its entry freeze together.
- **Admin:** same module. The Audit/Errors `?id=` drawers open with `push` and close with `backTo`.
- **`/o` from a QR code:** a root with no in-app back. A mid-game guard is the owner's decision.

## 6. Parent-route map

| Route | Parent |
|---|---|
| `/uz`, `/admin`, `/o/[token]`, `/admin/login`, `/admin/enroll` | none: root (Telegram closes the app) |
| `/uz/create`, `/uz/purchase(?order=)`, `/uz/profile` | `/uz` |
| `/uz/[slug]` (tool forms) | `/uz/create` |
| `/uz/files/[id]` | `/uz` (with HomeFiles `?filter&sort` once those are in the URL) |
| `/uz/login` | `safeReturnTo(returnTo)`, else `/uz` |
| `/admin/<section>` (users, generations, payments, broadcasts, moderation, audit, errors, finance, pricing, ai, system, settings, admins, account) | `/admin` |
| `/admin/{users,generations,payments,broadcasts}/[id]` | last list URL, else the bare list |

## 7. Tests and work split

**jsdom unit tests** (`tests/ui/*.test.mts`, one file at a time via `scripts/heavy.sh`)
- A `parentOf` table that enumerates `app/**/page.tsx` and fails on an unmapped route.
- Index stamping, including after a refresh wipe.
- `backTo` (back vs replace).
- The overlay stack: push on open, popstate closes the top, one `back()`, nested LIFO, `navigateFromOverlay` replaces, orphan skip.
- The leave guard.
- The `telegramBackState` table.
- Mutations: no fallback, no token check, no `offClick`. Each must fail a test.

**Playwright** (`playwright-core` with the cached Chromium, as in `smoke-kit/tgapp.cjs`; `WORKER_INLINE=false`, DB `:55440`)
- At 390×844, test with `page.goBack()` and with Android-like `page.evaluate(() => history.back())`.
- Each overlay closes on back and the URL stays the same.
- A deep link in a fresh tab never leaves the site, and ← goes to the parent.
- form → result → back lands on the filled form.
- Pending edits show the guard.
- Telegram stub: `BackButton{show,hide,onClick,offClick,isVisible}`, `enableClosingConfirmation`, `isVersionAtLeast`, plus `__tgBack()`.

| WP | Files (owned) | Model | When |
|---|---|---|---|
| N0 core | `lib/nav/{parents,history}.ts`, `components/nav/{NavProvider,useOverlayHistory,useLeaveGuard,BackLink}.tsx`, `providers.tsx`, `overlays/useDialog.ts`, `telegram/MiniAppBridge.tsx`, `lib/telegram-miniapp.ts`, unit tests | opus | now |
| N1 consumer | `AppShell.tsx`, `Sidebar.tsx`, `lib/ui.ts`, `overlays/{LoginModal,SearchDialog,PayDialog,NotificationsPanel}.tsx`, `ToolChrome.tsx`, `HomeFiles.tsx`, `PurchasePage.tsx` | sonnet | after N0 |
| N2 result/viewers | `ResultView.tsx` (BackLink, delete → replace), `ResultLayout.tsx` sheet, `ImageViewer.tsx`, `SlideViewer.tsx`, `SlideToolbar.tsx`, the V5a menu (`toolbar.tsx`, `reading/*`), `files/useDocEdit.ts` | opus | **after V5a + V5b merge** |
| N3 admin | `AdminShell.tsx`, the 4 detail BackLinks, `AuditPage.tsx`, `ErrorsPage.tsx`, list-URL memory | sonnet | after N0, in parallel with N1 |
| N4 game | `components/game/Player.tsx` (guard) | haiku | after the owner decides |
| Gate | Playwright web + Telegram stub, 3 sizes | lead | last |

**Conflicts with work in progress**
- V5a owns `toolbar.tsx`, `WordViewer.tsx`, `ResumeViewer.tsx` and `viewers/reading/*`.
- V5b owns `ResultLayout.tsx`, `result-layout/*`, `ArtifactViewer.tsx`, `ImageViewer.tsx` and `SlideEditor.tsx`.
- The V5b compact header will likely touch the `ResultView.tsx` header (`:505-513`), so N2 waits for both merges.
- N0, N1 and N3 touch none of those files.

**Verify on a device:**
- Android Telegram back fires `backButtonClicked`.
- The iOS Telegram swipe behaviour.
- Android Chrome back exits fullscreen.
