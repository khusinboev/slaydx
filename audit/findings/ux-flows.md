# UX flows — findings
Scope actually covered: `components/overlays/**`, `components/shell/**`, `components/forms/**` (flow-level, not field-level layout), `components/files/**`, `components/viewers/**` (flow-level), `components/game/**`, `components/admin/**`, `components/purchase/**`, `components/profile/**`, `app/uz/**/page.tsx`, `app/o/[token]/**`, `lib/api-client.ts`, `lib/store.ts`, `lib/ui.ts`, `lib/tools.ts` (pricing/copy only), `lib/game/public.ts`. Read-only static review, no dev server/build/tests run.
Not covered: server route handler internals beyond what's needed to confirm client-visible behavior (SEC/DATA/PAY auditors own those); form field layout/design choices (AUDIT-12/24 already covered, out of scope per brief); generation engine internals (prompt/layout quality — out of scope).
Summary: P0 0 · P1 1 · P2 7 · P3 2

### UX-01 — Telegram login popup can be silently blocked, leaving the user on a spinner with no explanation
- **Severity:** P2
- **Location:** `components/overlays/LoginModal.tsx:90-107` (`startTelegram`)
- **Evidence:** 
  ```js
  async function startTelegram() {
    ...
    const t = await api.createLoginTicket();   // await BEFORE window.open
    setTicket(t);
    setStage("waiting");
    window.open(t.url, "_blank", "noopener,noreferrer");   // return value ignored
  ```
  `window.open()` is called only after an `await` on a network request, not synchronously inside the click handler. Several mobile/desktop browsers (notably Safari/iOS, and Chrome under some heuristics) drop the "user activation" flag across an awaited microtask/macrotask boundary and silently block the popup — `window.open` then returns `null`, which the code never checks. The UI immediately moves to `stage="waiting"` regardless, showing a spinner "Telegram'da tasdiqlanishi kutilmoqda..." with no indication that nothing actually opened.
- **Reproduction:** On iOS Safari (or any browser that revokes user-activation after an `await`), tap "Telegram orqali kirish". No new tab/app opens. The screen still switches to the waiting state with the spinner. The only recovery is noticing the small secondary link "Telegram'ni qayta ochish" (only shown once `ticket` is set, i.e. already in the waiting view) and tapping it manually — nothing tells the user the first attempt silently failed. If they don't notice/tap it, they wait the full 5 minutes for "Havola muddati tugadi."
- **Proposed fix:** Open a blank window synchronously at the top of the click handler (`const w = window.open("", "_blank")`) before the `await`, then set `w.location = t.url` once the ticket resolves; if `w` is `null`/`w.closed`, show an inline message ("Yangi oyna ochilmadi — brauzeringiz popup'larni bloklagan, quyidagi havolani bosing") and surface the `ticket.url` link immediately instead of only after entering the waiting stage.
- **Effort:** S
- **Confidence:** medium — the popup-blocked-after-await behavior is well-documented Safari/Chrome behavior but depends on browser/version; would be confirmed by testing `startTelegram()` in iOS Safari with devtools open.

### UX-02 — Telegram login link opened on a different device/browser never completes; no explanation why the waiting screen times out
- **Severity:** P2
- **Location:** `components/overlays/LoginModal.tsx:118-139` (waiting-stage polling), `app/api/auth/telegram/enter/route.ts:11-25` (comment confirms design), `lib/api-client.ts:129-131` (`fetchSession`)
- **Evidence:** The route comment states explicitly: *"Sessiya SHU so'rovni yuborgan brauzerda ochiladi"* (the session is created in whichever browser/device sends the `GET /api/auth/telegram/enter?t=` request). The waiting-stage polling in `LoginForm` only calls `api.fetchSession()` — which reads the *polling browser's own* cookie — every 2s until the ticket's 5-minute deadline. There is no ticket-ID-based cross-device session handoff (unlike e.g. WhatsApp Web/Discord QR-login, which associate the confirmation with the ticket server-side so any device polling that ticket ID picks it up). If a user starts the flow on a desktop/laptop browser (no Telegram installed there) but has Telegram only on their phone — a very common combination for students at school/library computers — tapping "Saytga kirish" inside Telegram on the phone logs them in **on the phone's browser**, while the original desktop tab keeps polling its own cookie and never sees a session. The desktop tab silently sits on "Telegram'da tasdiqlanishi kutilmoqda..." for the full 5 minutes, then shows only "Havola muddati tugadi. Qaytadan urinib ko'ring." — never explaining that the login actually succeeded, just on the wrong device.
- **Reproduction:** Start "Telegram orqali kirish" on a desktop browser with no Telegram Desktop session; open the resulting `t.me` link on a phone's Telegram app instead and tap "Saytga kirish" there. Phone browser redirects to `/uz` logged in; desktop tab still shows the waiting spinner and, after 5 minutes, "Havola muddati tugadi."
- **Proposed fix:** Either (a) associate the login ticket's redemption with the ticket `nonce` server-side and let `fetchSession`/a dedicated poll endpoint accept the nonce to pick up the session cross-device (requires issuing a short-lived cross-device token, more work), or (b) at minimum add copy in the waiting state clarifying "Havolani ushbu qurilmada oching — boshqa telefon/brauzerda ochsangiz, kirish faqat o'sha yerda amalga oshadi" so users understand why the desktop tab never updates.
- **Effort:** M (proper cross-device handoff) / S (clarifying copy only)
- **Confidence:** high on the mechanism (confirmed by reading both the route comment and the polling code); medium on real-world frequency.

### UX-03 — "Balans yetarli emas" error has no top-up link; balance is invisible anywhere in the app shell
- **Severity:** P2
- **Location:** `components/forms/ToolChrome.tsx:18,60-62` (`error?: string`, rendered as plain `<p>`), `components/forms/SlideComposer.tsx:181-182` (`setError(e instanceof Error ? e.message : "Xatolik")`), `app/api/generations/route.ts:121-122` (server message "Balans yetarli emas. Kerak: X tanga, mavjud: Y."), `components/shell/TopBar.tsx` (no balance shown anywhere), `components/shell/Sidebar.tsx` (no balance shown)
- **Evidence:** Every composer catches the `createGeneration` failure and does `setError(e instanceof Error ? e.message : "Xatolik")`, then `ToolChrome` renders it as inert text: `{error ? <p className="text-destructive mb-4 text-sm">{error}</p> : null}`. The `error` prop is typed `string | null` — there is no room for a CTA even if one were added ad hoc. When the 402 "Balans yetarli emas. Kerak: 4 000 tanga, mavjud: 1 200." message appears, the user's only path to fix it is: notice the message → know that a top-up exists → find the avatar in `TopBar` (balance is not displayed in `TopBar` or `Sidebar` at all — confirmed by grep, contrary to the scout note; balance is only shown on `/uz/profile` via `Stat label="Balans"` and inside the submit button as the price badge) → open `/uz/profile` → click "Tariflar" → land on `/uz/purchase` → pick top-up → pay → manually navigate back to `/uz/create` and re-pick the same tool (form draft does restore there via `useFormDraft`, so no data is lost — but nothing tells the user this is safe). This is several undiscoverable manual hops from a plain-text error with zero guidance, for what is explicitly called out as a "money-related confusion" risk area.
- **Reproduction:** Log in with a low-balance test account, open any paid tool (e.g. `/uz/create` → slide), fill the form, submit with insufficient balance. Read the resulting error text and confirm there is no link/button anywhere near it, and that no balance number is visible in the header while on the form page.
- **Proposed fix:** When `ApiError.status === 402`, render a small inline action next to the message (e.g. "Balansni to'ldirish →" linking to `/uz/purchase`, or directly `openUi("pay", {...})`) instead of a bare string; widen `ToolChrome`'s `error` prop to accept `ReactNode` or add a dedicated `onInsufficientBalance` callback.
- **Effort:** S
- **Confidence:** high (confirmed by reading `ToolChrome.tsx`, `TopBar.tsx`, `Sidebar.tsx`, `ProfilePage.tsx`, and the server error string).

### UX-04 — Payment "confirming" banner freezes forever if the webhook takes longer than 15s (or never arrives)
- **Severity:** P2
- **Location:** `components/purchase/PurchasePage.tsx:42-73`
- **Evidence:** 
  ```js
  const t = setInterval(() => {
    tries++;
    void refreshSession();
    void api.listOrders().then((r) => setOrders(r.orders)).catch(() => {});
    if (tries >= 5) clearInterval(t);
  }, 3000);
  ```
  After returning from Click/Payme to `/uz/purchase?order=...`, the page polls order state at most 5 times over 15 seconds, then stops silently. If the order is still `state !== "paid"` at that point (webhook delayed under load, provider round-trip slow, or the payment genuinely failed/was cancelled), the amber banner "To'lov tasdiqlanmoqda... Bu bir necha soniya olishi mumkin." stays on screen **indefinitely** with no further polling, no manual "Qayta tekshirish" button, and no guidance for a real failure (e.g. "agar 10 daqiqadan keyin ham yangilanmasa, admin bilan bog'laning"). The only recovery is the user knowing to manually reload the browser (which re-triggers the effect since `order` stays in the URL) — nothing on the page suggests this.
- **Reproduction:** Simulate a delayed webhook (or read the code path): return to `/uz/purchase?order=<pending-id>` where the order is still `pending` after 15s of polling; observe the banner text never changes and no new request fires after the 5th `tries`.
- **Proposed fix:** After the 5 polling attempts, switch the banner to a message with a manual "Qayta tekshirish" button (re-invokes the same fetch), and/or fall back to slower polling (e.g. every 15–30s) instead of stopping outright; if the order is `cancelled`/`failed` server-side, surface that distinctly from "still confirming".
- **Effort:** S
- **Confidence:** high

### UX-05 — Client polling timeout (20 min) is silently swallowed while a job is still QUEUED/IN_PROGRESS — progress bar freezes forever with no message
- **Severity:** P1
- **Location:** `lib/api-client.ts:367-408` (`pollGeneration`, deadline throw at 402-404), `components/files/ResultView.tsx:80-84` (catch sets `error` but not `completed`), `components/files/ResultView.tsx:412` (`{running ? <RunningPanel .../> : null}`) and `:428-432` (`{error && completed ? ... : null}`)
- **Evidence:** `pollGeneration` polls for at most 20 minutes, then throws `ApiError("Ish juda uzoq davom etmoqda. Keyinroq «Mening fayllarim» dan tekshiring.", 504)`. `ResultView`'s effect catches it and does `setError(e.message); setLoading(false);` — but never touches `gen`, whose last-known `status` is still `"QUEUED"`/`"IN_PROGRESS"` (the job genuinely hasn't finished, that's *why* the client gave up). Rendering is:
  ```jsx
  {running ? <RunningPanel gen={gen} /> : null}     // running = gen.status is QUEUED/IN_PROGRESS → still true
  ...
  {error && completed ? (<p role="alert">{error}</p>) : null}   // completed is false → error is NEVER shown
  ```
  `running` stays `true` (computed from the frozen `gen.status`), so `RunningPanel`'s progress bar keeps rendering at its last value. The `error` banner is gated on `completed`, which is `false` for a still-queued job, so the timeout message that explains what happened is computed but never rendered. Net effect: after 20 minutes the client has silently stopped polling — the page just sits there looking like it's still working, with a static progress bar and no error, no retry button, and no indication that anything stopped.
- **Reproduction:** With `WORKER_CONCURRENCY=2` (default in the docker-compose deployment) and a burst of concurrent generation requests (plausible at "peak bursts 10× normal traffic" per the audit's target-load assumption, e.g. exam season), any job that sits in the queue/running state for >20 minutes hits this path for every open viewer tab. Minimal repro without load: open `/uz/files/{id}` for a job, then in devtools set the system clock forward (or edit `pollGeneration`'s deadline check) to force the 504 after one tick; observe `RunningPanel` keeps rendering with the last progress value and no error text appears anywhere on the page.
- **Proposed fix:** Render the timeout error regardless of `completed` (e.g. `{error ? <p role="alert" className="...">{error}</p> : null}`, or a dedicated banner shown when `running && error`), and offer a "Qayta tekshirish" button that restarts `pollGeneration` instead of requiring a full page reload to recover.
- **Effort:** S
- **Confidence:** high — confirmed by reading the exact render conditions; the `completed` gate on the error paragraph is unambiguous in the source.

### UX-06 — Public game "Qayta yuborish" after a failed submit can create a duplicate result row (no idempotency)
- **Severity:** P2
- **Location:** `components/game/Player.tsx:83-106` (`submit`), `app/api/o/[token]/submit/route.ts:26-64` (`POST`, calls `addResult` at line 48 unconditionally on every call)
- **Evidence:** Client-side, a failed submit keeps the finished game state around and offers a "Qayta yuborish" (resend) button that calls the exact same `submit()` again:
  ```js
  } catch (e) {
    setSendError(e instanceof Error ? e.message : SUBMIT_FAILED);
    setState((s) => (s ? { ...s, finishedAt: null } : s));   // state kept, not cleared — good for retry
  }
  ```
  Server-side, `POST /api/o/[token]/submit` has no idempotency key and no unique constraint check before writing: every call runs `await addResult({ sessionId, playerName, score, ... })`, inserting a brand-new row. If the *first* request actually reached the server and was scored (row inserted) but the response never made it back to the phone (classic "network loss mid-game" — a dropped mobile connection, or the phone locking during the fetch), the client only knows the promise rejected/timed out, shows `sendError`, and the student naturally taps "Qayta yuborish" — which inserts a **second** identical-looking row for the same student. There is nothing (unique constraint on `(session_id, player_name)`, a client-generated request id, an `ON CONFLICT DO NOTHING`) preventing this.
- **Reproduction:** Start a game at `/o/[token]`, answer, tap "Yakunlash"; in devtools throttle/kill the network right after the request is sent (before the response arrives) so the `fetch` in `submit()` rejects while the server-side `addResult` still completes. Restore network, tap "Qayta yuborish". Check `GameSharePanel`'s results table (`GET /api/generations/{id}/results`) — the same player name now appears twice with the same score.
- **Proposed fix:** Add a client-generated `submissionId` (e.g. `crypto.randomUUID()` created once per `finish()`) sent in the submit body, and a unique index on `(session_id, submission_id)` server-side with `ON CONFLICT DO NOTHING RETURNING …` (falling back to re-reading the existing row's score if the insert was a no-op) — or simpler, a unique constraint on `(session_id, player_name, answers_json)` scoped to a short time window.
- **Effort:** S–M
- **Confidence:** high on the mechanism (confirmed no dedup exists in `addResult`/route); medium on real-world frequency (requires a request to land but its response to be lost, which is a normal mobile-network failure mode, not a rare one).

### UX-07 — No queue depth/ETA shown while QUEUED; a long backlog looks identical to a job that just started
- **Severity:** P3
- **Location:** `lib/server/jobs.ts:179` (`step` default `'Navbatga qo''yildi'` at insert, no position/ETA), `components/files/ResultView.tsx:557-590` (`RunningPanel`, shows only `gen.step` + `gen.progress`, which stays "Navbatga qo'yildi" / 0% for the entire queued wait)
- **Evidence:** A newly created job and a job that has been sitting in the queue for 15 minutes during a burst (only `WORKER_CONCURRENCY=2` on the single VPS) render identically: `RunningPanel` shows the static text "Navbatga qo'yildi" and a 0%-width progress bar. There is no queue position, no estimated wait, nothing to distinguish "about to start" from "many jobs ahead of you." Combined with UX-05 (20-minute client polling cap swallowed silently), a user stuck deep in a peak-time queue gets zero forward signal the whole time.
- **Reproduction:** Read `lib/server/jobs.ts` insert (`enqueueJob`, line ~179) — `step` is hardcoded to `'Navbatga qo''yildi'` and only changes once a worker actually claims the row (`step = 'Boshlandi'`, jobs.ts:358). No code path computes or returns queue depth.
- **Proposed fix:** Compute an approximate queue position server-side (`SELECT count(*) FROM generations WHERE status='QUEUED' AND created_at < $1`) and surface it in `step`/a dedicated field, e.g. "Navbatda: sizdan oldin 12 ta ish" — even a rough number reduces perceived-wait anxiety during peak load.
- **Effort:** S
- **Confidence:** high

### UX-08 — PDF download button shows no progress feedback while converting (up to 60s of a silently disabled button)
- **Severity:** P2
- **Location:** `components/files/ResultView.tsx:381-392` (PDF button), contrast with `:353-369` (main download button, which does show a state label)
- **Evidence:** The primary DOCX/PPTX download button changes its label while busy: `{fileStale || busy ? "Fayl yangilanmoqda…" : "Yuklab olish"}`. The PDF button right next to it does not:
  ```jsx
  <button
    type="button"
    className="bg-card inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-sm disabled:opacity-60"
    disabled={busy || !gen.hasFile}
    onClick={() => void onDownload("pdf")}
    title="PDF ga o‘girib yuklab olish"
  >
    <Download className="size-4" />
    PDF
  </button>
  ```
  Clicking it calls `onDownload("pdf")`, which on the server converts via LibreOffice (`maxDuration: 60` per the route config) — a real document can take many seconds, more under concurrent load on the shared VPS. During that whole window the button just goes to `opacity-60` with the same static "PDF" label — no spinner, no "PDF'ga o'girilmoqda…" text, nothing distinguishing "working" from "stuck." On a phone, tens of seconds of a grayed-out button with zero feedback reads as broken, not busy.
- **Reproduction:** Read the JSX directly — no conditional text/spinner tied to `busy` exists on the PDF button, only `disabled`/opacity. Compare to the main download button two elements above it, which does have busy-state text.
- **Proposed fix:** Reuse the same pattern as the main download button — swap the "PDF" label for e.g. "O‘girilmoqda…" (with a small spinner) while `busy` is true and this was the button that triggered it (track which format is in flight, e.g. `busy: "docx" | "pdf" | null` instead of a boolean).
- **Effort:** S
- **Confidence:** high

### UX-09 — TopBar language switcher (6 languages) has no effect on anything — fully decorative
- **Severity:** P2
- **Location:** `components/shell/TopBar.tsx:58-89` (language menu UI), `lib/ui.ts:35-42` (`UI_LOCALES`), `lib/store.ts:167-170` (`setLocale`), `app/layout.tsx:76` (`<html lang="uz">`, never updated), `components/forms/SlideComposer.tsx:107` (form default `language: "uz"` hardcoded, not derived from store)
- **Evidence:** The globe/flag button in `TopBar` opens a menu listing 6 real languages with native labels and flags: `{ value: "uz", label: "O'zbekcha" }`, `en`/"English", `ru`/"Русский", `kaa`/"Qaraqalpaqsha", `kk`/"Қазақша", `ky`/"Кыргызча". Selecting one calls `setLocale(l.value)`, which does `set({ locale }); ... void api.updateProfile({ language: locale })` — it updates the zustand store and persists to the server profile. But a repo-wide search shows `useAppStore((s) => s.locale)` (or any equivalent read of that store field) is consumed **only inside `TopBar.tsx` itself** (to render which flag is currently selected) — no component, page, or form anywhere in `components/`, `lib/`, or `app/` branches on it. Confirmed further: there is no i18n library in the project (`grep` for `next-intl`/`react-i18next`/`i18next`/`useTranslation` returns nothing), every UI string in every component read during this audit is hardcoded Uzbek text, the root `<html lang="uz">` is never updated client-side, and form composers hardcode `language: "uz"` as their default rather than reading the user's chosen locale. Selecting "Русский" or "Кыргызча" changes only the flag glyph shown on the button itself — the rest of the app stays in Uzbek, and the document-language field a new form starts with is not pre-set to match either.
- **Reproduction:** Log in, open the language menu in the header (globe icon next to the theme toggle), pick "Русский". Observe: no visible text anywhere changes; open any tool form and confirm the language field still defaults to "O'zbekcha"; inspect `<html>`'s `lang` attribute in devtools and confirm it stays `"uz"`.
- **Proposed fix:** Either implement real localization for at least the app-shell chrome (or, more realistically given "no dictionary" is a large lift, remove the language picker until it's backed by something) — at minimum, wire `setLocale` to also prefill new forms' `language` field and update `document.documentElement.lang`, so the control does *something* visible instead of nothing.
- **Effort:** L (real i18n) / S (remove the dead control, or wire it to at least drive the document-language default)
- **Confidence:** high — verified by exhaustive grep for all consumers of `locale` plus absence of any i18n framework in `package.json`/codebase.

### UX-10 — Two icon-only header buttons have English aria-labels in an otherwise fully Uzbek app
- **Severity:** P3
- **Location:** `components/shell/TopBar.tsx:41` (`aria-label="Toggle Sidebar"`), `components/shell/TopBar.tsx:105` (`aria-label="Notifications alt+T"`)
- **Evidence:** Every other interactive control read during this audit uses Uzbek `aria-label`s (`"Yopish"`, `"Qidirish..."`, `"Tilni o'zgartirish"`, `"Profil"`, `"Kirish"`, `"Mavzu: Kun. Almashtirish: Tun"`, etc.), but the sidebar-toggle and notifications-bell buttons in `TopBar` are labeled in English. A screen-reader user on an Uzbek-locale device/reader would hear these two controls announced in English while everything else is Uzbek.
- **Reproduction:** Read `components/shell/TopBar.tsx:37-44` and `:101-108` directly; compare against any other `aria-label` in the same file or sibling components.
- **Proposed fix:** `aria-label="Yon panelni ko'rsatish/yashirish"` and `aria-label="Bildirishnomalar"` (drop the "alt+T" hint from the accessible name — if a shortcut hint is wanted, put it in `title` instead, which is already the pattern used for the theme button).
- **Effort:** S
- **Confidence:** high

<!-- findings appended below -->

## Checked and OK

- **Modal focus/keyboard behavior** — `components/overlays/useDialog.ts` gives every overlay (login, pay, search, notifications) Escape-to-close, a real Tab focus trap, background-scroll lock, initial autofocus, and focus restore to the opener on close. Shared by all dialogs via one hook, not reimplemented per-modal.
- **Ticket-expiry messaging (login)** — `LoginModal.tsx:118-139` correctly detects the 5-minute Telegram ticket deadline client-side and shows "Havola muddati tugadi. Qaytadan urinib ko'ring." rather than polling forever (independent of UX-01/UX-02's popup/cross-device gaps).
- **Form drafts survive navigation away to pay** — `components/forms/useFormDraft.ts` debounce-saves (1.2s) to the server per tool and, critically, flushes the pending write on `pagehide`, `visibilitychange`, *and* component unmount (covers both a full navigation to Click/Payme and an in-app `<Link>` route change). Confirmed a user who leaves mid-form to top up balance does not lose typed input.
- **FAILED/REVOKED generation state** — `components/files/ResultView.tsx:414-425` clearly labels the failure, shows the server error/step text, and explicitly states "Yechilgan tanga hisobingizga qaytarildi" (credits were refunded) rather than leaving the user wondering.
- **Partial delivery (`delivered`)** — `ResultView.tsx:451-476` shows an explicit "X dan Y ta yaratildi" banner with a careful `refundShare` check so it never claims a refund happened when the pricing tier didn't actually charge extra for that unit.
- **File TTL/expiry — brief's assumption is stale, and the code correctly reflects the new design.** `lib/server/migrations/011_no_expiry.sql` removed the 72h TTL; `expires_at` is now always `NULL` for new generations, and `ResultView.tsx:225-235`'s own comment confirms files are meant to be kept indefinitely. Grepped for leftover "72 soat"/TTL copy in `components/files/`, `components/viewers/` — none found. The only remaining "expiry" concept in the UI is the *public game share token's* own TTL, which is handled well (see next item).
- **Game share panel (`components/files/GameSharePanel.tsx`)** — thorough: empty state explains what a share link does before the irreversible "loginsiz ochiq havola" step is taken, QR generation failure degrades gracefully (link still works), clipboard-copy failure has a fallback message, expiry is shown per-session (`"Amal muddati: …"` / `"Muddati cheklanmagan"`), multiple simultaneous links are supported and labeled, results table has a manual refresh + CSV export, and an explicit empty-results message.
- **Public game player error/retry handling (`components/game/Player.tsx`)** — load failures (404/429/other) get distinct, actionable Uzbek messages; 404 deliberately doesn't distinguish "invalid" from "expired" token (documented anti-enumeration reasoning); a failed submit preserves in-progress game state and answers so "Qayta yuborish" resends the same result instead of forcing a replay (the one gap here is server-side dedup — see UX-06); the finish button is `disabled` while `sending` (double-submit guarded client-side).
- **Upload error messaging (logo/source/template/photo)** — `lib/api-client.ts:461-598` consistently normalizes 413/415/429 into specific Uzbek messages *independent of the server's exact wording* (explicitly documented as a deliberate choice), and `components/forms/shared/index.tsx SourceFileRow` pre-checks size client-side and gives a helpful fallback ("Fayldan matn olinmadi. Mavzu rejimidan foydalaning.") for corrupt/unparseable files instead of failing silently.
- **Custom-template upload wait state** — `components/forms/CustomTemplateCard.tsx:133-137` is the pattern UX-08 should have followed: an explicit "Tahlil qilinmoqda… Maketlar o'qilib, fonlar chizilmoqda (20–40 s)" message covers the one genuinely slow (20-40s) upload path in the app.
- **Double-submit protection on the paid "create" action** — every one of the 11 tool composers (`ArticleComposer`, `EssayComposer`, `GameComposer`, `InfographicComposer`, `MediaComposer`, `ResumeComposer`, `SlideComposer`, `teacher/TeacherComposer`, `WorkComposer`, `TranslationForm`, `ImageStudio`) wires its own `loading` state into the shared `ToolChrome` submit button's `disabled` prop, set synchronously before the async `runGeneration` call. `PayDialog.tsx`'s provider buttons are likewise `disabled` while `busy !== null`. Consistent, not ad hoc per tool.
- **Generic API error fallback is Uzbek, not raw/technical** — `lib/api-client.ts:42-85`'s `request()` turns network failures, empty error bodies, 401s and 5xxs into fixed Uzbek copy; unhandled 4xx codes fall back to `Xatolik (${status})` (terse but not English/raw), and this was sampled, not exhaustively checked against every route.
- **Admin panel basics** — `/uz/admin` is gated server-side via `notFound()` (404, not 403, so the panel's existence isn't disclosed) in `app/uz/admin/page.tsx`, re-checked client-side against `user.isAdmin` in `AdminPage.tsx:219-223` (so a session swap without reload doesn't leave a stale privileged render); search is debounced correctly (page reset bundled with the debounced query to avoid a stale-query extra request); loading/empty/error states all present; no dead ends found that would block the owner.
- **Images have appropriate `alt`** — sampled `<img>` usages across `FilePreview`, `ImageViewer`, `SlideCanvas`, `PhotoField`, `LogoField`, `WordViewer`, `ResumePage`: decorative/content-described-elsewhere images use `alt=""`, meaningful ones (logo, resume photo, article figures) have real text.
- **`lang="uz"` on `<html>`** (`app/layout.tsx:76`) is consistent with reality: since no UI string in the app is ever translated (see UX-09), a static `lang="uz"` is actually correct for the content that's really shown, not a bug on its own.
