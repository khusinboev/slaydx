# SlaydX Frontend Audit (SCOUT Report)

**Scope:** `components/` (106 files), `lib/*.ts` client-side modules, `lib/viewers/`, `lib/game/`, `app/**/page.tsx` (client components).  
**Date:** 2026-09-23  
**Status:** Read-only cartographic analysis.

---

## 1. App Shell & Navigation

| Component | Location | Purpose |
|-----------|----------|---------|
| **AppShell** | `components/shell/AppShell.tsx:1–68` | Main layout: sidebar (desktop), topbar, modals (login, search, notifications, payment) |
| **Sidebar** | `components/shell/Sidebar.tsx` | Navigation: tool menu (`lib/tools.ts TOOL_GROUPS`), file list, account |
| **TopBar** | `components/shell/TopBar.tsx` | Breadcrumb, balance display, mobile menu toggle |
| **Routes** | `app/uz/*/page.tsx` | `/uz` (home), `/uz/create` (tool workspace), `/uz/files/[id]` (result viewer), `/uz/login`, `/uz/profile`, `/uz/purchase`, `/uz/admin`, `/o/[token]` (public game player) |
| **Public Game** | `app/o/[token]/page.tsx:1–44` | Unauthenticated game player; `noindex, nofollow` metadata; token resolved client-side via `GamePlayer` component; `force-dynamic` + `private, no-store` JSON cache headers |
| **Error Boundary** | `app/error.tsx:1–46` | Renders error digest + retry button; logs to console |
| **Layout** | `app/layout.tsx`, `app/uz/layout.tsx` | Root & app layouts; app shell wraps `children` |

**Navigation Flow:**
- **Tool workspace:** `/uz/create` → select tool slug → `ToolWorkspace` → `<Tool>Composer` form → `runGeneration` → polling → `/uz/files/{id}`
- **Viewer pages:** `/uz/files/[id]` → `ResultView` → fetch + poll → render viewer (SlideViewer, WordViewer, TranslationViewer, etc.)
- **Account:** `/uz/profile`, `/uz/purchase`, `/uz/admin` (conditional on `user.isAdmin`)
- **Game:** `/o/[token]` → public, no auth required

---

## 2. Client ↔ Server Contract

### Request/Response Layer

| Function | Location | Method | Purpose | Error Handling |
|----------|----------|--------|---------|-----------------|
| **request()** | `lib/api-client.ts:42–85` | Fetch wrapper | All API calls; httpOnly cookies via `credentials: "same-origin"` | 401 → `onUnauthorized()` handler; non-2xx → `ApiError(message, status, data)` |
| **setUnauthorizedHandler()** | `lib/api-client.ts:33–35` | Store callback | Clears session on 401 | Called from `lib/store.ts:55–64` |
| **mergeLive()** | `lib/api-client.ts:291–294` | State merge | Merges `live` field from polling response (`L4` feature) | N/A |
| **nextPollDelay()** | `lib/api-client.ts:302–305` | Backoff calc | `live` + `IN_PROGRESS` → 1.2s; else 1s → 5s exponential | N/A |

### Generation Status Polling

| Flow | Location | Mechanism | Stop Condition |
|------|----------|-----------|-----------------|
| **pollGeneration()** | `lib/api-client.ts:367–408` | `getGeneration(id, ?since)` loop | Status ≠ "QUEUED"/"IN_PROGRESS" or 20 min deadline or AbortSignal |
| **Live sequence** | `lib/api-client.ts:278–281` | `?since=liveSeq` query param | Server omits unchanged `live` field; client preserves previous state |
| **Backoff** | `lib/api-client.ts:302–305` | 1.2s if live+in-progress, else 1–5s | Network error retry ≤5 (2s exponential) before throw |
| **UI binding** | `components/files/ResultView.tsx` | `pollGeneration(id, onTick, signal)` + `upsertGeneration()` store | `<AbortController>` cleanup on unmount |

### Edit APIs

| Endpoint | Method | Body | Response | Errors |
|----------|--------|------|----------|--------|
| `/api/generations/{id}/doc` | PATCH | `{ baseVersion, ops: unknown[] }` | `{ generation: GenerationDetail }` | 409 w/ `code` (version/status/legacy/no_prev) → `editErrorCode()` / `editErrorText()` |
| `/api/generations/{id}/rebuild` | POST | `{}` | `{ fileVersion, docVersion, rebuilt }` | Triggers on `docVersion` > `fileVersion` |
| `/api/generations/{id}/slides/{i}/image` | POST | multipart + `baseVersion` | `{ generation }` | 413 (fayl >5MB), 415 (not PNG/JPEG), 429 (rate) |
| `/api/generations/{id}/photo` | POST | multipart ± `baseVersion` | `{ generation }` | 413, 415, 422 (size), 429 |
| `/api/generations/{id}/rewrite` | POST | `{ baseVersion, fix: {op, target, instruction} }` | `{ generation, ops }` | 409 (version) |
| `/api/generations/{id}/polish` | POST | `{ baseVersion }` | `{ generation, ops, polish: PolishLog }` | 409 (version), 429 (3/article, 20/user/day) |

**Version Conflict (409):** On mismatch, `editErrorCode()` returns code; caller (e.g., `useSlideEdit`) reloads via `getGeneration()`.

---

## 3. Auth on the Client

### Session & Cookies

| Mechanism | Storage | Validation | Lifespan |
|-----------|---------|------------|----------|
| **httpOnly cookie** | Server-set (request via `credentials: "same-origin"`) | Never read client-side; verified server-side on each request | Session duration (server-defined) |
| **User state** | zustand store `useAppStore.user` | Populated from `/api/auth/session` on app init (`Providers` effect) | Refreshed on each login; cleared on 401 or logout |
| **Session check** | `fetchSession()` (`lib/api-client.ts:129–131`) | Polled once at mount in `Providers.tsx:15–21` | Sets `sessionChecked` + `loggedIn` flags |
| **localStorage** | `slaydx-ui` key (zustand persist) | **ONLY:** `{ theme, locale, dir }` (v2) | Persisted across sessions; no auth/balance data |

### Login Flows

| Flow | Trigger | Steps | Notes |
|------|---------|-------|-------|
| **Telegram Mini App** | Automatic in `LoginForm.tsx:78–88` | 1) Read `window.Telegram.WebApp.initData` → 2) `loginWithTelegram({initData})` → 3) `finish(user)` | No OTP; auto-login if inside TMA |
| **Telegram Bot** | Button in form | 1) `createLoginTicket()` → 2) `window.open(url, "_blank")` → 3) Poll `fetchSession()` every 2s (expires 5 min) → 4) `finish(user)` | Session set in popup; parent polled via `useEffect` timer (LocationModal.tsx:118–139) |
| **Phone OTP (dev)** | Feature flag `features.devLogin` | 1) `requestOtp(phone)` → 2) Receive code (dev: shown in hint) → 3) `verifyOtp(phone, code)` → 4) `finish(user)` | Dev-only; prod flag disabled |

**Logout:** `logout(all?)` → `request(DELETE /api/auth/session)` → clear `user` store + navigate.

### localStorage Keys & Sensitivity

| Key | Value Type | Sensitivity | Notes |
|-----|------------|------------|-------|
| `slaydx-ui` | `{ theme: "light"│"dark", locale: "uz"│"en"│…, dir: "ltr"│"rtl" }` | **PUBLIC** | UI preferences only; no auth/balance; version 2 migrates old "system" theme to OS query |

**Security Note:** User/balance data never stored locally (see CLAUDE.md line 15–16: all pul/balance in server response, not localStorage).

---

## 4. State Management

### zustand Stores

| Store | Module | Persisted | Keys | Mutations |
|-------|--------|-----------|------|-----------|
| **useAppStore** | `lib/store.ts:100–214` | ✓ (v2, UI only) | `hydrated`, `sessionChecked`, `loggedIn`, `user`, `features`, `generations`, `generationsLoaded`, `theme`, `locale`, `dir` | `refreshSession()`, `refreshGenerations()`, `setUser()`, `upsertGeneration()`, `dropGeneration()`, `signOut()`, `setTheme()`, `setLocale()`, `setDir()`, `resetUiPrefs()` |
| **useUi** | `lib/ui.ts:22–33` | ✗ | `overlay` (login│search│notifications│pay│lang│sort), `returnTo`, `payPlan` | `open(overlay, extra?)`, `close()` |

### Form Drafts (Server-side)

| Tool | Endpoint | Table | Behavior |
|------|----------|-------|----------|
| **All tools** | `/api/forms/{toolId}/draft` (GET/PUT/DELETE) | `form_drafts` | `useFormDraft(toolId)` hook saves FormValues; resume has alias `getDraft/putDraft/clearDraft()` |

### Theme & Locale

- **Theme:** zustand persist + `applyTheme()` sets `document.documentElement.classList.toggle("dark")`
- **Locale:** zustand + server `users.language` column; UI queries prefer `user.language`
- **Dir:** zustand + `document.documentElement.setAttribute("dir")`
- **OS theme resolution:** `resolveOsTheme()` reads `window.matchMedia("(prefers-color-scheme: dark)")` once at hydration

**Migration:** Zustand `migrate()` converts old `"system"` to OS query (CLAUDE.md L185–190); SSR-safe (checks `typeof window`).

---

## 5. Rendering of Untrusted Content

### dangerouslySetInnerHTML Sites (2 total)

| File | Line | Content | Sanitization |
|------|------|---------|---------------|
| `components/files/GameSharePanel.tsx` | `~` | QR SVG (`qrcode` lib output) | **SAFE:** Generated by qrcode library; immutable input (token string) |
| `components/viewers/WordViewer.tsx` | Formula | KaTeX HTML output | **SAFE:** `katex.renderToString(item.latex, {strict: "ignore"})` with LaTeX source from parsed document; test marks `data-formula` |

### innerHTML / contentEditable / srcDoc

| Feature | File | Type | Concern | Mitigation |
|---------|------|------|---------|-----------|
| **contentEditable** | `components/viewers/SlideEditor.tsx` | Text layer in slide | User edits live HTML; `Ctrl+Z` undo | Apply ops atomically via PATCH; versioning prevents conflicts |
| **contentEditable** | `components/viewers/ArticleEditor.tsx` | Word document text | User edits body/abstracts | Op-based editing; server parses + validates |
| **contentEditable** | `components/viewers/resume/ResumeEditor.tsx` | Resume sections | User edits fields | Form-like interface; structured data model |
| **iframe** | `components/viewers/TranslationViewer.tsx` | PDF embed | Translated document | `src={fileUrl(gen.id, "pdf", {inline: true})}` — server-generated PDF, no untrusted content |

### href / src Handling

| Location | Pattern | Risk | Mitigation |
|----------|---------|------|-----------|
| **Image src** | `components/viewers/WordViewer.tsx` (item.url) | LLM-generated doc image URLs | `item.url` from parsed AcademicDoc; server validates on fetch; img load failures silent |
| **Link href** | Sidebar/nav | App routes + external | Next.js `<Link>` (client routes), hardcoded URLs for Telegram/external | N/A (trusted) |
| **Logo src** | `components/forms/SlideComposer.tsx` | User-uploaded logo | Multipart upload via `uploadLogo()` → server sniffs MIME, validates, stores; client refs `assetId` | Server validation + asset ID indirection |

### SVG / Data URIs

- **QR code:** `dangerouslySetInnerHTML` of `qrcode` library output (immutable, library-trusted)
- **No inline Data URIs** from user content detected
- **No eval / new Function** detected

---

## 6. Error & Loading States

### Error Boundaries & Suspense

| Location | Boundary Type | Fallback | Recovery |
|----------|---------------|----------|----------|
| **Root** | `app/error.tsx` | Error digest + retry button | `reset()` re-renders; fatal errors caught |
| **Home** | `app/uz/page.tsx` | `Suspense` → "Yuklanmoqda..." | HomeFiles fetches on mount |
| **Purchase** | `app/uz/purchase/page.tsx` | `Suspense` (useSearchParams requires) | PurchasePage renders order history |
| **File viewer** | `app/uz/files/[id]/page.tsx` | No Suspense; ResultView handles async | `ResultView` uses state + polling; shows "Yuklanmoqda..." in state |

### Polling Failure Modes

| Scenario | Behavior | User Sees |
|----------|----------|-----------|
| **Network error ≤5 retries** | Exponential backoff (2s→10s); continue polling | Loading spinner (no error) |
| **Network error >5 retries** | Throw ApiError | Error banner: "Internetga ulanib bo'lmadi" |
| **20 min timeout** | Throw ApiError (code 504) | "Ish juda uzoq davom etmoqda" → suggest retry later from file list |
| **AbortSignal (unmount)** | Catch DOMException(AbortError), return | Cleanup; no error to user |
| **No status change (stuck IN_PROGRESS)** | Polling continues; 20 min cutoff applies | Spinner indefinitely until timeout |

### Blank/Stuck Screens

| Risk | Mitigation |
|------|-----------|
| No Suspense fallback on detail pages | `ResultView` shows loading state via zustand + effect |
| contentEditable field loses focus | Blur handler saves via PATCH; autofocus restores on reload |
| Polling timeout + no error display | `ResultView` catches all errors; shows alert or retry prompt |

---

## 7. Heavy Client Dependencies & Performance

### Bundle Impact

| Import | Module | Size | Purpose | Client | Notes |
|--------|--------|------|---------|--------|-------|
| **katex** | `components/viewers/WordViewer.tsx:1` | ~80 KB min | Formula rendering (LaTeX→HTML) | ✓ | Imported in viewer (on-demand); renderToString synchronous; `strict: "ignore"` |
| **qrcode** | `components/files/GameSharePanel.tsx` | ~5 KB | QR SVG generation | ✓ | Imported in share panel (on-demand) |
| **lucide-react** | Multiple components | ~200 KB icons | Icon set (tree-shaken) | ✓ | Widely used; tree-shaken by bundler |
| **zustand** | `lib/store.ts`, `lib/ui.ts` | ~2 KB | State management | ✓ | Minimal deps |
| **professions.json** | `lib/professions.ts:13` | **570 KB** | Profession search index | ✓ | Imported only in ResumeComposer; flattened arrays (KEY_TEXT, KEY_OWNER, KEY_FIELD) for fast binary search |
| **curriculum/* JSON** | `lib/curriculum.ts` | ~5 MB total | Curriculum data (8 subjects × grades) | ✗ (Lazy) | Lazy-loaded via `/api/curriculum?subject=&grade=` (not bundled) |

### Re-render Hotspots

| Location | Risk | Mitigation |
|----------|------|-----------|
| **useAppStore mutations** | All subscribers re-render (user, generations, theme changes) | Zustand selector `(s) => s.field` isolates to single key |
| **ResultView polling** | `setGen(g)` every 1–5s during IN_PROGRESS | `onTick` handler batches state; Suspense avoids re-mount thrash |
| **SlideViewer timer** | Elapsed timer fires every 1s (revision tracker) | `setElapsed()` re-renders viewer; contentEditable preserved |
| **Form field changes** | Each keystroke → `setValues()` → all form re-renders | Composer components memo'd; controlled inputs debounce if needed |

### Large Data Files

- **professions.json (570 KB):** Imported inline in rezyume form; flattened index avoids O(n²) search
- **curriculum (500 KB each):** Lazy-loaded server-side; klient fetches only selected subject

---

## 8. i18n

### UI Strings

| Scope | Organization | Hardcoding | Notes |
|-------|--------------|-----------|-------|
| **Components** | `components/**/*.tsx` | O'zbekcha hardcoded | Button labels, aria-labels, error messages; no dictionary |
| **Tools/metadata** | `lib/tools.ts` | O'zbekcha hardcoded | Tool names, descriptions, field labels |
| **Generation** | `lib/generation/i18n.ts` | `sectionLabels(lang)`, `docLabels(lang)` | Document-internal labels (O'zbek, Rus, Eng per tool) |
| **UI locale** | `lib/ui.ts:35–42` | Hardcoded array | UI_LOCALES: uz, en, ru, kaa, kk, ky |
| **Overlays** | `components/overlays/**` | O'zbekcha | Login, search, notifications — no translation |
| **Game** | `components/game/**` | O'zbekcha | Quiz/crossword text from doc |

### Language Modes

| Setting | Storage | Usage | Affects |
|---------|---------|-------|---------|
| **UI language** | `useAppStore.locale` (localStorage + server `users.language`) | Component strings + prompt language (rare) | Label language only; doc language is independent |
| **Doc language** | `FormValues.language` | Passed to engine → `GenerationMeta.language` → document content language | AcademicDoc rendered in chosen language; UI stays in UI locale |

**Example:** Form submitted with `language: "en"` → document in English; UI remains in user's preferred locale (default "uz").

---

## 9. Observations for Auditors

1. **Polling & Liveness (Line 367–408 api-client.ts):** Polling backs off 1.2s if `live` + `IN_PROGRESS`, else 1–5s exponential. Deadline 20 min prevents infinite loops. `liveSeq` query param enables delta updates. **No SSE/WebSocket**—HTTP polling only. Network errors retry ≤5 times before throwing; AbortSignal cleanup on unmount.

2. **Untrusted Content (2 dangerouslySetInnerHTML sites):** Both safe—QR code from qrcode library + KaTeX formula output. No user LLM text rendered as HTML. Document image URLs (`item.url`) are parsed from server AcademicDoc; server validates on storage. No `eval` or `new Function` detected.

3. **Auth: httpOnly Cookie + Session State (store.ts:117–126):** Session verified once at app init via `fetchSession()`. Cookie never readable client-side. 401 → `onUnauthorized()` clears user state immediately. localStorage holds **only** UI prefs (theme, locale, dir); no auth/balance. Balance/user fetched fresh on each login + refresh action.

4. **Version Conflicts (api-edit.ts:65–70):** PATCH `/api/generations/{id}/doc` takes `baseVersion` (docVersion) + ops. 409 `code` tells caller whether conflict is version/status/legacy/no_prev. Client (`useSlideEdit`) reloads on conflict. No optimistic commit without server ack.

5. **Heavy Dep (professions.json 570 KB):** Imported into ResumeComposer bundle only. Flattened index (KEY_TEXT, KEY_OWNER, KEY_FIELD arrays) enables O(1) avg-case binary search. Curriculum (5 MB+) lazy-loaded server-side; client fetches `/api/curriculum?subject=&grade=` only when needed. KaTeX (~80 KB) imported in WordViewer (on-demand). **Bundle impact:** Professions + KaTeX + icons ~ 280 KB gzipped (estimated); tree-shaking active.

6. **contentEditable in Editors (SlideEditor, ArticleEditor, ResumeEditor):** All use atomic PATCH ops + versioning. Blur/unmount handlers save state. Undo implemented via `inverseOps()`. No direct HTML manipulation. Text input validated server-side. Op conflicts resolved by 409 + reload.

7. **Blank/Stuck Risk:** `ResultView` sets loading state on mount + polls. No Suspense fallback timeout. If polling hangs >20 min, throws error (code 504) + shows alert. If network fails, retries 5× then throws. AbortController cleanup prevents orphan requests on unmount.

---

## Summary Metrics

- **Routes:** 8 main pages + game + admin + purchase
- **API endpoints called:** ~15 (auth, generation, edit, upload, curriculum, draft, admin, payment)
- **zustand stores:** 2 (app state + UI overlays)
- **dangerouslySetInnerHTML:** 2 (QR + KaTeX—both safe)
- **localStorage keys:** 1 (`slaydx-ui`, UI prefs only)
- **Polling mechanism:** HTTP GET `/api/generations/{id}?since=liveSeq` every 1.2s (live) or 1–5s (backoff); 20 min timeout; 5 retry max on network error.
- **Polling start:** `ResultView` mount → `pollGeneration()` async → loop until status ≠ IN_PROGRESS/QUEUED
- **Heavy client data:** professions.json (570 KB, ResumeComposer only)

