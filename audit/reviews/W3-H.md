# W3-H review: frontend (C37, C38, C34 client, W2-E follow-ups)

Reviewer: independent, read-only. Branch `worktree-agent-ae00c90f0b695a998` (`f947a2a..38f2b16`, base `fa938a1`), reviewed against `audit/production-readiness` @ `ed0bb74`.

## Verdict: **CHANGES REQUESTED**

Two required changes, both on the Mini App path (FE-10). Everything else is sound and can merge as is once those two are done.

## Tests (run through the memory gate, one batch each)

- Fix worktree, `tsconfig.viewer.json`:
  - confirm-click, login-popup, session-resilience, topup-cta, purchase-poll, home-files, doc-edit-save: **46/46 pass**.
  - store-hydration, theme, slide-viewer-edit, work-composer, image-studio: **71/71 pass**.
- `--conditions=react-server`: api-client-idempotency plus api-client-poll, **28/28 pass**.
- Dry merge with the target (`git merge-tree` → commit-tree, then a temp worktree that has since been removed):
  - `tsc --noEmit` is clean.
  - The UI set plus game-player and store-hydration: **63/63 pass**.
  - idempotency, poll and auth with `hermetic-env`: **36/36 pass**.
- No test asserts DOM nodes with equal/deepEqual. The only deepEqual compares a parsed JSON body.

## Required changes

1. **Mini App login-CSRF, and the attacker's account sticks in the tab (FE-10, new path; same class as SECA-05, but stickier).**
   - **The attack.** `miniAppInitData()` accepts `#tgWebAppData=` from any URL. An attacker opens their own Mini App, copies the signed `initData`, and sends a victim `https://<site>/uz#tgWebAppData=…`. The payload is valid for 24 h, because `auth_date` is checked against 86 400 s. `refreshSession` then auto-logs the victim into the attacker's account (`!user && features.telegram`). The victim's resume data and payments land there.
   - **Why it is worse than SECA-05.** The value is cached in memory and in `sessionStorage`, and `LoginForm` auto-runs `miniAppLogin()` on mount. So after the victim clicks «Chiqish» and opens «Kirish», they are silently logged back into the attacker's account. That lasts until the tab closes or the 24 h run out. It also means a legitimate Mini App user can't stay logged out.
   - **The fix. Do all of the following:**
     - (a) Trust hash- or storage-derived `initData` only inside a real Telegram WebView. That means `window.TelegramWebviewProxy` (iOS/Android), `window.external?.notify` (Desktop), or `window.parent !== window`. The last one is enough for Web K/A because CSP `frame-ancestors` only allows telegram.org origins. A third-party link can't fake any of these.
     - (b) Clear the fragment after reading it: `history.replaceState(null, "", location.pathname + location.search)`. Today the signed payload stays in the URL bar and in history. The claim that the Next router drops it on the next navigation doesn't cover the first page, copy/share of the URL, or history.
     - (c) In `signOut`, and when `loginWithTelegram` fails with 401, clear `miniAppCache` and `sessionStorage["slaydx-tg-init"]`. Don't auto-login again in that tab after an explicit logout.
     - Add jsdom tests: no bridge means no POST, and after `signOut` the LoginForm mount sends no POST.

2. **Check that the server HMAC matches real Telegram `initData` before calling FE-10 closed.**
   - **The suspected bug.** `lib/server/auth.ts` `checkString()` drops both `hash` and `signature` for the Mini App path. As I understand Telegram's spec, the bot-token HMAC (`secret = HMAC_SHA256("WebAppData", token)`) covers every received field except `hash`. `signature` is dropped only for the Ed25519 third-party check. For example, aiogram's `check_webapp_signature` pops only `hash`. Since Bot API 8.0, clients send `signature`, so every real Mini App login would get a 401 («Telegram orqali kirib bo'lmadi»). If so, FE-10 is still dead in prod.
   - **Why the tests don't catch it.** `tests/auth.test.mts` signs with the same `checkString`, so it proves self-consistency, not compatibility.
   - **The fix.**
     - Capture one real `tgWebAppData` from a device with the dev bot and add it as a fixture test.
     - If it fails, keep `signature` in the Mini App data-check-string and exclude it only in `verifyLoginWidget`, where it never appears anyway.
   - This is a one-line server change in scope for C37/FE-10. My confidence in the spec reading is medium-high, so verify it with a real payload.

## Checked and OK

- **FE-07, confirm guard.**
  - `CONFIRM_MIN_MS = 600` plus `detail > 1` is a single rule, `confirmAccepted`, shared by `useConfirmClick` and `HomeFiles`.
  - Keyboard activation has `detail === 0`, so Enter works, and Enter pressed again after 600 ms confirms.
  - Key-repeat and fast Enter-Enter are ignored while the button stays armed. That is desirable: it prevents key-repeat accidents, and `aria-label` announces the armed state.
  - All callers pass `trigger` as `onClick`, so they get `detail`. The 600 ms waits added to the composer tests are fine.
- **UX-01, Telegram popup.**
  - `window.open("", "_blank")` runs synchronously inside the click.
  - `opener = null` is set before navigation, and the window is closed on ticket error.
  - If `null` comes back, you get the blocked banner and a primary «Telegram’da ochish» link.
  - `noreferrer` was lost, but the site's `Referrer-Policy: strict-origin-when-cross-origin` limits the leak to the origin. That is acceptable.
- **UX-02.** The same-device hint and the expiry text name the cross-device cause.
- **UX-03.**
  - The balance chip reads `useAppStore.user`, which is the existing `/api/auth/session` data.
  - **No new polling.** It refreshes only through the existing `refreshSession` calls: after a submit, after a delete, and on paid.
  - The top-up link appears for the 402 text or when the known price exceeds the balance.
  - The server 402 text («Balans yetarli emas…») is unchanged on the target, so the regex still matches.
- **UX-04 / FE-19, purchase polling.**
  - The interval grows from 3 s by ×1.5 up to a 20 s cap, within a ~120 s budget. That is about 10 requests per return.
  - It stops as soon as the order is paid or cancelled, and a cancelled order gets its own banner.
  - Transient errors are retried. After the budget runs out, the page shows a stalled banner with «Tekshirish», which starts an immediate re-poll. The poll is abortable.
- **FE-04, session resilience.**
  - Only a 401 from session, or 200 `user:null`, clears the user.
  - A transient error mid-session keeps the state as it is.
  - A transient error on first load shows the banner and retries with backoff from 2 s up to a 30 s cap. It uses a single timer (unref'd), and the manual button doesn't stack timers.
  - Any other 4xx means "logged out". Retrying never ends while the server is down, but at ≤1 request per 30 s per client (about 67 req/s at 2k clients) the load is bounded. See nit 2.
- **FE-09.** `CreateGrid` and `Sidebar` gate on `sessionChecked`.
- **UX-09 / FE-21, language switcher.**
  - `locale` is removed from the state, from `partialize`, from `migrateUiPrefs` and from `resetUiPrefs`. The `"lang"` overlay is gone.
  - A grep finds no remaining reader of `.locale`, `setLocale` or `UI_LOCALES`.
  - `<html lang="uz">` in `app/layout.tsx` is intact. `ServerUser.language` stays, as server data.
- **C34 client.** The contract matches the merged W3-A route:
  - The header is `Idempotency-Key`.
  - The key is a UUID v4, via `randomUUID` or a manual v4 fallback, and matches the server's `IDEMPOTENCY_KEY_RE`.
  - On 422 `idempotency_conflict`, or any other 4xx, the result is `rejected` and the key is dropped, so the next submit gets a new key.
  - Timeouts, network errors, 408 and 5xx are `unsure`, and an identical retry within 10 min reuses the key. A concurrent pending double-submit shares one key.
  - `deleteGeneration` resets the key.
  - **Deliberate deviation from the brief.** An identical body within 30 s after a *success* reuses the key. That covers the FE-06 re-click during navigation, but it means an intentional identical second document within 30 s gets back the first document, uncharged. It is harmless and documented, but the coordinator should accept it explicitly. The alternative is to keep submit disabled until navigation.
- **W2-E follow-ups.**
  - The store owns `generationsCursor`, which is reset on 401, sign-out and the logged-out refresh. The module global `firstPageCursor` is gone.
  - The search hint says «faqat yuklanganlar orasida».
  - `fileCategory` maps each type into exactly one filter: games by the `oyinlar` group, tests by `test`, slides by pptx, images by png, and docs for the rest.
  - `saveFailed` is cleared on save start, discard and restore, and set when the queue is left after a failure. It is threaded through Slide, Word and Resume viewers into «Qayta urinish · N».

## Nits (non-blocking)

1. Inside the Mini App, `refreshSession` sets `sessionChecked:true, loggedIn:false` before `miniAppLogin` resolves, so `/uz/create` briefly pops the login modal. Consider keeping `sessionChecked` false while the auto Mini App login is in flight.
2. Session retry: pause while `document.hidden`, and retry immediately on the `online` event. `waitTurn` already has this logic.
3. The idempotency reuse windows can replay a job that failed fast, so for up to 30 s the user is sent back to the failed document. This is rare. Consider clearing `lastSubmit` when a `pollGeneration` result is FAILED.
4. A rapid series of deliberate clicks keeps `detail > 1` climbing, so every one is ignored until the user pauses. A tiny visual cue on an ignored click would help.
5. Server (W4 candidate): 24 h `auth_date` freshness is generous for Mini App `initData`, which is fresh at launch by construction. About 1 h would shrink the replay/CSRF window.

## Merge compatibility

- `git merge-tree` against `audit/production-readiness` @ `ed0bb74` is **clean**. The two branches touch no common files. The target's only overlap in the area is `lib/tools.ts` (W3-J `priceFor`), which `lib/ui.ts` now imports read-only.
- On the dry-merged tree, `tsc` is clean and the targeted tests pass (numbers above).
- No semantic conflicts found:
  - W3-A's server key contract is matched.
  - W3-D's user-safe errors keep the 402 «Balans yetarli emas» text.
  - W3-G's `game-player` test passes after the merge.
- Merge order doesn't matter relative to the other W3 packages.

## Orchestrator verification (f8ba3db): **APPROVE**
R1 resolved by decision: client `#tgWebAppData` Mini App login reverted (no login-CSRF surface); only a one-time cleanup of the old `slaydx-tg-init` sessionStorage key remains (`lib/store.ts:289`). R2 moot (server path unused) — FE-10 DEFERRED until a real captured initData verifies the HMAC incl. `signature`. `tests/ui/session-resilience.test.mts` 6/6 via heavy2.sh. All other items were approved in the review above.
