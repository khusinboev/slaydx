# W4-A review: job deadline in every engine (EXT-03), job cost telemetry (EXT-11), safeFetch (EXT-15), essay wordTarget price, Tashkent year

Reviewer: independent, read-only. Branch `worktree-agent-a4233613d6f5c9d17` (`3bdfd03..b63c57b`, merge-base `b4a9ff1`) vs `audit/production-readiness` (`da3c2f5`).

## Verdict: **CHANGES REQUESTED** (1 required change)

The runtime logic is sound:
- The deadline is threaded correctly, and `DeadlineError` ends as FAILED + refund.
- Telemetry cannot touch money or fail a job.
- safeFetch closes the redirect-follow SSRF.

**But the branch breaks `next build`.** Two client components now pull Node-only modules into the browser bundle (R1).

## Required changes

**R1. `next build` fails: Node built-ins are reachable from client components.**

The build fails with:

```
./lib/generation/job-cost.ts  [app-client] … does not support external modules (request: node:async_hooks)
./lib/generation/safe-fetch.ts [app-client] … does not support external modules (request: node:dns/promises)
./lib/generation/slide-images.ts [app-client] <locals> … (request: node:async_hooks)
Turbopack build failed with 3 errors
```

I reproduced this with `next build --turbopack` on a scratch merge of the branch into the base (real `node_modules` copy, heavy2 4G). The scratch tree has been removed.

The import chains are:
- `components/forms/ImageStudio.tsx` (imports `IMAGE_RATIOS`, `IMAGE_STYLES`) → `lib/generation/image-studio.ts` → `slide-images.ts` → `safe-fetch.ts` (`node:dns/promises`, `node:net`)
- `components/viewers/ImageViewer.tsx` (imports `imageRatioById`, `imageStyleById`) → `image-studio.ts` → `image-provider-gemini.ts` → `job-cost.ts` (`node:async_hooks`)

Before this branch, the client graph reached **no** `node:` imports. I checked with a transitive import scan of all 103 `"use client"` files. These three imports are the only ones in the client graph, and all three are new.

Fix:
- Move the style/ratio catalogue (`IMAGE_STYLES`, `IMAGE_RATIOS`, `imageStyleById`, `imageRatioById` and their types) into a client-safe module, for example `lib/generation/image-studio-options.ts`. It must not import anything server-only.
- Import that module from both client components, and re-export it from `image-studio.ts`.
- Add a cheap guard test so this can't regress silently: a source scan from every `"use client"` file must never reach `node:*`, `lib/generation/safe-fetch.ts` or `lib/generation/job-cost.ts`.
- Re-run `npm run build`.

## 1. Behaviour with no deadline pressure

- **Prompts and outputs:** the diff changes no prompt text. Every change only adds `deadline` to the options, or adds `assertJobTime` (a no-op when `deadline` is undefined or more than 6–8 s away).
- **Legacy `llm.ts withRetry`:** with no deadline, `jobLeft()` is `+Infinity`, so `slot` is unchanged and nothing is thrown. The only additions are the `usage` capture and `recordLlmUsage`.
- **Units:** the deadline is epoch ms (`worker.execute`: `Date.now() + jobDeadlineMs(job)`). Every consumer computes `deadline - Date.now()` in ms (`assertJobTime`, `withRetry.jobLeft`, `chain.leftMs`). I found no mixing of seconds with ms, and no relative-vs-epoch mix-up. `JOB_MIN_CALL_MS` is 6 s and slide-write uses 8 s, so a practically generous deadline cannot misfire.
- **Stage budget vs job deadline:** these are kept separate everywhere I checked. A stage running out stays soft (slide-write `jobDeadline`, teacher `writeDeadline`, infographic/audio `textDeadline`/`writeDeadline`); only job exhaustion throws. Essay, work and article pass the real job deadline.
- **Graceful steps still degrade:**
  - Judges are inside `try/catch` or `.catch(() => null)`.
  - Polish rewrites go through `.catch(() => null)` or `polish-core applyPolishWith` (catch → `failed`).
  - Crossword maps `DeadlineError` to `RewriteError("Vaqt yetmadi")`.
  - Resume catches `DeadlineError` and falls back to the full `draftModel`.
  - The translation glossary pass swallows errors; batches mark items `missing` with the `vaqt tugadi` detail, and the partial-delivery rule still applies.
  - Research calls still get no deadline.
- **Failure path:** the engine throws `DeadlineError` → `buildArtifact` → `withJobCost` (which does not catch) → `execute` catch → `userMessage` maps `DeadlineError` to `TIMEOUT_JOB_ERROR` (`lib/server/user-error.ts:92`) → `failAndCleanup` → `failJob`, then `refund`, then the file and assets are deleted. So the job is FAILED and refunded, never COMPLETED with a partial doc. The teacher `buildTestDoc` wrapper now re-throws `DeadlineError` instead of turning it into "module missing".
- **One real behaviour change (see N1):** now that engines pass `deadline`, the W3-B chain rule `if (opts.deadline === undefined) return null; continue;` makes a spec **timeout** fall through to the next spec. For single-spec roles (`LLM_WRITER=gemini:…`) nothing changes. For `LLM_JUDGE=anthropic:…,gemini:…` (the `.env.example` default), an Anthropic timeout now triggers a second, paid judge call with the **same** `timeoutMs`, not reduced by the time already spent. That can double the review stage and eat the polish reserve, so polish is skipped. It only happens when a provider times out, but it is an extra LLM call.

## 2. Legacy writers gap (`write-llm.ts` / `write-specials.ts`)

- **When they run:**
  - `WORK_ENGINE=0` / `TEACHER_ENGINE=0` are emergency switches only. Neither appears in `docker-compose.yml` or `.env.example`.
  - **But** lesson-plan, texnologik-xarita, glossary and keys fall through to `write-specials.ts` in prod whenever `buildTeacherDoc` returns `null` for a non-time reason: the model returned junk, or the quality gate failed. So this is a live fallback path.
- **Why it's contained:** the teacher engine now calls `assertJobTime` after `!built`, so this fallback is entered only with at least 6 s of job time left. The worker hard stop (deadline + 30 s) and `delivered`-based refunds remain as backstops.
- **Remaining hole (pre-existing):** `write-specials` uses `remainingMs(deadline) || 55_000` (also `|| 60_000` and `|| 70_000`). An exhausted deadline therefore buys a fresh 55–70 s call. A short glossary or keys set can then complete within the 30 s grace. Legacy docs also have no teacher gate.
- **Severity:** Low–Medium. It is not blocking for this package, and should be a follow-up:
  - pass `deadline` into `llmComplete` in `write-specials.ts`/`write-llm.ts` (`llm.ts` now honours it);
  - replace `|| 55_000` with `assertJobTime`.

## 3. safeFetch

| Check | Result |
|---|---|
| DNS TOCTOU / IP pinning | **Not pinned.** `fetch` re-resolves the name itself; the header comment documents this as accepted. Every caller's URL comes from a provider: stock CDN, Aisha, a grounding URI with an exact-host check, and `lex.uz` (built from `LEX_DOC_BASE`). The slide editor only accepts `/api/generations/<id>/assets/…` URLs (`slide-edit.ts:844`), so users cannot inject URLs into `render-pptx`. Acceptable for now → N2. |
| Decimal, octal and hex IPv4, `127.1`, `0.0.0.0`, `169.254.169.254.`, `localhost`/`LOCALHOST` | Rejected. WHATWG `URL` canonicalises the host before the check. I probed each case. |
| IPv4-mapped `::ffff:a.b.c.d` / hex-mapped | Rejected. |
| IPv4-compatible `[::127.0.0.1]` → `::7f00:1`, NAT64 `64:ff9b::a00:1`, uncompressed `0:0:0:0:0:ffff:7f00:1`, `fec0::/10` | **Classified public** (see N3). This is not practically exploitable here: Docker has no IPv6 and no NAT64, WHATWG compresses literals, and `dns.lookup` returns compressed or dotted forms. |
| Every redirect hop re-checked | Yes. `redirect: "manual"`, and each `Location` goes back through `assertPublicHttpsUrl`. At most 3 hops. HTTPS → HTTP is rejected. The grounding HEAD uses `maxRedirects: 0` (only reads `Location`). |
| Size cap while streaming | Yes. `readCapped` checks the declared `content-length` early, then cancels the reader when the running total exceeds the cap. `lex.uz` is capped at 2 MB in `getText`; an oversize body gives `{ok:false}`. |
| Timeout covers body | Yes. One signal is passed to `fetch`, and undici aborts the body stream. **The DNS `lookup` is not covered** → N4. |
| Stock CDNs still work | Yes. Pexels, Pixabay and Gemini `data:` URLs pass; the https + public-IP rule is the only restriction. |
| Aisha still works | Relative paths join to `https://back.aisha.group` and work. **An absolute `http://` link is now rejected** as non-retryable, although `aishaAudioRef` still accepts `http`. See N5. |

## 4. Cost telemetry

- **No effect on money:** no price or credit path reads `cost_json`. It is only written by `setCost(...).catch(log)` in the worker.
- **Cannot fail a job:** the recorders are pure arithmetic on an `AsyncLocalStorage` store. `costUsd` returns 0 and warns on an unknown model, and `imageUnitUsd` falls back the same way. Nothing can realistically throw.
- **No double counting:** the chain path records in `complete()`, the legacy path in `withRetry`, and they are disjoint. Grounding adds its tokens plus one unit. TTS records once per paid chunk in `runGroup`. The engine `CostMeter` is replaced, not added to.
- **Unit prices are plausible:**
  - image: lite $0.034, flash $0.067 (matches `.env.example`);
  - grounding: $0.014;
  - thinking tokens are billed as output for Gemini. Anthropic and OpenAI already include them in their output counts.
- Nits: see N6.

## 5. Tashkent year

`tashkentYear` is `UTC ms + 5 h` → `getUTCFullYear()`. On Dec 31, 18:59:59 UTC gives the old year and 19:00 UTC gives the new one, which is correct because Uzbekistan has no DST. `extractMeta` freezes the year, and the title model and web cover read `meta.year`, so the file and the screen agree. Tests cover the boundary. Nit N7.

## 6. Tests

All runs were hermetic: `--import ./tests/helpers/hermetic-env.mts`, `GEMINI_API_KEY` unset, no `.env.local`, one file or one set at a time via `heavy2.sh -m 3G`.

- **Branch worktree, the requested set** (safe-fetch, llm-legacy-deadline, engine-deadline-cost, tashkent-year, work-wiring, game-wiring): **65/65 pass**.
- **Branch worktree, other suites:** slide-images 18, image-providers-free 26, tts-aisha 10, slide-research 31, translate-engine 16, all pass.
- **essay-params fails on the branch alone** (2 failures). This is expected, because it needs W4-E `1c4213f`, which is already on the base.
- **Scratch merge into the base:** `git merge-tree` reports **two** test-only conflicts:
  - `tests/essay-params.test.mts`, which the commit message anticipates;
  - `tests/game-wiring.test.mts`, which it does **not** mention.
  - Take the branch side for both. Its `{0,200}` regex is a superset of the base's `{0,160}`.
- **Merged tree results, all pass:**
  - essay-params 4, game-wiring 15;
  - work-engine 28, article-engine 20, essay-engine 11;
  - slide-live 9, slide-progress 12;
  - generation 65, image-studio 9, teacher-engine 26, resume-write 25;
  - audio-engine 15, infographic-engine 19, cost-meter 8;
  - worker-user-error 3, worker-resilience 8, document 62.
- **The build fails** (R1).

## Nits (non-blocking)

- **N1:** Multi-spec roles with a deadline fall through to the next spec after a timeout, which means an extra paid call and up to 2× the stage time (§1). Either cap the fallback spec's `timeoutMs` by the time already spent, or document it as intended for the judge role.
- **N2:** Pin the resolved IP: an undici `Agent({ connect: { lookup } })` that returns the already-validated address. This closes DNS rebinding cheaply and removes the double lookup.
- **N3:** Replace the hand-rolled `privateV6` with `net.BlockList`, or a normalising parser. Also treat `::/96` (IPv4-compatible) and `64:ff9b::/96` by their embedded IPv4, and `fec0::/10` as private.
- **N4:** `assertPublicHttpsUrl` awaits `lookup` outside the abort signal. A slow resolver can push the grounding step past its "3 s total" budget, and image fetches past 20 s. Race the lookup against the signal.
- **N5:** Aisha: for the exact host `back.aisha.group`, upgrade `http://` to `https://` before `safeFetchUrl`, since Django behind TLS termination often emits `http://` media URLs. Otherwise the Aisha provider silently always falls through once the keys go live. Or make `aishaAudioRef` https-only so the contract is explicit.
- **N6:** Cost telemetry details:
  - Grounding is billed per search **query** on Gemini 3 (after the free tier), so count `max(1, queries.length)` instead of 1 per request.
  - Cost is only persisted for COMPLETED jobs; FAILED jobs' spend is lost, which will matter for the admin-panel margin.
  - The legacy `recordLlmUsage` uses `llmModel()` rather than the model actually called (the same value today).
- **N7:** `getFullYear()` remains in the freshness windows in `article/review.ts` and `work/review.ts`, in the `research/pipeline.ts` fallback, and in `resume/input.ts`. These are harmless, but could use `tashkentYear()` for consistency.
- **N8:** Follow up on the legacy writer deadline gap from §2.

## Re-review (head `c000b08`, base merged as `3288c03`)

### Verdict: **APPROVE**

**R1: fixed.**
- **The split:** `lib/generation/image-studio-options.ts` holds the style/ratio catalogue and imports nothing. `ImageStudio.tsx` and `ImageViewer.tsx` now import it. `image-studio.ts` re-exports it, so server callers are unchanged.
- **Production build:** `next build --turbopack` exits 0 at `c000b08`. I ran it on a scratch worktree with a real `node_modules` copy, via heavy2 with 4G; the scratch tree has been removed. The only remaining output is the existing Edge-runtime warning about `process.exit` in `instrumentation.ts`, which is not related to this branch.

**The guard test catches the regression.** I mutated a scratch copy of `tests/client-bundle-guard.test.mts`'s targets:

| Mutation | Result |
|---|---|
| M1: `ImageViewer.tsx` imports `@/lib/generation/image-studio` again | **Fails.** Reports both chains, to `safe-fetch` and to `job-cost`. |
| M2: `image-studio-options.ts` imports `./slide-images` (transitive) | **Fails.** Reports a 3–5 hop chain. |
| M4: a client component does a dynamic `import("@/lib/generation/llm-roles")` | **Fails.** Reports `llm-roles → job-cost`. |
| M3: a client component has an `import type { JobCost }` | Passes. There is no false positive on type-only imports. |

**Nits:**
- **Done:**
  - N3: IPv4-compatible `::/96`, NAT64 `64:ff9b::/96`, uncompressed mapped addresses and `fec0::/10` are now private.
  - N4: the DNS lookup is raced against the shared timeout signal on every hop.
  - N5: an `http://` link on Aisha's own host is upgraded to `https://`; other hosts are unchanged and still rejected.
  - N6: grounding is recorded as `max(1, queries.length)` units.
- **Not done, accepted:**
  - N2: the rationale is documented in `safe-fetch.ts`. Node 22's built-in `fetch` bundles undici 6, and a dispatcher from `node_modules` undici 8 doesn't work with it. Every URL still comes from a provider.
  - N1, N7 and N8 stay open as follow-ups.
- **Test fix:** `c000b08` gives the work-wiring teacher probe a 300 s deadline so it clears the review and polish reserves. This is test-only.

**Tests.** All runs were hermetic: `hermetic-env` loaded, no `.env.local`, `GEMINI_API_KEY` unset, via `heavy2.sh`.

| Run | Pass |
|---|---|
| Combined run: client-bundle-guard, safe-fetch, llm-legacy-deadline, engine-deadline-cost, tashkent-year, work-wiring, game-wiring, essay-params, tts-aisha | **84/84** |
| image-studio | 9 |
| slide-research | 31 |
| image-providers-free | 26 |
| slide-images | 18 |
| work-engine | 28 |
| article-engine | 20 |
| teacher-engine | 26 |
| translate-engine | 16 |
| generation | 65 |
| document | 62 |
| ui/image-studio (viewer tsconfig) | 8 |

All passed.

**Merge.** Both conflicts from my first review are resolved. `essay-params` keeps the `price` impact with no exemption list and passes (4/4). `game-wiring` uses the W4-A `{0,200}` regex and passes.
