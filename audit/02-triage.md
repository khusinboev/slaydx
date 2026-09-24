# 02 — Triage

Branch `audit/production-readiness`. Inputs: 16 auditor reports in `audit/findings/` (194 findings), 4 independent
reviewer verdict files in `audit/triage/verify-*.md`. Target load assumed: 50 000 users, 2 000 concurrent, 10× bursts.

## 1. Method

1. **Merge and dedupe.** Every finding was grouped by root cause into **41 clusters**. 27 findings stand alone as singletons. The full mapping is in the appendix (§9). No finding was dropped.
2. **Verify every P0/P1 against the code.**
   - The orchestrator verified the P0s personally, reading the code and measuring where needed: SECA-01, SECB-01 (regex timing), BEB-01 (Postgres `jsonb` rejection reproduced), FE-01 (Next.js router plus CSP traced), DEPS-01 and INFRA-01 (reproduced in the baseline).
   - Four independent Opus reviewers re-checked every P1 cluster from the code. A reviewer was never the auditor who wrote the finding. One probe was run (PDF parse blocking the event loop).
   - Verdicts, evidence, fix scope and the proposed regression test for each are in `audit/triage/verify-{money,queue,scale,frontend}.md`.
3. **Severity is the cluster's final severity** after verification, on the scale in `AUDITOR-BRIEF.md` §4.

## 2. Counts

| | P0 | P1 | P2 | P3 | Total |
|---|---|---|---|---|---|
| Raw (as reported by auditors) | 7 | 37 | 86 | 64 | 194 |
| After verification, by finding | 22 | 52 | 90 | 30 | 194 |
| **Fix units** (clusters + singletons) | **6** | **15** | **25** | **22** | **68** |

Why P0 grew from 7 to 22 findings: the P0 clusters absorbed related findings (for example the PDF-parse cluster C06 has 7 members), and two clusters were upgraded after measurement.

### Rejected, downgraded, upgraded

No finding was rejected outright. Four claims were rejected as partly false:
- **OBS-04:** it says the web container has no healthcheck; the Dockerfile's runner stage has one.
- **FILE-05:** it says a live job gets re-claimed by a second worker; the 2 s heartbeat prevents that with one worker (SCALE-11).
- **ABUSE-06:** it says the hardcoded admin phone "is not privilege escalation"; that is contradicted by the verified SECA-01.
- **Research APIs "have no timeout":** that was the scout's claim, and it is wrong. All research calls go through a 10 s-timeout helper.

| Change | Findings | Reason |
|---|---|---|
| ⬆ P1→**P0** | EXT-02 + ABUSE-01 (C10) | The signup bonus unlocks free rewrite. One free account can burn about $50–100/day, and exhausting the Gemini quota stops paid generation for everyone (R1). |
| ⬆ P1→**P0** | CONC-09 + SECB-04 + FILE-04 (C06) | Probe: an **841 KB, 600-page PDF froze the web event loop for 28.2 s** in one block (R2). |
| ⬆ P2→**P1** | SCALE-10, BEA-15 (C29) | `ticket:new:${ip}` allows 10 per 5 min on the only live login path, so users behind carrier NAT or a school's shared IP get locked out during bursts (R4). |
| ⬇ P0→P1 | INFRA-01 | Triggered only by a misconfigured deploy, not by users or load. It has happened once (2026-09-17 outage). |
| ⬇ P0→P2 | DEPS-01 | Information disclosure only, no credentials. The same server address and phone number also appear in README, docs and scripts (R3). |
| ⬇ P0→merged | DEPS-08 | Part of C01. Once the contact check is fixed, the public admin phone no longer grants anything. |
| ⬇ P1→P2 | BEA-01 + ABUSE-03 (C12) | Underbilling is at most 12 000 coins per job, and the job still covers its own provider cost (R1). |
| ⬇ P1→P2 | BEB-02 cluster (C15), INFRA-02 cluster (C14) | The heartbeat prevents duplicate runs with one worker. On a deploy, jobs pause 2–12.5 min and then re-run (R2). |
| ⬇ P1→P2/P3 | OBS-01, OBS-03 → P2; OBS-02 → P3; OBS-05 → P2 | Diagnosability gaps, not failures under load. The worker already logs stacks at `worker.ts:317,400`. |
| ⬇ P1→test debt | TEST-01…07 | Coverage gaps with no live bug. They become mandatory regression tests inside the fix waves, plus the C40 harness. |
| split | FILE-01 / DB-01 (C23) | Keeping files forever was an owner decision (commit `112c9a3`). The dead `FILE_TTL_HOURS` config is P3; the disk-capacity risk is P1 and needs a design decision. |

## 3. P0 — verified

| Cluster | What an attacker or ordinary user can do | Evidence |
|---|---|---|
| **C01** Admin takeover (SECA-01) | Any Telegram user sends the bot a contact card with no `user_id`, using the admin number in 9-digit form. The raw-string unique index doesn't catch it, but `isAdminPhone` normalises it and matches. Result: full `/api/admin`, unlimited credits, a dump of every user's PII, and the ability to block the real admin. | `telegram.ts:301` `if (contact.user_id != null && …)`; `admin-phones.ts` `normalizePhone` (9 digits → `998…`); `requireAdmin` = `isAdminPhone(user.phone)` only |
| **C02** `returnTo` XSS (FE-01) | A crafted link `/uz?returnTo=javascript:…` runs script in the site origin after the victim logs in. It can spend the victim's credits, read their documents, and credit wallets if the victim is the admin. | `HomeFiles.tsx:31` → `LoginModal.tsx:42` `router.push(returnTo)`; Next 15.5 → `location.assign`; CSP `script-src 'unsafe-inline'` |
| **C03** Free document plus refund (BEB-01) | Typing 79 characters plus an emoji in "position" (or any NUL character) makes the `jsonb` write fail after the file is stored. The job ends FAILED with a full refund, and the file is still downloadable. Normal LLM text with an emoji at a cut point fails jobs the same way. | Postgres rejects `'"\ud83d"'::jsonb`; `meta.ts:245` `.slice(0, 80)`; `getGenerationFile` has no status check |
| **C04** Regex freeze (SECB-01) | Uploading a text file with a long run of spaces blocks the single web event loop: 40k characters = 1.0 s (quadratic), **1 MB ≈ 12 min, 8 MB (the allowed max) ≈ 12 h**. Any logged-in user can do it, 20 times per 5 min. | Measured `/[ \t]+\n/`, `/<[^>]+>/`, `/\s*$/`; `tidy()` runs before the 200k-character truncation |
| **C06** Parsing freeze (CONC-09 + 6) | An 841 KB PDF blocks the web process for 28 s. OOXML inflate budgets trust zip metadata, and the PPTX template parser has none. | R2 probe; `translate/pdf.ts:212-213`; `pptx-template.ts` |
| **C10** Free-LLM cost (EXT-02 + ABUSE-01) | Rewrite, polish, outline and udk charge no credits. Rewrite allows 2 880 calls/day per account, and there is no spend cap or kill switch. | R1; `rewrite/route.ts:31`; `auth.ts:15` bonus |

## 4. P1 — verified clusters (Wave 2 unless marked DESIGN)

| Cluster | Summary | Reviewer |
|---|---|---|
| C07 LibreOffice fan-out | `?format=pdf` and thumbnails spawn uncapped `soffice` processes in the web container, with no rate limit, no caching and orphaned `soffice.bin` on timeout. This can OOM the shared VPS. | R3 |
| C08 Caching | A global `/api/:path*` `no-store` rule overrides the routes' immutable caching, so every view re-reads image bytes from Postgres (a 5× hex blow-up). | R3 |
| C09 Hot reads | The poll and list endpoints read `values_json` (up to ~400 KB per row) and throw it away. The list polls every 3 s, has no pagination, and documents past the newest 100 are unreachable. | R3 |
| C11 Payme test key | `PAYME_TEST_KEY` is accepted in production whenever it is set. **P0 if set on the box.** | R1 |
| C13 Upload quota | About 5.6 GB/h per free account can be written into Postgres. About 1 GB/h of that is never purged, on a disk shared with two other projects. | R1 + orchestrator |
| C16 Queue fairness | Claim is a strict global first-in-first-out; one account can hold both worker slots. | R2 |
| C17 Zombie web | A config or migration error at boot leaves the process up and serving 500s, which Docker never restarts. | orchestrator (baseline) + R3 |
| C18 No limits | No container `mem_limit`/`cpus` and no log rotation on a shared box. | R3 |
| C19 Health and alerting | The worker has no healthcheck, `/api/health` ignores the worker and queue age, and nothing alerts. | R3 |
| C20 Frozen result page | Polling gives up after 20 min, after an outage over ~30 s, or on any 4xx, and the error is only rendered for COMPLETED jobs. | R4 |
| C21 Editor loses edits | A failed save drops every unsaved edit, and the server rejects more than 50 operations, so long sessions fail deterministically. | R4 |
| C29 NAT login lockout | IP-keyed login limits of 10 per 5 min. **Owner check: `TRUST_PROXY` in the production `.env`.** | R4 |
| C22 **DESIGN** Capacity | About 30–50 jobs/h today against about 1 200–2 400 jobs/h needed. There is no backpressure or ETA, and a single Node process serves everything. | R3 |
| C23 **DESIGN** Retention | Files are kept forever as `bytea`, and slide images are stored twice. | R3 |
| C24 **DESIGN** Backups | Backups are manual, pre-deploy only, kept on the same box, and a restore has never been tested. | R3 |

P2 (25 units) and P3 (22 units) are listed in the appendix, with auditor evidence in `audit/findings/`.

## 5. Top 10 risks, in plain language

1. **Anyone can make themselves admin** through the Telegram bot, then give themselves unlimited money and see every user's phone number. (C01)
2. **A booby-trapped login link** runs attacker code in the victim's account after they log in. If the admin clicks it, the attacker gets admin powers. (C02)
3. **An emoji in one form field gives a free document and a full refund**, and the same bug randomly fails honest users' jobs. (C03)
4. **One upload can freeze the whole site:** a text file for hours, a PDF for about 30 s at a time. (C04, C06)
5. **Free AI buttons burn real money** at about $50–100/day per free account. Exhausting the Gemini quota would stop paid work for everyone. (C10)
6. **The system can finish about 40 jobs an hour; the target needs about 2 000.** One user can also occupy both worker slots, while others watch a progress bar that freezes after 20 min. (C22, C16, C20)
7. **The disk will fill up.** Uploads are unlimited, files are kept forever inside Postgres, and backups sit on the same disk as the database and two other projects. (C13, C23, C24)
8. **PDF downloads can crash the server.** Each one starts a new LibreOffice process, and containers have no memory limits on a shared box. (C07, C18)
9. **Mobile and school users can be locked out of login** during a traffic spike, because of per-IP limits behind shared mobile IPs. (C29)
10. **Failures are silent.** A bad deploy leaves a "running" but dead site, a dead worker goes unnoticed, and the editor quietly drops edits. (C17, C19, C21)

## 6. Owner decisions and checks

**Check now, on the server (read-only):**
- Is `PAYME_TEST_KEY` set in `/opt/slaydx/.env`? If yes, remove it: until then, C11 is a live P0.
- The value of `TRUST_PROXY` in the production `.env`. `.env.example` ships `false`, which would override compose's default of `true`.
- Does every nginx `location` set `X-Forwarded-For $proxy_add_x_forwarded_for`? Is there a CDN in front?

**Decide before Wave 1:**
- **C10 free-LLM policy.** Proposed default:
  - per-user daily caps on rewrite, polish, outline and udk;
  - a global daily spend cap;
  - an environment kill switch;
  - free rewrite and polish only on documents paid with real balance, not bonus points.

**Decide within Wave 2 (design notes will be written for these):**
- C22 capacity: worker count and host.
- C23 retention: how long to keep files, and whether files move out of Postgres.
- C24 backups: an automated off-box copy.

**Product decisions:**
- **Public repo:** make it private, or rewrite history? The server address and your phone number are in `.claude/`, README, docs and scripts. That's a P2, and this audit won't rewrite history without your explicit approval.
- **Signup-bonus farming** (ABUSE-02).
- **Language switcher** (UX-09): make it work, or remove it.
- **Numbers for:** the per-user queue cap, the PDF page cap, and the IP limit ceilings.

## 7. Wave plan and file ownership

Rules:
- **One file, one agent per wave.** Shared files (`docker-compose.yml`, `Dockerfile`, `next.config.ts`, `lib/server/env.ts`, migrations, `package.json`) belong to exactly one package.
- **At most 2 heavy processes machine-wide.** A 2-slot lock wraps `scripts/heavy.sh` for the fixers.
- **Every fix ships a regression test** that fails before the fix and passes after, checked by mutation.
- **A separate Opus reviewer** checks each fix before it's merged.

### Wave 1 — P0 (5 packages, run in parallel)

| Pkg | Clusters | Owner files | Model |
|---|---|---|---|
| W1-A | C01 | `lib/server/telegram.ts`, `lib/server/admin-phones.ts`, tests | Sonnet |
| W1-B | C02 | `lib/ui.ts`, `components/overlays/LoginModal.tsx`, `components/home/HomeFiles.tsx`, tests | Sonnet |
| W1-C | C03 | new `lib/server/jsonb.ts` (sanitiser), `lib/server/{jobs,storage,worker,form-draft,resume-draft,game-sessions,slide-commit,edit-adapters}.ts`, `lib/generation/meta.ts` and clip helpers | Opus |
| W1-D | C04 + C06 | `lib/extract-text.ts`, `lib/generation/translate/{plain,pdf,xml-scan}.ts`, `lib/generation/pptx-template.ts`, `lib/server/{source-upload,template-upload}.ts`, `app/api/extract/route.ts`, `app/api/uploads/{source,template}/route.ts`, new parse worker (`worker_threads` + timeout + memory cap) | Opus |
| W1-E | C10 | `app/api/{outline,article/udk}/route.ts`, `app/api/generations/[id]/{rewrite,polish}/route.ts`, `lib/server/ratelimit.ts`, new `lib/server/spend.ts`, `lib/server/env.ts`★, `docker-compose.yml`★ | Opus |

### Wave 2 — P1 (6 packages plus 3 design notes)

| Pkg | Clusters | Owner files |
|---|---|---|
| W2-A | C07 | `lib/server/{pdf,thumb}.ts`, `app/api/generations/[id]/{file,thumb}/route.ts` |
| W2-B | C08, C09, C16 | `next.config.ts`★, `lib/server/jobs.ts`, `lib/server/storage.ts`, `app/api/generations/route.ts`, `app/api/generations/[id]/route.ts` |
| W2-C | C11, C13, C29 | `app/api/payments/payme/route.ts`, `lib/server/payments.ts`, `lib/server/{photo,logo,source-upload,template-upload}.ts` (quota), IP-limited auth routes, `lib/server/ratelimit.ts` |
| W2-D | C17, C18, C19 | `instrumentation.ts`, `docker-compose.yml`★, `Dockerfile`★, `app/api/health/route.ts`, `lib/server/worker.ts`, `scripts/worker.ts`, `lib/server/env.ts`★ |
| W2-E | C20, C21 (+ UX-08) | `lib/api-client.ts`, `components/files/{ResultView,useDocEdit}.tsx/.ts`, `components/home/HomeFiles.tsx` (pagination UI) |
| DESIGN | C22, C23, C24 | `audit/designs/{capacity,retention,backups}.md`. Each is presented to you before any implementation. |

### Wave 3 — P2 (25 units)

Grouped the same way after Wave 2 lands: C05, C12, C14, C15, C25–C28, C30–C38, C40, and the P2 singletons.

### Wave 4 — P3 (22 units)

Only if you approve.

After each wave: the full `npm run check`, a build, and a start-up smoke test on the throwaway DB. Then a commit, and `audit/03-progress.md` is updated.

## 8. Estimated scope

| Wave | Units | Size | Rough effort (2 heavy slots) |
|---|---|---|---|
| W1 | 5 packages / 6 clusters / 22 findings | 2×S, 3×M | about 1 working session |
| W2 | 6 packages + 3 design notes / 15 units | mostly M, capacity L | 1–2 sessions, plus your design decisions |
| W3 | 25 units | S–M | about 2 sessions |
| W4 | 22 units | S | about 1 session |
| Phase 5 | k6 load tests + chaos checks on a local stack | M | about 1 session |

## 9. Appendix — every finding → cluster → final severity → wave

| Finding | Auditor sev | Cluster | Final sev | Wave | Title |
|---|---|---|---|---|---|
| DEPS-08 | P0 | C01 | P0 | W1 | Admin-authorization phone number hardcoded in source, public on GitHub — identifies the exact account to attac |
| SECA-01 | P0 | C01 | P0 | W1 | Any Telegram user can become admin: the bot accepts a forged contact (no `user_id`) and the 9-digit phone form |
| TEST-12 | P2 | C01 | P0 | W1 | `requireAdmin` guard itself is untested (composes two tested primitives, but the composition isn't) |
| ABUSE-06 | P3 | C01 | P0 | W1 | Admin phone number hardcoded in the public repo |
| FE-01 | P0 | C02 | P0 | W1 | `?returnTo=` is passed unvalidated to `router.push` after login → open redirect and DOM XSS (`javascript:` URL |
| SECA-02 | P2 | C02 | P0 | W1 | Post-login open redirect via `returnTo` query param |
| BEB-01 | P0 | C03 | P0 | W1 | Astral-character truncation corrupts `doc_json`, making `completeJob` throw AFTER the file is already stored:  |
| BEA-02 | P2 | C03 | P0 | W1 | Lone UTF-16 surrogates (and NUL) in user text make JSONB/TEXT writes throw → unhandled 500; `.slice()` truncat |
| SECB-01 | P0 | C04 | P0 | W1 | Quadratic regexes in upload text parsing block the web process event loop (single authenticated request) |
| DEPS-01 | P0 | C05 | P2 | W3 | Production server IP, root-SSH access pattern, other tenants' infra layout, and owner's real phone number comm |
| INFRA-10 | P2 | C05 | P2 | W3 | `.dockerignore` doesn't exclude `eval-out/`, `scratch-tmp/`, `.claude/`, `audit/`, or `docs/` — unlike `.gitig |
| CONC-09 | P1 | C06 | P0 | W1 | Uploaded-document parsing runs on the web process's event-loop thread; pdf.js (unpdf "fake worker") yields onl |
| SECB-02 | P1 | C06 | P0 | W1 | ZIP "bomb" budget trusts archive metadata; template parsing has no inflate budget at all (memory exhaustion in |
| FILE-02 | P2 | C06 | P0 | W1 | OOXML translation/template parsing loads whole file into memory with weak zip-bomb guards; multiple copies hel |
| FILE-04 | P2 | C06 | P0 | W1 | Untrusted PDF parsed page-by-page with no page cap and no timeout; quadratic line grouping → CPU/DoS |
| SECB-04 | P2 | C06 | P0 | W1 | Uploaded PDFs are fully parsed page-by-page in the web request with no page cap |
| TEST-11 | P2 | C06 | P0 | W1 | OOXML zip-bomb budget (`MAX_UNZIPPED_BYTES`) has no test |
| SECB-05 | P3 | C06 | P0 | W1 | Upload size pre-check is bypassable with chunked uploads (no Content-Length), so the whole body is still buffe |
| BEA-20 | P1 | C07 | P1 | W2 | `GET /api/generations/[id]/file?format=pdf` spawns an unbounded number of LibreOffice processes (no rate limit |
| CONC-01 | P1 | C07 | P1 | W2 | Unbounded LibreOffice fan-out in the web container: `GET …/file?format=pdf` has no rate limit and no global co |
| FILE-03 | P1 | C07 | P1 | W2 | On-demand PDF conversion has no concurrency cap on the web container → soffice fork-bomb / OOM under load |
| CONC-08 | P2 | C07 | P1 | W2 | `GET …/file` (`ensureFreshFile`) re-renders PPTX/DOCX in the web process with no rate limit, bypassing the 30/ |
| FILE-06 | P2 | C07 | P1 | W2 | soffice timeout may orphan `soffice.bin`; temp profile dir is rm'd out from under it |
| SCALE-04 | P2 | C07 | P1 | W2 | Document re-rendering (PPTX/DOCX/poster) runs inside web request handlers on the single event loop; the downlo |
| SCALE-07 | P2 | C07 | P1 | W2 | Thumbnails are built on demand in the web process by converting the whole document with LibreOffice: 2 slots p |
| UX-08 | P2 | C07 | P1 | W2 | PDF download button shows no progress feedback while converting (up to 60s of a silently disabled button) |
| SCALE-01 | P1 | C08 | P1 | W2 | Global `/api/:path*` header rule forces `Cache-Control: private, no-store` onto every image/thumbnail/audio ro |
| BEA-07 | P2 | C08 | P1 | W2 | Route-level `Cache-Control` is silently overridden by `next.config.ts` (`/api/:path*` → `private, no-store`):  |
| DB-06 | P2 | C08 | P1 | W2 | Files and assets are read whole from `bytea` into the web process as hex text, using about 5× the file size in |
| FE-05 | P2 | C08 | P1 | W2 | The global `/api/:path*` → `Cache-Control: private, no-store` overrides the immutable caching of every image,  |
| SCALE-08 | P2 | C08 | P1 | W2 | Every file/asset/template read materialises the whole BYTEA 4–6× in the web process (hex text protocol + copie |
| BEA-06 | P1 | C09 | P1 | W2 | `GET /api/generations` has no pagination (items beyond the newest 100 become unreachable) and reads `values_js |
| CONC-18 | P2 | C09 | P1 | W2 | Every poll and every list request fetches and `JSON.parse`s `values_json` (up to 200 000-char `sourceText`) th |
| DB-03 | P2 | C09 | P1 | W2 | List and poll queries read `values_json` (up to about 1 MB per row), then throw it away, and the list is polle |
| FE-08 | P2 | C09 | P1 | W2 | «Mening fayllarim» hides paid documents: only the newest 100 are ever listed (no pagination), and the «Testlar |
| SCALE-03 | P2 | C09 | P1 | W2 | Both hot read paths (`GET /api/generations/[id]` poll and the 3-second `GET /api/generations` list poll) read  |
| FE-12 | P3 | C09 | P1 | W2 | Polling ignores tab visibility and never backs off on the list: `/uz` refetches the full 100-row list every 3  |
| SCALE-12 | P3 | C09 | P1 | W2 | Every completed-document response carries the whole document twice (`doc` and `html`), and one «Saqlash» costs |
| ABUSE-01 | P1 | C10 | P0 | W1 | Free `outline`/`udk` LLM endpoints charge no credits and are the cheapest way to burn provider money without b |
| EXT-02 | P1 | C10 | P0 | W1 | No global/per-user LLM spend cap or kill switch; free LLM endpoints give any account ≈ $50–100/day of provider |
| BEA-11 | P3 | C10 | P0 | W1 | Rate-limit buckets are consumed before validation/ownership and regardless of outcome: failed polishes burn th |
| CONC-11 | P3 | C10 | P0 | W1 | Web LLM endpoints ignore client disconnect and have no per-document single-flight: parallel polish requests al |
| CONC-13 | P3 | C10 | P0 | W1 | Rate limiter fails open on any DB error, so limits on free LLM endpoints disappear exactly when the database i |
| SCALE-14 | P3 | C10 | P0 | W1 | DB pool exhaustion turns into 10-second stalls and then 500s, and the rate limiter fails **open** whenever its |
| EXT-01 | P1 | C11 | P1 | W2 | Payme webhook accepts the sandbox TEST key in production (test payments can credit real balance) |
| BEA-01 | P1 | C12 | P2 | W3 | `priceFor` prices unknown/untrimmed package values at the cheapest tier, while the engines trim/clamp them up  |
| ABUSE-03 | P2 | C12 | P2 | W3 | Price/budget page-count default diverges from the generation engine's default → omit or near-miss `pages` to u |
| FE-18 | P3 | C12 | P2 | W3 | The price the user sees is computed by the (possibly stale) client bundle, and the server charges its own pric |
| DB-02 | P1 | C13 | P1 | W2 | Upload tables have no per-user quota: one free account can write about 5 GB/hour of `bytea`, and logos and tem |
| EXT-08 | P2 | C13 | P1 | W2 | `source_cache` stores raw provider payloads and is never purged (unbounded Postgres growth on the shared VPS) |
| INFRA-02 | P1 | C14 | P2 | W3 | Worker's SIGTERM handler force-exits after a hardcoded 2s, abandoning in-flight jobs on every deploy; abandone |
| CONC-03 | P2 | C14 | P2 | W3 | Worker SIGTERM (every deploy) abandons in-flight jobs to a budget-sized lease: progress freezes up to ~11 min, |
| DB-05 | P2 | C14 | P2 | W3 | A worker restart (every deploy) leaves its jobs "IN_PROGRESS" with a fresh heartbeat; they are only requeued a |
| INFRA-08 | P2 | C14 | P2 | W3 | `web` has no explicit `stop_grace_period`; Docker's 10s default is shorter than the service's own documented ~ |
| BEB-02 | P1 | C15 | P2 | W3 | No AbortSignal is plumbed to the running generation, so a job that overruns its budget keeps executing (and sp |
| EXT-03 | P2 | C15 | P2 | W3 | LLM role chain ignores the caller's time budget (per-attempt timeout × retries × specs, uncapped `Retry-After` |
| FILE-05 | P2 | C15 | P2 | W3 | Per-request `maxDuration` and the job deadline do not abort in-progress CPU work |
| BEB-05 | P3 | C15 | P2 | W3 | A reclaimed job re-runs `buildArtifact` in full, doubling LLM/image spend with no cost cap; only asset writes  |
| EXT-10 | P3 | C15 | P2 | W3 | TTS chain has no job deadline: sequential parts × 2 attempts × 30 s, uncapped `Retry-After`, full restart on t |
| SCALE-11 | P3 | C15 | P2 | W3 | Timeouts: the worker has no hard per-job limit (its heartbeat keeps a stuck job alive forever), and two web ro |
| CONC-07 | P1 | C16 | P1 | W2 | Global FIFO claim with no per-user fairness: one account can occupy both worker slots for hours and starve eve |
| SCALE-05 | P2 | C16 | P1 | W2 | Queue is strict global FIFO with no per-user in-flight cap: one user (or one teacher batch) can hold every wor |
| INFRA-01 | P0 | C17 | P1 | W2 | `instrumentation.ts` throws on prod misconfig instead of exiting: process stays alive, serves 500 to everythin |
| TEST-05 | P1 | C17 | P1 | W2 | `assertRuntimeConfig`'s auth/boot-safety branches are untested (only the TTS carve-out is) |
| CONC-17 | P3 | C17 | P1 | W2 | `WORKER_INLINE` defaults to `true`: any web instance started without the explicit compose override also runs t |
| INFRA-04 | P1 | C18 | P1 | W2 | No resource limits on any container: one runaway LibreOffice/worker process can starve Postgres *and* the two  |
| OBS-10 | P2 | C18 | P1 | W2 | No log rotation configured for the Docker `json-file` driver on any service; logs accumulate unbounded on a bo |
| INFRA-15 | P3 | C18 | P1 | W2 | No log rotation configured for any container; default `json-file` driver grows unbounded on a long-running, di |
| INFRA-06 | P1 | C19 | P1 | W2 | Worker has no `HEALTHCHECK`, and the health endpoint Docker/anyone unauthenticated actually sees never looks a |
| OBS-01 | P1 | C19 | P1 | W2 | No external error tracking/alerting integration anywhere; no `onRequestError` hook, so server-side page-render |
| OBS-04 | P1 | C19 | P1 | W2 | No alerting of any kind: `/api/health` is pull-only and nothing polls it; Docker has no `healthcheck:` on `web |
| OBS-12 | P2 | C19 | P1 | W2 | `queueDepth()` returns only counts, not oldest-queued age or last-worker-heartbeat age — `/api/health` can't d |
| FE-16 | P3 | C19 | P1 | W2 | One root error boundary and no client error reporting: any viewer render error hides the Download/Delete heade |
| FE-02 | P1 | C20 | P1 | W2 | Result page freezes silently when polling gives up (20-min cap, ~30 s outage, any 4xx): the error is only rend |
| UX-05 | P1 | C20 | P1 | W2 | Client polling timeout (20 min) is silently swallowed while a job is still QUEUED/IN_PROGRESS — progress bar f |
| FE-14 | P3 | C20 | P1 | W2 | No client request has a timeout or abort signal: a stalled mobile connection freezes polling and blocks every  |
| FE-03 | P1 | C21 | P1 | W2 | Viewer editor loses ALL unsaved edits when a save fails; the server rejects more than 50 queued ops, so a long |
| INFRA-03 | P1 | C22 | P1 | DESIGN | No backpressure: `WORKER_CONCURRENCY=2` (single worker container) against a 2 000-concurrent / 10× burst targe |
| SCALE-02 | P1 | C22 | P1 | DESIGN | Generation capacity is ~30–50 jobs/hour; the target needs ~1 200–2 400 jobs/hour (50–160 concurrent job slots) |
| SCALE-09 | P2 | C22 | P1 | DESIGN | All API traffic, polling and static assets go through one single-threaded Next.js process that the current com |
| UX-07 | P3 | C22 | P1 | DESIGN | No queue depth/ETA shown while QUEUED; a long backlog looks identical to a job that just started |
| DB-01 | P1 | C23 | P1 | DESIGN | Every generated file and image is kept forever as `bytea` in the one Postgres on a shared VPS disk; images are |
| FILE-01 | P1 | C23 | P1 | DESIGN | Generated files/assets never purged; `FILE_TTL_HOURS` is dead config → Postgres disk grows unbounded |
| BEB-06 | P2 | C23 | P1 | DESIGN | Generated files/assets/rows are never purged (migration 011 removed the TTL and nothing replaced it); at targe |
| INFRA-05 | P1 | C24 | P1 | DESIGN | Backups are manual, pre-deploy-only, stored on the same box as the primary database, and restore has never bee |
| OBS-05 | P1 | C25 | P2 | W3 | If `refund()` itself throws after `failJob()` already succeeded, the failure is swallowed into a generic catch |
| BEA-04 | P2 | C25 | P2 | W3 | Refunds are a separate, non-retried step after the status change: one DB error (e.g. pool-connect timeout unde |
| BEB-04 | P2 | C25 | P2 | W3 | Housekeeping refunds dead jobs in a second query after `reclaimStaleJobs` commits; if the user deletes the now |
| CONC-05 | P2 | C25 | P2 | W3 | Status transition and refund are separate transactions with no reconciliation: a crash or DB error between the |
| DB-04 | P2 | C25 | P2 | W3 | A refund is not in the same transaction as the FAILED/REVOKED status change, so any error or exit in between l |
| CONC-14 | P3 | C25 | P2 | W3 | `activatePro` grants quota and extends the plan in two separate commits; a failure between them cannot be heal |
| BEA-03 | P2 | C26 | P2 | W3 | Slide-image and resume-photo uploads write asset bytes BEFORE ownership/status/version checks → orphaned BYTEA |
| CONC-06 | P2 | C26 | P2 | W3 | Job fencing token is the per-process worker id, and the losing run writes then deletes the file/assets uncondi |
| SECB-03 | P3 | C26 | P2 | W3 | Viewer image uploads write the asset row before ownership/version is checked |
| BEA-18 | P2 | C27 | P2 | W3 | `LiveReporter` promise chains reject with no handler: in the standalone worker (no `unhandledRejection` listen |
| BEB-03 | P2 | C27 | P2 | W3 | The standalone worker process installs no `unhandledRejection` / `uncaughtException` handler, so one leaked re |
| CONC-04 | P2 | C27 | P2 | W3 | `LiveReporter` promise chains have no rejection handler: one transient DB error during a slide job crashes the |
| EXT-04 | P2 | C28 | P2 | W3 | Fallback never engages for a slow/hung provider and there is no circuit breaker; Gemini is a hard single point |
| EXT-05 | P2 | C28 | P2 | W3 | Telegram login replies: no 429/`retry_after` handling and updates are de-duplicated *before* the reply, so log |
| EXT-06 | P2 | C28 | P2 | W3 | Stock-photo quotas (Pexels 200/h, Pixabay 100/min) are unmanaged; when exhausted every standard deck ships wit |
| EXT-07 | P2 | C28 | P2 | W3 | Research-source quotas (Google Books 1 000/day, OpenAlex daily allowance) run out at a few hundred jobs/day; p |
| EXT-09 | P2 | C28 | P2 | W3 | No per-provider concurrency limit or backpressure: quota saturation turns into a failure cliff (failed + refun |
| SCALE-06 | P2 | C28 | P2 | W3 | No shared rate limiter for LLM/image providers; retries are too short to ride out a 429, so more workers means |
| EXT-13 | P3 | C28 | P2 | W3 | Retry hygiene: no jitter, Gemini `RetryInfo` ignored, 429-on-quota retried immediately, wasted 2 s sleep after |
| ABUSE-05 | P2 | C29 | P1 | W2 | `TRUST_PROXY=true` trusts the *last* `X-Forwarded-For` element; IP rate-limits are spoofable if nginx doesn't  |
| BEA-15 | P2 | C29 | P1 | W2 | IP-keyed limits on the login and public-game paths are sized for one person per IP; Uzbek mobile CGNAT and sch |
| SCALE-10 | P2 | C29 | P1 | W2 | Per-IP rate limits on login and on public game submits fail for users behind one NAT (a school classroom, mobi |
| SECA-03 | P3 | C29 | P1 | W2 | Rate-limit client IP trusts the last `X-Forwarded-For` hop; spoofable if nginx is not configured to overwrite/ |
| TEST-01 | P1 | C30 | P2 | W3 | Payment order state machine and JSON-RPC/webhook dispatch: zero test coverage beyond signature crypto |
| BEA-05 | P2 | C30 | P2 | W3 | Payme Merchant API state machine deviates from the protocol: no 12-hour transaction timeout, "order busy" repo |
| CONC-02 | P2 | C30 | P2 | W3 | Payment settlement is not serialized per order: Payme Cancel ∥ Perform keeps credits on a cancelled order; con |
| DB-09 | P2 | C30 | P2 | W3 | Payment order state changes are check-then-act under READ COMMITTED with no row lock; the credit and the `stat |
| OBS-09 | P2 | C30 | P2 | W3 | Click/Payme webhook raw request bodies are never persisted; `payment_orders` stores only derived fields, so a  |
| OBS-14 | P3 | C30 | P2 | W3 | `transactions.reference` overloads one `TEXT` column with two different meanings (generation UUID for charge/r |
| OBS-02 | P1 | C31 | P2 | W3 | No structured logging and no correlation id threading web request → generation → worker job; ~300 free-text `c |
| OBS-03 | P1 | C31 | P2 | W3 | Stack traces are systematically discarded; every catch block logs `err.message` (or a bare string) only, never |
| OBS-06 | P2 | C31 | P2 | W3 | Several genuinely silent (`.catch(() => {})`, no logging at all) catch blocks, plus one on the health/monitori |
| OBS-08 | P2 | C31 | P2 | W3 | Job forensics: `generations.error` is a single free-text column overwritten on every attempt; no stage/provide |
| OBS-11 | P2 | C31 | P2 | W3 | No documented or scripted way to do log/job forensics beyond `docker compose logs --tail=50`; incident respons |
| BEA-09 | P3 | C31 | P2 | W3 | Worker failures persist the raw exception message (`e.message` from pg, sharp, docx, TypeErrors, provider SDKs |
| EXT-12 | P3 | C31 | P2 | W3 | Raw provider error text reaches end users (doc JSON, `generations.error`, transaction notes) and logs unredact |
| DB-07 | P2 | C32 | P2 | W3 | Migration runner: every file in one transaction with the pool's 30 s `statement_timeout` and no `lock_timeout` |
| CONC-12 | P3 | C32 | P2 | W3 | Migration runner inherits the pool's 30 s `statement_timeout`: the process that loses the web/worker start-up  |
| DB-08 | P2 | C33 | P2 | W3 | DB capacity config is fixed and stock: the web pool is 10 connections (compose does not forward `DATABASE_POOL |
| FE-06 | P2 | C34 | P2 | W3 | The submit button re-enables right after a successful paid enqueue, while navigation is still pending; a secon |
| CONC-10 | P3 | C34 | P2 | W3 | No idempotency key on `POST /api/generations`: a 5xx/timeout after the enqueue committed + the user's retry =  |
| INFRA-09 | P2 | C35 | P2 | W3 | `NEXT_PUBLIC_BRAND_NAME`/`NEXT_PUBLIC_BRAND_LOGO` are not passed to the `worker` container, so a brand rename  |
| INFRA-11 | P2 | C35 | P2 | W3 | nginx (TLS termination, body-size limits, timeouts, rate limiting) lives entirely outside version control — un |
| INFRA-12 | P2 | C35 | P2 | W3 | Worker's production image ships the full `devDependencies` tree (eslint, jsdom, tailwindcss, testing-library,  |
| INFRA-13 | P2 | C35 | P2 | W3 | No CI: tests only ever run on a developer laptop, and the production build itself happens on the shared prod b |
| DEPS-05 | P3 | C35 | P2 | W3 | Docker base images unpinned (tag only, no digest) |
| DEPS-06 | P3 | C35 | P2 | W3 | Worker image ships ~430 devDependency packages (`npm ci --include=dev`) into production |
| INFRA-14 | P3 | C35 | P2 | W3 | Base image `node:22-alpine` is pinned only to the major version, and the image is rebuilt from that floating t |
| BEA-08 | P2 | C36 | P2 | W3 | Teachers' game results are hard-deleted 30 days after the share link is created (link expiry cascades into `ga |
| BEA-10 | P2 | C36 | P2 | W3 | `POST /api/generations/[id]/share` creates public links for games that have nothing playable (e.g. a test of o |
| UX-06 | P2 | C36 | P2 | W3 | Public game "Qayta yuborish" after a failed submit can create a duplicate result row (no idempotency) |
| ABUSE-04 | P3 | C36 | P2 | W3 | Public game submit has no per-session result cap; a shared/leaked token lets anyone insert `game_results` rows |
| BEA-16 | P3 | C36 | P2 | W3 | Result and template lists are silently capped (500 game results, 12 templates) with no paging or "more" signal |
| DB-15 | P3 | C36 | P2 | W3 | The game results table and CSV export are silently cut to the 500 newest rows, and anyone with the public link |
| FE-04 | P2 | C37 | P2 | W3 | Any transient failure of `GET /api/auth/session` logs the user out in the UI mid-session (document disappears, |
| FE-09 | P2 | C37 | P2 | W3 | The persisted store rehydrates synchronously before React hydration: `/uz/create` pops the login modal for log |
| FE-10 | P2 | C37 | P2 | W3 | Telegram Mini App auto-login is dead code: `telegram-web-app.js` is never loaded, so `window.Telegram.WebApp.i |
| UX-01 | P2 | C37 | P2 | W3 | Telegram login popup can be silently blocked, leaving the user on a spinner with no explanation |
| UX-02 | P2 | C37 | P2 | W3 | Telegram login link opened on a different device/browser never completes; no explanation why the waiting scree |
| UX-03 | P2 | C37 | P2 | W3 | Balans yetarli emas error has no top-up link; balance is invisible anywhere in the app shell |
| UX-04 | P2 | C37 | P2 | W3 | Payment "confirming" banner freezes forever if the webhook takes longer than 15s (or never arrives) |
| FE-19 | P3 | C37 | P2 | W3 | After returning from Click/Payme, the purchase page says «To'lov tasdiqlanmoqda…» forever: it stops checking a |
| UX-09 | P2 | C38 | P2 | W3 | TopBar language switcher (6 languages) has no effect on anything — fully decorative |
| FE-21 | P3 | C38 | P2 | W3 | The UI-language switcher (6 languages) is decorative: choosing English/Русский changes only the flag icon and  |
| CONC-15 | P3 | C39 | P3 | W4 | Thumbnail cache race: an in-flight thumbnail build re-inserts the pre-edit image after `rebuildFile` invalidat |
| DB-10 | P3 | C39 | P3 | W4 | Housekeeping is fragile: one failing step skips every later purge, purges are unbatched single DELETEs under a |
| DB-11 | P3 | C39 | P3 | W4 | Scans with no supporting index on login, purge, reconciliation and admin paths |
| DB-12 | P3 | C39 | P3 | W4 | The job-state columns sit on the wide permanent `generations` row: heartbeats can never be HOT updates, `live_ |
| DB-13 | P3 | C39 | P3 | W4 | Schema integrity gaps: the credit ledger and payment orders are CASCADE-deleted with the user, and money colum |
| DB-14 | P3 | C39 | P3 | W4 | The file-card thumbnail cache has no version key: it goes stale after "polish" rewrites the file, and a thumbn |
| SCALE-13 | P3 | C39 | P3 | W4 | Write amplification: every 2-second heartbeat is a non-HOT update of the wide `generations` row, and every reb |
| SCALE-16 | P3 | C39 | P3 | W4 | Housekeeping runs in every worker process every 60 s and two of its purges cannot use an index (`sessions` OR- |
| TEST-02 | P1 | C40 | P2 | W3 | `lib/server/ratelimit.ts` has zero test coverage |
| TEST-03 | P1 | C40 | P2 | W3 | Queue `claimJob` concurrency (`FOR UPDATE SKIP LOCKED`) never exercised concurrently |
| TEST-04 | P1 | C40 | P2 | W3 | Credits `chargeInTx` row-lock never exercised concurrently |
| TEST-06 | P1 | C40 | P2 | W3 | Session lifecycle and OTP brute-force guard have zero direct test coverage |
| TEST-07 | P1 | C40 | P2 | W3 | Periodic purge functions' SQL is untested against a real database (only that they're *called* is tested) |
| TEST-08 | P2 | C40 | P2 | W3 | `/api/health` route has zero test coverage (DB-down behaviour, internal/public split) |
| TEST-09 | P2 | C40 | P2 | W3 | IDOR regression coverage missing for several asset getters (pattern correct today, unguarded against regressio |
| TEST-10 | P2 | C40 | P2 | W3 | `enqueueGeneration`'s atomicity is only tested on the success path |
| BEA-19 | P3 | C41 | P3 | W4 | Resume photos are purged after 90 days while form drafts keep pointing at them; the paid resume is then silent |
| FE-20 | P3 | C41 | P3 | W4 | A resume photo in a restored draft silently turns into a broken image after 90 days, and the paid resume is ge |
| ABUSE-02 | P2 | — | P2 | W3 | Signup bonus (3 000 points) × unlimited Telegram accounts = free paid-document farming; no fraud/device/phone  |
| DEPS-02 | P2 | — | P2 | W3 | `ipHash()` in game-sessions.ts bypasses the validated env accessor and falls back to a hardcoded, guessable sa |
| DEPS-03 | P2 | — | P2 | W3 | `sharp@0.34.5`: 2 high-severity libvips/libheif CVEs; one real (narrow) runtime call path |
| FE-07 | P2 | — | P2 | W3 | A double-click defeats the two-step «Rostdan?» confirmation: an accidental double-click permanently deletes a  |
| INFRA-07 | P2 | — | P2 | W3 | No rolling/blue-green deploy: `docker compose up -d` stops the only `web` container before the replacement is  |
| OBS-07 | P2 | — | P2 | W3 | `cost_json` telemetry today covers only the article engine, not the whole product; the one script that aggrega |
| OBS-13 | P2 | — | P2 | W3 | No aggregate business metrics beyond the (narrow, manual) cost report: refund rate, payment success/fail rate  |
| ABUSE-07 | P3 | — | P3 | W4 | `deleteGeneration` on a COMPLETED job never refunds, but the file is downloadable before deletion (no output+r |
| BEA-12 | P3 | — | P3 | W4 | `DELETE /api/generations/[id]` answers 409 "Ishlayotgan hujjatni o'chirib bo'lmaydi" for unknown, foreign and  |
| BEA-13 | P3 | — | P3 | W4 | Malformed-but-plausible inputs escape as 500 instead of 4xx (JSON `null` bodies, int overflow in `?since=`, no |
| BEA-14 | P3 | — | P3 | W4 | Server runs in UTC with no timezone handling: CSV result dates are UTC ISO strings, "per day" limits reset at  |
| BEA-17 | P3 | — | P3 | W4 | Telegram webhook is at-most-once: the update id is recorded before handling and every failure (DB error, Bot A |
| BEB-07 | P3 | — | P3 | W4 | Live progress resets backwards when a job is reclaimed and restarted |
| CONC-16 | P3 | — | P3 | W4 | First-login race in `upsertTelegramUser`: `SELECT … FOR UPDATE` on a not-yet-existing row locks nothing, so tw |
| DEPS-04 | P3 | — | P3 | W4 | `npm audit` flags 1 critical + 3 more high findings; all confirmed NOT reachable in this deployment (patch any |
| DEPS-07 | P3 | — | P3 | W4 | License review: one LGPL-3.0 direct dependency, low practical risk (short, per brief scope) |
| EXT-11 | P3 | — | P3 | W4 | `cost_json` misses the most expensive paths (images, grounding, slides, translation, resume, all request-path  |
| EXT-14 | P3 | — | P3 | W4 | Telegram webhook secret is the same `CRON_SECRET` used as the `/api/health` bearer; that secret is equivalent  |
| EXT-15 | P3 | — | P3 | W4 | Outbound URL hardening: provider-supplied URLs fetched without host checks; redirects not re-validated; unboun |
| FE-11 | P3 | — | P3 | W4 | First-load JS for `/uz/[slug]` (499 KB gz, which Next reports as "513 kB") ships every composer, the 583 KB pr |
| FE-13 | P3 | — | P3 | W4 | Re-render storms: the live slide viewer re-plans every thumbnail on each animation frame; the home list re-pla |
| FE-15 | P3 | — | P3 | W4 | Long synchronous edit calls (polish ≤120 s, rewrite, template upload) outlive proxy timeouts; after a 504 the  |
| FE-17 | P3 | — | P3 | W4 | Form drafts silently stop saving once they exceed 200 KB (an attached source file is enough), and the "flush o |
| SCALE-15 | P3 | — | P3 | W4 | Static JS/CSS for first-time visitors is served and gzip-compressed on the fly by the same Node process |
| SECA-04 | P3 | — | P3 | W4 | `DELETE /api/auth/session` (single-session logout) skips `checkOrigin` → logout CSRF under `SameSite=None` |
| SECA-05 | P3 | — | P3 | W4 | Bot-initiated magic link enables login-CSRF (session fixation into the attacker's account) |
| UX-10 | P3 | — | P3 | W4 | Two icon-only header buttons have English aria-labels in an otherwise fully Uzbek app |
