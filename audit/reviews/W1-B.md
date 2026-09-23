# Review W1-B: C02 returnTo open redirect / `javascript:` DOM XSS

- Branch: `worktree-agent-a8d7ccc5b78c8a584` @ `73433e1`
- Reviewer: independent read-only review, 2026-09-23
- Scope: `lib/safe-return.ts`, `lib/ui.ts`, `components/overlays/LoginModal.tsx`, `components/home/HomeFiles.tsx`, `tests/safe-return.test.mts`, `tests/ui/login-returnto.test.mts`

## Verdict: **CHANGES REQUESTED**

The main P0 is closed. `javascript:`, `data:`, `https://evil`, `//evil`, `/\evil`, `%2F%2F` and leading or trailing whitespace are all rejected. Two independent layers (`useUi.open` and the pre-push check in `LoginModal`) run the same check. Both new tests pass through the gate (2/2 and 3/3), and the package globs `test` and `test:ui` pick them up.

One gap remains: the `/uz` prefix check runs on the **raw** string and not on the normalized path. Dot segments get past it.

## Probe results (ran `safeReturnTo` via tsx)

| Input | Result | Resolved pathname |
|---|---|---|
| `/uz/..//evil.com` | **ACCEPT** | `//evil.com` |
| `/uz/../..//evil.com` | **ACCEPT** | `//evil.com` |
| `/uz/%2e%2e//evil.com` | **ACCEPT** | `//evil.com` |
| `/uz/..//%2fevil.com` | **ACCEPT** | `//%2fevil.com` |
| `/uz/../api/auth/logout` | **ACCEPT** | `/api/auth/logout` (escapes the `/uz` scope) |
| `/uz%2F..%2F..//evil`, `/uz\t/x`, `/uz／evil`, `/uz∕evil`, `/uz/%`, `/uz/%E0%A4%A`, `/uzx`, `/Uz`, `/uz/%5c%5cevil.com` | null | – |
| `/uz#//evil`, `/uz/%09javascript:`, `/uz/%0a`, 100 KB path | ACCEPT | stays in `/uz` (harmless: percent-encoded path or fragment) |

Malformed `%` does not crash: `decodeURIComponent` is wrapped in try/catch.

What Next 15.5.23 does with an accepted `/uz/..//evil.com`: `dispatchNavigateAction` resolves it against `location.href`, so the origin stays the same and `isExternalURL` is false. After that the router works with `href = createHrefFromUrl(url) = pathname+search+hash = "//evil.com"`, which is protocol-relative:
- `HistoryUpdater` calls `history.pushState(…, "//evil.com")`, which throws a cross-origin `SecurityError`, so navigation breaks.
- `navigate-reducer.js:169` (`__next-page-redirect` meta refresh present) and `:271` (root-layout change) call `handleExternalUrl(state, mutable, href, …)`. The app router then calls `location.assign("//evil.com")`, which is a **real cross-origin open redirect**.

These branches are situational. In the common path the server's repeated-slash 308 plus `doMpaNavigation(res.url)` would keep it same-origin. Still, the validator's stated invariant ("faqat /uz ostidagi, protokol-nisbiy emas") is broken, and the fix is two lines.

## Required changes

1. **`lib/safe-return.ts:59-62`: validate the normalized path, not the raw prefix.** After the `URL` origin check, replace the raw `v.startsWith("/uz/")…` test with a check on `url.pathname`, and return the normalized form:
   ```ts
   // Nuqta segmentlari ("/uz/..//evil.com", "/uz/%2e%2e/…") URL tomonidan
   // normallashtiriladi — prefiksni XOM satrda emas, normallashgan yo'lda tekshiramiz.
   const p = url.pathname;
   if (!(p === "/uz" || p.startsWith("/uz/"))) return null;
   return p + url.search + url.hash;
   ```
   I checked this: it rejects `//evil.com`, `/api/x` and `/x` (from `%2E%2e`), and it accepts `/uz`, `/uz/files/1`, `/uz/purchase?order=abc`, `/uz/create#top` and `/uz?x=1` unchanged. Returning the normalized string (or returning `v` only when it passes) is fine either way. What matters is that the check runs on `url.pathname`.

2. **`tests/safe-return.test.mts:15-30`: add the bypass rows to `REJECT`.** They should fail on the current commit and pass after change 1:
   ```ts
   ["nuqta segmenti bilan //evil.com", "/uz/..//evil.com"],
   ["foizli nuqta segmenti bilan //evil.com", "/uz/%2e%2e//evil.com"],
   ["/uz doirasidan chiqish (..)", "/uz/../api/auth/logout"],
   ```
   If change 1 returns a normalized value, add one ACCEPT-side assertion too, e.g. `safeReturnTo("/uz/./files/1") === "/uz/files/1"`, and make sure the existing ACCEPT rows still compare equal. They do, because they are already normalized.

## Sink coverage (checked, no action needed)

- The only source of untrusted `returnTo` is `HomeFiles.tsx:35` (`params.get("returnTo")`). Nothing in the repo generates `?returnTo=` links. `useUi.open` is the single choke point, and `LoginModal` re-checks before `router.push`.
- Every other `open("login", {returnTo})` call site passes literals or constant templates, and all of them pass: `/uz/purchase` (PurchasePage ×2, PayDialog), `/uz/create` (HomeFiles, CreateGrid), `/uz/profile` (ProfilePage ×2), `/uz/${t.slug}` (Sidebar, SearchDialog, ToolWorkspace; slugs come from the static tool registry). No call site uses a query string or hash that could be rejected.
- The other `router.push` calls use `/uz/files/${id}` with server-issued ids, or constants.
- `PayDialog.tsx:63` `window.location.href = checkoutUrl` is **not an issue**. `app/api/payments/orders/route.ts:54-72` builds the URL server-side from the hard-coded origins `https://my.click.uz/services/pay` and `https://checkout.paycom.uz/`. `orderId` is server-generated and `env.appUrl` comes from config. No request field reaches the origin.
- `LoginModal.tsx:105` `window.open(t.url, …)` uses the server-issued Telegram ticket URL. This is out of scope for C02.

## Tests

- `tests/safe-return.test.mts`: 2/2 pass. It would fail on the old code (the module did not exist). The table is a good mutation target.
- `tests/ui/login-returnto.test.mts`: 3/3 pass. Test 1 sets state directly and bypasses `open()`, so it isolates the `LoginModal` layer. Test 3 isolates the `useUi.open` layer. Removing either layer turns a test red, so both layers are genuinely covered.

## Optional nits

1. `lib/safe-return.ts:37-38`: `v.startsWith("/\\")` is subsumed by `v.includes("\\")` on the next line. Likewise, `decoded.startsWith("/\\")` is subsumed by `decoded.includes("\\")` at `:48`. Drop the redundant checks, or keep one line with a comment.
2. `lib/safe-return.ts:2`: "saf(safe) qiladi" reads oddly. Suggest "xavfsiz manzilga cheklaydi".
3. `tests/safe-return.test.mts:17`: the label has a stray quote, `"/' bilan"`. It should be `"/" bilan`.
4. `tests/ui/login-returnto.test.mts`: `stubAuthApi` overwrites `globalThis.fetch` and never restores it in `afterEach`. This is harmless per file-process, but restoring it is cleaner.
5. Once change 1 lands, the module doc comment (`:12-14`) could mention "nuqta segmentlari (`..`)" among the rejected forms.

---

## Re-review (commit `62b086f`): **APPROVE**

**Required change 1 is done.** `safeReturnTo` now checks the RESOLVED `url.pathname`:
- It rejects a pathname that starts with `//`.
- It requires `p === "/uz" || p.startsWith("/uz/")`.
- It returns `p + url.search + url.hash`, the normalized form.

The fixer also removed the raw backslash and `decodeURIComponent` checks. This is sound: the WHATWG `URL` parser turns `\` into `/` for `https:`, and a leftover backslash either changes the origin or produces `//`. Both of those are rejected.

**Required change 2 is done.** Three bypass rows were added to REJECT, plus a normalization test (`/uz/./files/1` → `/uz/files/1`). The earlier probe showed all three were ACCEPTED on `73433e1`, so these tests fail on the old code and pass on the new one.

**Bypass battery re-run (48 inputs):**
- **Rejected:**
  - Dot-segment escapes: `/uz/..//evil.com`, `/uz/../..//evil.com`, `/uz/%2e%2e//evil.com`, `/uz/..//%2fevil.com`, `/uz/../api/auth/logout`, `/uz/..`
  - Backslash forms: `/\evil.com`, `/\/evil.com`, `/uz/..\..\/evil.com`, `/uz\..\..\\evil.com`
  - Encoded or scheme forms: `/%2F%2Fevil.com`, `/javascript:…`, `javascript:…`
  - Unicode slashes: `／`, `∕`
  - Tab/control characters, `/uzx`, `/Uz`, `/UZ/x`
- **Accepted:** every accepted value resolves same-origin, never gives a protocol-relative pathname, stays under `/uz`, and is idempotent (`safeReturnTo(r) === r`). This includes `/uz/%2F%2Fevil.com`, `/uz/%5c%5cevil.com`, `/uz#//evil`, `/uz/x?next=//evil.com`, `/uz/..;/evil`, and a 100 KB path.
- **Tests (heavy2 gate):** `tests/safe-return.test.mts` 3/3 pass; `tests/ui/login-returnto.test.mts` 3/3 pass. The fetch stub is now restored in `afterEach` (nit 4 fixed). Nits 1–3 and 5 are also fixed.

**Remaining nit (optional):** malformed percent escapes (`/uz/%`, `/uz/%E0%A4%A`) are now accepted, because the `decodeURIComponent` check was removed. They stay same-origin under `/uz`, so there is no security impact. At worst they lead to a 400 or 404 page after login. If you want to tidy this, you could add back `try { decodeURIComponent(p) } catch { return null }`.
