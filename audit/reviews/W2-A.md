# Review W2-A — C07 LibreOffice in the web container

Branch `worktree-agent-a4debc89872f30a0a` (`2245655`, `f61621a`) vs `audit/production-readiness`.
Reviewer: independent, read-only. Date: 2026-09-23.

## Verdict: **CHANGES REQUESTED** (2 small required changes; the core design is sound)

Tests run from the worktree through the memory gate with the throwaway DB:
`pdf-concurrency, pdf-cache, fresh-file, pdf-limits-db, pdf, thumb, template-upload, csp-headers` → **42 pass, 0 fail, 0 skip** (the DB test ran; the local LibreOffice tests ran too).

## What checks out

- **Gate (`lib/server/soffice-gate.ts:55-104`)**: `run()` releases in `finally` on success, throw and timeout. Permits are handed straight to the next waiter (`release` shifts, clears the timer and resolves without decrementing), so a new arrival cannot jump the queue (the fast path also requires `waiters.length === 0`). A waiter that times out splices itself out before it rejects, and `release` can then no longer reach it, so there is no leak and no late acquire. Because JS runs one callback at a time, the timer and `release` cannot both run for the same waiter. A rejection when the queue is full takes no permit. Cache hits and single-flight joiners never touch the gate.
- **No deadlock**: the lock order is always thumb gate → soffice gate, and nothing takes the soffice gate first and the thumb gate second. `getOrConvertPdf` holds no permit when it calls `toPdf`, and the gate is taken exactly once per conversion.
- **Worker**: `lib/generation/index.ts:752` already has `toPdf(...).catch(() => null)`, so a busy gate only skips the page check and never fails a paid job. The worker process has its own gate instance, and in prod it has no `soffice` at all.
- **Process group (`runGroup`)**: `detached: true` → `setsid`, so pgid = child pid. `kill(-pid)` goes out only while the leader is unreaped (the timer is cleared on `exit`) or while group members still exist, and Linux never reuses a pid that is still used as a pgid. So there is no realistic path to killing an unrelated group. stdout goes to `ignore`. stderr is always drained and capped at 2 KB. The code listens for `exit` rather than `close`, so a grandchild that holds the pipe cannot block it. The promise settles only after `reapGroup`, so the `rm` of the profile dir in `pdf.ts` `finally` runs after the whole group is gone (FILE-06). With no binary, `toPdf` returns `null` before the gate, the same as before, and a spawn `ENOENT` goes through the `error` path.
- **Cache**: the key is `sanitized genId + sha256(bytes)`, so an edit or rebuild gives a new key and a stale PDF can never be served. The id is filtered to `[0-9a-f-]`, so there is no path traversal. Ownership is checked before any lookup: the route does `requireUser` → `ensureFreshFileShared` (versions SQL scoped by `user_id`) → `getGenerationFile(id, user.id)` → `pdfResponse`. User B would need A's generation id and A's file bytes. Writes go to `.tmp` and are then renamed; concurrent writers use unique tmp names; ENOSPC is caught (the tmp file is removed and the converted PDF is still served). The size cap is enforced after each put, and an init failure degrades to no cache.
- **Limits**: the per-user PDF limit runs inside `beforeConvert`, so it is not charged on a cache hit, for a non-convertible type (400) or for a single-flight joiner. The 429 goes through `handler` with a `Retry-After` header and `{ error, retryAfter }`. The 503 from `busyResponse` has `Retry-After` and `{ error (Uzbek), code: "pdf_busy", retryAfterSec }`. Both match `w2-contracts.md`.
- **fresh-file**: single-flight per `user:id`. The second pass re-checks versions after the wait, and only a real render charges `filerender:` 30/h. When the loop ends after waiting twice, the second render began after the first one finished and re-read the versions, so a stale file is not served.
- **Regressions**: the DOCX/PPTX download path is unchanged. `contentDisposition` is re-exported from the route, and `csp-headers.test` is green. Thumbs still work, now `COMPLETED` only, with a thumb sub-limit of `N−1` and bounded waiters (SCALE-07).

## Required changes

### R1. Custom-template upload now returns 500 when the gate is busy (regression)
`lib/server/template-upload.ts:87` calls `toPdf` outside `rasterizeTemplate`'s `try`, and `toPdf` now throws `SofficeBusyError`. `uploadTemplate` → `app/api/uploads/template/route.ts:18-21` → `handler` does not treat this as an `ApiError`, so it becomes a **generic 500 + serverError log**. Before this change, a failed conversion only produced `{}` previews (the doc comment at `:76-77` says "yuklash yiqilmaydi"). The `template:` quota (5/10 min) has already been spent by then. The verdict names template rasterisation as a caller of the shared gate, so its busy path must follow the contract (503 + `Retry-After`).
Suggested fix (route level, so the user retries and still gets real backgrounds):
```ts
// app/api/uploads/template/route.ts
import { busyResponse, SofficeBusyError } from "@/lib/server/soffice-gate";
export const POST = handler("uploads-template", async (req) => {
  const { user } = await requireUser(req);
  await limit(`template:${user.id}`, 5, 600);
  try {
    return json(await uploadTemplate(req, user.id));
  } catch (e) {
    if (e instanceof SofficeBusyError) return busyResponse(e);
    throw e;
  }
});
```
Add a test in `tests/template-upload.test.mts`: when `uploadTemplate` gets `rasterize: async () => { throw new SofficeBusyError(15) }`, the error propagates as a `SofficeBusyError`. Optionally, also check the route mapping. If the owner prefers to degrade instead, catch it in `rasterizeTemplate` and return `{}`. Either way, a 500 is not acceptable.

### R2. A busy (503) attempt still spends the per-user PDF quota
`lib/server/pdf-cache.ts:424-426` runs `beforeConvert` (the `pdf:<user>` 10/600 s limit) **before** `toPdf` takes the gate. When every slot is busy, each request is charged and then gets a 503 with `Retry-After: 15`. A user (or a W2-E client) that follows `Retry-After` burns all 10 tokens in about 2.5 minutes of saturation and then gets 429 for up to 10 minutes. That is exactly the load this gate exists for, and the verdict/BEA-11 say to charge "only real conversions". The test `pdf-cache.test.mts:135` uses a no-op `limitFn`, so it does not catch this.
Suggested fix: charge the limit after the permit is taken. Add a hook to `toPdf` that runs inside `gate.run`:
```ts
// lib/server/pdf.ts
export type ToPdfDeps = { gate?: Gate; timeoutMs?: number; /** runs after a slot is acquired */ beforeRun?: () => Promise<void> };
...
return gate.run(async () => {
  await deps.beforeRun?.();
  return convert(bin, bytes, fileName, deps.timeoutMs ?? TIMEOUT_MS);
});
```
In `getOrConvertPdf`, make `convert` take the hook, `convert: (b, n, hook) => toPdf(b, n, { beforeRun: hook })`, and call `convert(args.bytes, args.fileName, args.beforeConvert)` instead of awaiting `beforeConvert` first. Keep the current behaviour when `convert` is injected, for tests: the injected converter receives the hook and should call it. Add a regression test: with a converter that throws `SofficeBusyError` before calling the hook, `limitFn` is called 0 times and the response is 503. A 429 raised inside the gate still releases the permit through `run`'s `finally`.

## Optional nits (non-blocking)

1. **Zombies, and a 3 s permit hold after a timeout**: in the web image, node is PID 1 (`Dockerfile:65`, and compose has no `init: true`). When a timeout kills the group, `soffice.bin` can be reparented to node, which never reaps it. It stays a zombie, `groupAlive` keeps returning true, `reapGroup` spins for 3 s while holding the permit, and zombie pids pile up. Ask W2-D1 (compose owner) to add `init: true` to `web`. The code already handles this defensively.
2. **`PDF_MAX_CONCURRENCY=1`**: `thumbGate` becomes `max(1, 0) = 1`, so thumbs can take the only slot. The comment "bitta slot doim foydalanuvchi PDF uchun qoladi" (`thumb.ts:94-96`) is then false. Document it or cap thumbs at 0 when N = 1.
3. **Abort**: queued waiters ignore `req.signal`, so a client that nginx dropped still converts after up to 20 s of waiting. The result is cached, so the work is not fully wasted. You could pass `req.signal` into `Gate.run` to drop dead waiters.
4. **TTL only on access**: `evict()` runs only on init and put, so a PDF for a deleted or retention-purged generation can stay in `/tmp` past 24 h when there are no new conversions. It cannot be served (the DB file is required), but you could run an eviction on `get`, or a cheap `setInterval(unref)` sweep.
5. **Worker page gate wait**: the worker's own gate can wait up to 20 s and then convert for up to 90 s, while the pre-check is only `remainingMs(deadline) > 20_000`. A shorter `waitMs` in the worker would help, though in prod the worker has no `soffice`.
6. **fresh-file** pre-check does not mirror `adapterFor(v.toolId)` from `ensureFreshFile`. A tool without an adapter and with `fileVersion < docVersion` would be charged a token for a no-op. That case should not happen today.
7. The `filerender:` (30/h) and `rebuild:` (30/h) buckets are separate, so the combined ceiling is 60 renders/h per user. That is acceptable; note it in the doc comment.
8. A thumb can join a PDF request's in-flight conversion and receive that request's 429 `ApiError`, which the thumb route returns as a 429 rather than 404/503. It is the same user and harmless.

---

## Re-review — commit `0175311` (2026-09-23)

### Verdict: **APPROVE**

- **R2: fixed.** `toPdf` now runs `deps.beforeRun` inside `gate.run` (`lib/server/pdf.ts:70-73`), so the limit is charged only after a slot is taken, and a 429 from it releases the slot through `run`'s `finally`. `getOrConvertPdf` hands `beforeConvert` to the converter as the `beforeRun` argument (`defaultConvert` → `toPdf(..., { beforeRun })`) and no longer calls it first. `pdfResponse` falls back to that default. The new tests use the real `toPdf` with a real `Gate`: the busy case gives `charged = 0`, the hook runs while active = 1, and a hook error still releases the slot. In `pdf-cache.test` the busy request returns 503 and the limit is not charged. Cache hits and single-flight joiners are still never charged.
- **R1: not blocking here.** The coordinator has moved it to W2-C (the template route is outside W2-A's scope), and `busyResponse`/`SofficeBusyError` are exported for it. It must still land before release: until W2-C merges, a template upload while LibreOffice is busy returns 500.
- **Nits 2, 4, 6, 7: resolved.** Nit 2: the N=1 thumb behaviour is now documented. Nit 4: `get` sweeps old entries at most once a minute; if a sweep deletes a file another reader is about to open, that read hits the existing ENOENT path and returns a miss. Nit 6: `fresh-file` now mirrors `adapterFor(v.toolId)`, with a test showing no charge when a tool has no adapter. Nit 7: the separate `filerender:`/`rebuild:` buckets (60 renders/h combined) are now documented.
- Nits 1 (`init: true` on web, owned by W2-D1), 3 (abort) and 5 (worker wait) remain open and optional.
- Tests (heavy2.sh gate, throwaway DB): the same 8 files, **43 pass / 0 fail / 0 skip**.
