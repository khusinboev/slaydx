# W3-G review: game results retention, idempotent submit, cap, CSV, share guard, ipHash

Branch `worktree-agent-a40469b13899b3cfb` @ `23c0597`. Findings: BEA-08, BEA-10, BEA-16, UX-06, ABUSE-04, DB-15, DEPS-02.

## Verdict: **CHANGES REQUESTED**

Most of the package holds up: retention, idempotency, the share guard, DEPS-02 and the migration all check out. Two confirmed defects in the CSV/pagination path would bring back the silent data loss that BEA-16/DB-15 were opened to fix. There are also two small robustness gaps in the submit path on older clients.

## Tests run (worktree root)

- `tests/game-sessions.test.mts tests/game-routes.test.mts tests/game-results-lifecycle.test.mts`: **39/39 pass**, 0 skipped. The lifecycle test did run against real Postgres.
- `tests/ui/game-player.test.mts`: **12/12 pass**.
- Ad-hoc probes. The temporary file was removed and the worktree is clean.
  - Cursor precision: 4 rows in the same millisecond with different microseconds. `iterateAllResults(batch=1)` returned **2 of 4**, and `batch=2` returned **3 of 4**.
  - `ReadableStream` semantics: I copied the route's `start()` + `try/finally close()` pattern. A mid-stream throw with a fast consumer gave **HTTP 200 and a truncated body with no error**. A slow consumer saw the error. 100 000 chunks were enqueued with no reader, so there is no backpressure.
  - Share guard: `publicGameView` is non-null for the sample docs of all 5 public kinds (`test→quiz`, crossword, flashcards, sorting, listening).
  - Case: `submissionId.toUpperCase()` creates a second row.

## Required changes

1. **Keyset cursor loses sub-millisecond precision, so rows are silently dropped (DB-15/BEA-16).**
   - The problem: `toResult` serialises `created_at` with `toISOString()`, which has millisecond precision. `timestamptz` has microsecond precision. The next page uses `(r.created_at, r.id) < ($4, $5)` with the truncated value. Any row in the same millisecond as the last row of a page, but ordered after it, has `created_at > cursor` and is skipped. This affects the CSV export at every 1000-row batch boundary and the JSON `nextCursor`.
   - When it happens: bursts where a class submits at the same moment.
   - Why the tests miss it: test D spaces rows 1 s apart, and 700 < 1000, so the export never crosses a batch boundary.
   - Fix: carry a full-precision cursor. For example, select `to_char(r.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')` (or `extract(epoch …)` µs as text) as the cursor value. Keep `createdAt` for display only.
   - Add a regression test: same-millisecond rows with different microseconds, and a small `batchSize`/`limit` so the export crosses a page boundary.

2. **CSV stream: a mid-stream error yields a truncated "successful" CSV.** This is in `app/api/generations/[id]/results/route.ts`.
   - The problem: `try { … } finally { controller.close() }` closes the stream on a DB error. When the consumer has drained the queue (the normal case), the later start rejection is ignored. The teacher gets HTTP 200 and a well-formed but incomplete file, which is the exact failure BEA-16 describes. The error is also never logged, because it happens after `handler()` has returned.
   - Fix: `catch (e) { log; controller.error(e) }` and close only on success.
   - Also recommended: move the loop into `pull()` (one batch per pull) so memory is actually bounded, as the code comments claim. Today `start()` enqueues everything regardless of the reader. Row counts are small, so this part alone would be a nit.

3. **The submit route rejects a missing `submissionId` with 400.** This breaks in-flight players during a deploy.
   - Who it hits: students whose page loaded the pre-deploy bundle. They get "Noto'g'ri so'rov" on every retry and lose the attempt.
   - Fix: when the field is absent, fall back to a server-generated `randomUUID()`. The cap still applies, only the dedupe is lost.
   - Also normalise the id with `.toLowerCase()` before use, since the regex is `/i` and uppercase variants create separate rows.
   - Keep 400 only for a present-but-malformed id.

4. **`crypto.randomUUID()` in `Player.tsx` throws on older browsers and in non-secure contexts.**
   - Where it breaks: it needs Chrome 92+, Safari 15.4+ or Firefox 95+, plus HTTPS. Next's default browserslist still targets Safari 12 and Chrome 64.
   - What happens: `start()` throws, so the loginless game can't even begin on a student's older phone. That is a new regression, and it is the first client-side use of `randomUUID` in the codebase.
   - Fix: add a tiny fallback built on `crypto.getRandomValues` that formats a v4 UUID.

## Verified OK (no change needed)

- **Retention (BEA-08):**
  - `purgeExpiredSessions` keeps only sessions that have results.
  - Both play (`/api/o/[token]`) and submit go through `getGameSessionByToken`, which filters on `expires_at > now()`, so expired links stop resolving for both.
  - Growth is bounded: at most 500 results per session and 30 shares per hour per user, and everything goes on generation delete via CASCADE.
- **Idempotency (UX-06):**
  - The full unique index `(session_id, submission_id)` matches the `ON CONFLICT` inference. NULLs never collide, so legacy rows and the direct lib path are fine.
  - The race re-read works under READ COMMITTED; the parallel test covers it.
  - The dedupe lookup runs before the cap check, so a retry after the cap is reached still gets its original score.
  - Scoping by session plus a 122-bit client id that is never exposed means another student can neither read nor overwrite a result. `submission_id` is not returned by the owner API either, and the response carries only score/total/percent.
- **Cap (ABUSE-04):** count-then-insert can overshoot by roughly the number of concurrent in-flight submits, which the per-IP limits and pool size bound. That is acceptable for an anti-spam cap. The 409 carries `code: "result_cap"`, and the player shows the server text.
- **CSV:**
  - `csvCell` injection escaping is preserved through the shared `csvRowLine`.
  - The owner check stays in SQL (`s.user_id = $2`) for both paths, and `requireUser` runs before the stream starts.
- **Share guard (BEA-10):** it uses the same `publicGameView(doc, kind)` as the player. The seed only affects ordering and never nullability. All 5 kinds are playable with their samples, and open/match-only tests get 409 `not_playable`.
- **DEPS-02:** `game_results.ip_hash` is written only and never compared, so a salt change affects nothing. In prod `env.sessionSecret` equals `SESSION_SECRET` (it must be ≥32 characters or the process throws), so hashes don't change at all. The worker already imports `env`, and compose passes `SESSION_SECRET` to both services.
- **Migration 026:**
  - The integration branch has 023–025, so after merge the numbering is contiguous. None of 023–025 touches `game_results`.
  - The column is nullable and additive, so pre-W3-G code keeps working in a rolling deploy.
  - `SET LOCAL` works because the runner wraps each file in BEGIN/COMMIT. The non-concurrent index build on a small table is fine.
  - The rollback comment is correct.
- **Player:** the id is regenerated only in `start` and «Yana o'ynash», and a retry reuses it. The UI tests lock in both behaviours.

## Nits

1. `?limit=1.5` reaches SQL as a bigint parameter and causes a 500 (owner-only). Apply `Math.floor`.
2. `GameSharePanel` ignores `total`/`nextCursor`. More than 500 results show as 500 with no hint. Show "jami N" and/or a "load more" control.
3. Expired sessions with results now stay in `GET /share` forever. The panel still renders their QR code and "Amal muddati: <past date>" as if they were live. Mark them expired or disable the QR.
4. The "unreachable" branch after the race re-read throws `ResultCapError`, which would surface as a misleading 409. Use a plain `Error`.
5. The student-facing cap message could add "o'qituvchingizga xabar bering". The retry button is futile on 409, so consider hiding it.
6. The BEA-10 finding also suggested exposing `playable` to `ResultView` so the panel can warn before a click. Optional; the 409 message is adequate.
