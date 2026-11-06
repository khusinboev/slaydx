import test from "node:test";
import assert from "node:assert/strict";
import { createIsolatedDb } from "./helpers/isolated-db.mts";

/**
 * Incident 2026-11-05 (fix/provider-ops): a Kling key was sold and refused on every job, an ElevenLabs key
 * lacked permissions nobody saw, users were invited to retry through an outage, and the owner learned of it from users.
 *
 * MUTATIONS (each turned this file red, see the branch report):
 *   M1  `keyUsable` returns Boolean(key)                                 -> "keyUsable", "a malformed key is not sold"
 *   M2  `modelAvailable` back to Boolean(getProviderKey)                 -> "a malformed key is not sold"
 *   M3  `videoProvidersAvailable` ignores the format                     -> "a malformed key is not sold"
 *   M4  `isOutageFailure` counts timeouts                                -> "isOutageFailure"
 *   M5  `isOutageFailure` counts every 400                               -> "isOutageFailure"
 *   M6  `llmOutage` uses `some` instead of `every`                       -> "errorWithCause: one healthy answer"
 *   M7  `llmOutage` without the job-context check                        -> "errorWithCause: outside a job"
 *   M8  `reportFailure` keeps the FIRST failure per provider             -> "errorWithCause: the latest failure"
 *   M9  `providerFailureOf` does not stop at a safety refusal            -> "providerFailureOf"
 *   M10 `scrubFailureText` does not remove the key                       -> "recordProviderFailure"
 *   M11 `scrubFailureText` does not clip to 120                          -> "recordProviderFailure"
 *   M12 alert threshold `>` instead of `>=`                              -> "alert: fires at five"
 *   M13 alert counts all errors of a provider together                   -> "alert: different errors"
 *   M14 `noReminders` dropped                                            -> "alert: one message per incident"
 *   M15 an empty window counts as recovered without evidence             -> "alert: one message per incident"
 *   M16 `refusedPermissions` ignores `updated_at`                        -> "refusedPermissions"
 *   M17 the probe reports any 401, not only `missing_permissions`        -> "probe"
 *   M18 a missing-permission 401 made retryable in `elevenLabsRetryable` -> "a missing permission fails fast"
 *   M19 the alert query ignores the ten-minute window                    -> "alert: the window is ten minutes"
 *   R1  `reportSuccess` does not drop the provider's entry               -> "reportSuccess: the provider's entry"
 *   R2  `reportSuccess` does not mark the slot answered                  -> "a stale 429"
 *   R3  `llmOutage` without `isOutageFailure(last)`: EQUIVALENT, survives. `runningFailure` is defined only with no answer
 *       after `last`, so `last` is in `byProvider` and `every` already covers it; the check is kept as the stated rule.
 *   R4  `runningFailure` without the 60 s bound                          -> "a failure over a minute old"
 *   R5  `llmFailure` attached without the running check                  -> "a stale 429"
 *   R6  no `reportSuccess` in `chain.ts`                                 -> "chain: an answer"
 *   R7  no `reportSuccess` in `walkTextChain`                            -> "direct path: Gemini answered"
 *   R8  `ai_usage` evidence ignored                                      -> "recovery needs evidence"
 *   R9  `media_jobs` evidence ignored                                    -> "recovery needs evidence"
 *   R10 `video_ops` evidence ignored                                     -> "recovery needs evidence"
 *   R11 another provider's completed job accepted as evidence            -> "recovery needs evidence"
 *   R12 no quiet path                                                    -> "alert: one message per incident"
 *   R13 the provider cooldown kept after a recovery                      -> "a spike after a recovery"
 *   R14 `refusedPermissions` without the 30-day bound                    -> "refusedPermissions"
 *   R15 the record before `failAndCleanup`, unguarded by the lease       -> worker-user-error
 *   R16 ACCOUNT_400_RE matches any mention of an API key                 -> "isOutageFailure"
 *   R17 `sample = max(message)`                                          -> "alert: fires at five"
 * Same change, caught by the neighbouring files:
 *   M20 the admin save skips the format check                            -> provider-keys-admin
 *   M21 the card's `usable` ignores `keyMalformed`                       -> provider-keys-admin
 *   M22 the worker does not record the failure                           -> worker-user-error
 *   M23 `errorWithCause` never answers with the outage message           -> worker-user-error
 *   M24 `failVideo` records nothing                                      -> video-flow
 *   M25 a deadline counted as a provider failure                         -> video-flow
 *   M26 a safety refusal from the poll counted                           -> video-flow
 *   M27 the video submit drops `cause`                                   -> video-flow
 *   M28 the transcribe engine drops `cause`                              -> studio-transcribe
 *   M29 the dub engine drops `cause`                                     -> studio-transcribe
 *   M30 `keyState` ignores `keyMalformed`                                -> ui/admin-providers-keys
 *   M31 `providerStatus` ignores `refusedPermissions`                    -> ui/admin-providers-keys
 */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
process.env.WORKER_INLINE = "false";
delete process.env.FAL_KEY;
delete process.env.KLING_API_KEY;

const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
const iso = hasDb ? await createIsolatedDb("providerops") : { isolated: false, drop: async () => {} };
const skip = hasDb && iso.isolated ? false : "alohida Postgres baza yo'q";

const { keyFormatProblem, keyUsable } = await import("../lib/server/providers/registry.ts");
const { makeKlingAdapter } = await import("../lib/generation/video/kling.ts");
const { modelAvailable } = await import("../lib/server/media/availability.ts");
const { MEDIA_CATALOG } = await import("../lib/media/catalog.ts");
const { videoProvidersAvailable } = await import("../lib/server/env.ts");
const F = await import("../lib/generation/llm/failure.ts");
const { withJobCost } = await import("../lib/generation/job-cost.ts");
const { AI_OUTAGE_ERROR, UserFacingError, isUserSafeText, userMessage } = await import("../lib/server/user-error.ts");
const P = await import("../lib/server/provider-failures.ts");
const { missingPermissionOf } = await import("../lib/generation/tts/elevenlabs.ts");
const { MediaError } = await import("../lib/studio-core/index.ts");
const { submitWithRoutes } = await import("../lib/studio-core/router.ts");
const { TRANSCRIBE_MODEL } = await import("../lib/media/catalog-transcribe.ts");
const { transcribeAdapters } = await import("../lib/media/adapters/transcribe-studio.ts");
const { ELEVENLABS_PERMISSION_PROBES, probeProvider } = await import("../lib/server/providers/probe.ts");
const A = await import("../lib/server/server-alerts.ts");

const BAD_KLING = "AKtestvalue:SKtestvalue";
const GOOD_KLING = "oneKlingApiKey1234567";
const BAD_FAL = "noColonFalKey1234567";
const GOOD_FAL = "id-value:secret-value";
const MISSING = (name: string) => `401 Unauthorized: {"detail":{"status":"missing_permissions","message":"The API key you used is missing the permission ${name} to execute this operation."}}`;

// ───────────────────────────── item 1: key format

test("keyUsable: fal needs both halves, Kling one token, the rest any non-empty key; it agrees with the worker's adapter", () => {
  assert.equal(keyUsable("fal", GOOD_FAL), true);
  for (const bad of ["", BAD_FAL, ":secretvalue", "accessvalue:"]) assert.equal(keyUsable("fal", bad), false, bad);
  assert.equal(keyUsable("kling", GOOD_KLING), true);
  assert.equal(keyUsable("kling", ` ${GOOD_KLING}\n`), true, "surrounding space is trimmed before use");
  for (const bad of ["", "   ", BAD_KLING, "two tokens"]) assert.equal(keyUsable("kling", bad), false, bad);
  assert.equal(keyUsable("gemini", "AIzaWithoutAColon"), true);
  assert.equal(keyUsable("gemini", ""), false);
  for (const k of [GOOD_KLING, BAD_KLING, "two tokens"]) assert.equal(keyUsable("kling", k), makeKlingAdapter({ key: () => k }).configured(), k);
});

test("keyFormatProblem: Uzbek, names the format, never echoes the key", () => {
  const text = keyFormatProblem("kling", BAD_KLING)!;
  assert.match(text, /Kalit formati noto‘g‘ri/);
  assert.match(text, /bitta API kalit/);
  assert.ok(!text.includes(BAD_KLING));
  assert.equal(keyFormatProblem("kling", GOOD_KLING), null);
  assert.equal(keyFormatProblem("gemini", "anything-goes"), null);
});

test("a malformed key is not sold: the model is not available and the old video picker hides the provider", (t) => {
  t.after(() => void delete process.env.KLING_API_KEY);
  const entry = MEDIA_CATALOG.entries.find((e) => e.routes.length === 1 && e.routes[0]!.provider === "kling");
  assert.ok(entry, "the catalog has a Kling-only model");
  const none = new Map();
  process.env.KLING_API_KEY = BAD_KLING;
  assert.equal(modelAvailable(entry.id, none), false, "malformed key: not listed, 400 before the charge");
  assert.ok(!videoProvidersAvailable().includes("kling"));
  process.env.KLING_API_KEY = GOOD_KLING;
  assert.equal(modelAvailable(entry.id, none), true);
  assert.ok(videoProvidersAvailable().includes("kling"));
});

// ───────────────────────────── item 3: outage verdict

const attempt = (provider: string, over: Partial<Parameters<typeof F.reportFailure>[0]>) =>
  F.reportFailure({ role: "writer", provider, model: "m", attempt: 1, durationMs: 1, kind: "http", retryable: false, message: "boom", ...over });

test("isOutageFailure: account, quota, 5xx, network and an open breaker; not one request's own problem", () => {
  const yes = [
    { kind: "http", status: 401, message: "x" }, { kind: "http", status: 402, message: "x" }, { kind: "http", status: 403, message: "suspended" }, { kind: "http", status: 429, message: "quota" },
    { kind: "http", status: 503, message: "x" }, { kind: "network", message: "fetch failed" }, { kind: "other", message: "circuit breaker open - call skipped" },
    { kind: "http", status: 400, message: "Your credit balance is too low" }, { kind: "http", status: 400, message: "API key not valid" }, { kind: "http", status: 400, message: "API key expired. Please renew" }, { kind: "http", status: 400, message: "Invalid API key" },
  ] as const;
  const no = [
    { kind: "timeout", message: "timed out" }, { kind: "http", status: 400, message: "prompt is too long" }, { kind: "http", status: 404, message: "no model" },
    { kind: "http", status: 400, message: "the api_key field must be a string" },
    { kind: "bad_json", message: "x" }, { kind: "empty", message: "x" }, { kind: "safety", message: "x" }, { kind: "truncated", message: "x" }, { kind: "other", message: "x" },
  ] as const;
  for (const f of yes) assert.equal(F.isOutageFailure(f as never), true, JSON.stringify(f));
  for (const f of no) assert.equal(F.isOutageFailure(f as never), false, JSON.stringify(f));
});

test("errorWithCause: every provider down gives the outage message, safe for the user and with no invitation to retry at once", async () => {
  await withJobCost(async () => {
    attempt("gemini", { status: 403, message: "consumer suspended" });
    attempt("anthropic", { status: 400, message: "Your credit balance is too low" });
    const e = F.errorWithCause("Taqdimot matni yozilmadi. Pul balansingizga qaytariladi — qayta urinib ko‘ring.");
    assert.ok(e instanceof UserFacingError);
    assert.equal(e.message, AI_OUTAGE_ERROR);
    assert.match(String((e.cause as Error).message), /kind=http status=400/);
    assert.equal(((e.cause as { llmFailure: { provider: string } }).llmFailure).provider, "anthropic");
  });
  assert.equal(isUserSafeText(AI_OUTAGE_ERROR), true, "`failAndCleanup` filters the text a second time");
  assert.equal(userMessage(AI_OUTAGE_ERROR), AI_OUTAGE_ERROR);
  assert.match(AI_OUTAGE_ERROR, /vaqtincha/);
  assert.match(AI_OUTAGE_ERROR, /qaytariladi/);
  assert.ok(!/qayta urin/.test(AI_OUTAGE_ERROR));
});

test("errorWithCause: one healthy answer keeps the engine's message", async () => {
  const MSG = "Matn yozilmadi — AI javob bermadi. Pul balansingizga qaytariladi, qayta urinib ko‘ring.";
  await withJobCost(async () => {
    attempt("gemini", { status: 403 });
    attempt("anthropic", { kind: "bad_json", status: undefined });
    const e = F.errorWithCause(MSG);
    assert.equal(e.message, MSG);
    assert.ok(!(e instanceof UserFacingError));
    assert.equal(((e.cause as { llmFailure: { provider: string } }).llmFailure).provider, "anthropic", "the alert still gets the structured failure");
  });
  await withJobCost(async () => {
    attempt("anthropic", { kind: "bad_json", status: undefined });
    attempt("gemini", { status: 403 });
    assert.equal(F.errorWithCause(MSG).message, MSG, "the outage came last, but another provider failed for its own reason");
  });
});

test("errorWithCause: the latest failure of a provider decides", async () => {
  await withJobCost(async () => {
    attempt("gemini", { status: 503 });
    attempt("gemini", { kind: "empty", status: undefined });
    assert.equal(F.errorWithCause("Matn yozilmadi.").message, "Matn yozilmadi.");
  });
  await withJobCost(async () => {
    attempt("gemini", { kind: "empty", status: undefined });
    attempt("gemini", { status: 503 });
    assert.equal(F.errorWithCause("Matn yozilmadi.").message, AI_OUTAGE_ERROR);
  });
});

test("errorWithCause: the last failure of the run must be an outage itself", async () => {
  await withJobCost(async () => {
    attempt("gemini", { status: 503 });
    attempt("anthropic", { status: 503 });
    F.reportSuccess("anthropic");
    attempt("gemini", { status: 503 });
    assert.equal(F.errorWithCause("Matn yozilmadi.").message, AI_OUTAGE_ERROR, "the provider that answered is out of the verdict");
    F.reportSuccess("gemini");
    attempt("anthropic", { status: 400, message: "prompt is too long" });
    attempt("gemini", { kind: "bad_json", status: undefined });
    assert.equal(F.errorWithCause("Matn yozilmadi.").message, "Matn yozilmadi.");
  });
});

test("reportSuccess: the provider's entry goes, so its old outage cannot speak for it", async () => {
  await withJobCost(async () => {
    attempt("gemini", { kind: "bad_json", status: undefined });
    F.reportSuccess("gemini");
    attempt("anthropic", { status: 503 });
    assert.equal(F.errorWithCause("Matn yozilmadi.").message, AI_OUTAGE_ERROR, "gemini's bad answer was followed by a good one, the chain now fails on 503");
  });
});

test("a stale 429: the fallback wrote the rest, a later failure is the engine's own, and no provider row is due", async () => {
  await withJobCost(async () => {
    attempt("gemini", { status: 429, message: "quota" });
    F.reportSuccess("qwen");
    const e = F.errorWithCause("Tarjima to‘liq chiqmadi. Pul balansingizga qaytariladi — qayta urinib ko‘ring.");
    assert.equal(e.message, "Tarjima to‘liq chiqmadi. Pul balansingizga qaytariladi — qayta urinib ko‘ring.");
    assert.ok(!(e instanceof UserFacingError));
    assert.match(String((e.cause as Error).message), /status=429/, "the log keeps the history");
    assert.equal(P.providerFailureOf(e), null, "a false `gemini|429` row would feed a false alert");
  });
});

test("a failure over a minute old is not this run's: no outage, no provider row", async (t) => {
  await withJobCost(async () => {
    attempt("gemini", { status: 429 });
    const later = Date.now() + F.OUTAGE_RECENCY_MS;
    t.mock.method(Date, "now", () => later);
    const e = F.errorWithCause("Matn yozilmadi.");
    assert.equal(e.message, "Matn yozilmadi.");
    assert.equal(P.providerFailureOf(e), null);
    t.mock.restoreAll();
  });
});

test("chain: an answer clears the provider, so a later refusal of the other one is not «all down»", async () => {
  const { completeWithChain } = await import("../lib/generation/llm/chain.ts");
  const { resetProviderCache } = await import("../lib/server/providers/resolve.ts");
  process.env.GEMINI_API_KEY = "AIzaTestKeyForChain";
  resetProviderCache();
  const breaker = { allow: () => true, success: () => undefined, failure: () => undefined, trip: () => undefined, strike: () => undefined } as never;
  const limiter = { active: 0, max: 9, acquire: async () => () => undefined } as never;
  await withJobCost(async () => {
    attempt("gemini", { status: 429 });
    const usage = { inputTokens: 1, outputTokens: 1 };
    const adapters = { gemini: { complete: async () => ({ ok: true, text: "javob", usage }) } } as never;
    const r = await completeWithChain("writer", [{ provider: "gemini", model: "m" }], "s", "u", { maxTokens: 9, timeoutMs: 9_000 }, { adapters, breakerFor: () => breaker, limiterFor: () => limiter });
    assert.equal(r?.text, "javob");
    assert.equal(F.errorWithCause("Matn yozilmadi.").message, "Matn yozilmadi.");
  });
  delete process.env.GEMINI_API_KEY;
});

test("direct path: Gemini answered, so its earlier failure is over; the real fallback walk is not an outage either", async (t) => {
  const { llmComplete } = await import("../lib/generation/llm.ts");
  const { resetBreakers } = await import("../lib/generation/llm/breaker.ts");
  const realFetch = globalThis.fetch;
  process.env.GEMINI_API_KEY = "test-gemini-key";
  process.env.DASHSCOPE_API_KEY = "test-qwen-key";
  t.after(() => {
    globalThis.fetch = realFetch;
    delete process.env.GEMINI_API_KEY;
    delete process.env.DASHSCOPE_API_KEY;
    resetBreakers();
  });
  const geminiOk = () => Response.json({ candidates: [{ content: { parts: [{ text: "Gemini javobi" }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 } });
  const qwenOk = () => Response.json({ choices: [{ message: { content: "Qwen javobi" }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1 } });
  const denied = () => Response.json({ error: { code: 403, message: "Your project has been denied access." } }, { status: 403 });

  resetBreakers();
  globalThis.fetch = (async () => geminiOk()) as typeof fetch;
  await withJobCost(async () => {
    attempt("gemini", { status: 503 });
    assert.equal(await llmComplete("s", "u", 100), "Gemini javobi");
    assert.equal(F.errorWithCause("Matn yozilmadi.").message, "Matn yozilmadi.");
  });

  // Batch 1 of the incident shape: Gemini refuses, the fallback answers, a later failure is the engine's own.
  resetBreakers();
  globalThis.fetch = (async (url: string | URL | Request) => (String(url).includes("generativelanguage") ? denied() : qwenOk())) as typeof fetch;
  await withJobCost(async () => {
    assert.equal(await llmComplete("s", "u", 100), "Qwen javobi");
    const e = F.errorWithCause("Tarjima to‘liq chiqmadi.");
    assert.equal(e.message, "Tarjima to‘liq chiqmadi.");
    assert.equal(P.providerFailureOf(e), null);
  });
});

test("errorWithCause: outside a job nothing is an outage (the process-wide slot holds old failures)", () => {
  F.resetFailureCounters();
  attempt("gemini", { status: 403 });
  assert.equal(F.errorWithCause("Matn yozilmadi.").message, "Matn yozilmadi.");
  F.resetFailureCounters();
  assert.equal(F.errorWithCause("Matn yozilmadi.").cause, undefined);
});

// ───────────────────────────── item 2 + 4: the cause chain

test("providerFailureOf walks to the provider error; a content refusal and an engine error are not provider failures", () => {
  const media = new MediaError("kling", "401 bad token", { status: 401 });
  assert.deepEqual(P.providerFailureOf(new UserFacingError("Video yaratilmadi", { cause: media })), { provider: "kling", status: 401, message: "401 bad token" });
  const llm = Object.assign(new Error("last LLM attempt"), { llmFailure: { provider: "gemini", status: 403, message: "suspended", kind: "http" } });
  assert.deepEqual(P.providerFailureOf(new Error("Matn yozilmadi", { cause: llm })), { provider: "gemini", status: 403, message: "suspended" });
  assert.equal(P.providerFailureOf(new UserFacingError("x", { cause: new MediaError("fal", "nsfw", { safety: true }) })), null);
  assert.equal(P.providerFailureOf(Object.assign(new Error("x"), { llmFailure: { provider: "gemini", message: "blocked", kind: "safety" } })), null);
  assert.equal(P.providerFailureOf(new UserFacingError("Sifat darvozasi")), null);
  assert.equal(P.providerFailureOf(null), null);
  assert.equal(P.providerFailureOf("text"), null);
});

test("missingPermissionOf reads ElevenLabs' refusal and nothing else", () => {
  assert.equal(missingPermissionOf(MISSING("speech_to_text")), "speech_to_text");
  assert.equal(missingPermissionOf(MISSING("dubbing_write")), "dubbing_write");
  assert.equal(missingPermissionOf(`{"detail":{"status":"missing_permissions"}}`), "missing_permissions");
  assert.equal(missingPermissionOf(`401: {"detail":{"status":"invalid_api_key"}}`), null);
});

test("a missing permission fails fast: one call, not retryable, the permission survives to the alert", async () => {
  let calls = 0;
  const fetchImpl = (async () => {
    calls++;
    return new Response(`{"detail":{"status":"missing_permissions","message":"The API key you used is missing the permission speech_to_text to execute this operation."}}`, { status: 401, statusText: "Unauthorized" });
  }) as typeof fetch;
  const adapters = transcribeAdapters({ key: () => "sk_test_permission_key" });
  const healthy = { allow: () => true, success: () => undefined, failure: () => assert.fail("a refusal is not a provider health failure") };
  const input = { params: { source: "result:x" }, assets: { media: [{ mime: "audio/mpeg", base64: "AAAA" }] }, idempotencyKey: "k" };
  const err = await submitWithRoutes(MEDIA_CATALOG.byId(TRANSCRIBE_MODEL)!.routes, adapters, healthy, input as never, { fetchImpl }).then(
    () => assert.fail("must fail"),
    (e: unknown) => e,
  );
  assert.ok(err instanceof MediaError);
  assert.equal(err.retryable, false);
  assert.equal(calls, 1, "no retry, no second route");
  const f = P.providerFailureOf(new UserFacingError("Transkripsiya bajarilmadi", { cause: err }));
  assert.equal(P.failureSignature(f!, P.scrubFailureText(f!.message, "")), "missing_permission:speech_to_text");
});

test("probe: reports only an explicit missing_permissions refusal, with GET reads, and never fails a good key", async () => {
  const KEY = "sk_probe_key_0123456789";
  const run = async (answer: (url: string) => Response) => {
    const seen: { url: string; method?: string }[] = [];
    const r = await probeProvider("elevenlabs", KEY, {
      fetchImpl: (async (url: string, init?: RequestInit) => {
        seen.push({ url, method: init?.method });
        return String(url).endsWith("/user/subscription") ? new Response(JSON.stringify({ tier: "creator" }), { status: 200 }) : answer(String(url));
      }) as typeof fetch,
    });
    return { r, seen };
  };
  const refused = await run((url) => (url === ELEVENLABS_PERMISSION_PROBES[0] ? new Response(MISSING("speech_to_text").slice(17), { status: 401 }) : new Response("{}", { status: 404 })));
  assert.equal(refused.r.ok, true, "the key itself was accepted");
  assert.match(refused.r.message, /ruxsat yetishmaydi: speech_to_text$/);
  assert.ok(refused.seen.every((c) => c.method === "GET"), "nothing billable");
  assert.ok(!refused.r.message.includes(KEY));

  const fine = await run(() => new Response("{}", { status: 404 }));
  assert.ok(!/ruxsat/.test(fine.r.message), fine.r.message);
  const otherRefusal = await run(() => new Response(`{"detail":{"status":"invalid_api_key"}}`, { status: 401 }));
  assert.ok(!/ruxsat/.test(otherRefusal.r.message), "any other 401 proves nothing about a permission");
  const down = await run(() => {
    throw new Error("socket hang up");
  });
  assert.equal(down.r.ok, true);
});

// ───────────────────────────── item 4: the owner alert + item 2 card (database)

test("the database half", { skip }, async (t) => {
  const { migrate, pool, query } = await import("../lib/server/db.ts");
  await migrate();
  t.after(async () => {
    await pool().end();
    await iso.drop();
  });
  const u = await query<{ id: string }>(`INSERT INTO users (name, telegram_id) VALUES ('owner', 777001) RETURNING id::text AS id`);
  await query(`INSERT INTO admin_accounts (user_id, role, status) VALUES ($1, 'owner', 'active')`, [u[0]!.id]);

  const NOW = new Date("2026-11-05T03:00:00Z");
  const min = (m: number) => new Date(NOW.getTime() + m * 60_000);
  const put = async (n: number, provider: string, signature: string, at: Date, message = "403 Forbidden: suspended") => {
    for (let i = 0; i < n; i++) await query("INSERT INTO provider_failures (at, provider, signature, message, job_id) VALUES ($1, $2, $3, $4, $5)", [at, provider, signature, message, `j${i}`]);
  };
  const reset = () => query("TRUNCATE provider_failures, server_alert_state, ai_usage, media_jobs, video_ops");
  const usageOf = (at: Date, provider: string, outcome = "completed") => query(`INSERT INTO ai_usage (at, source, outcome, tool_id, parts) VALUES ($1, 'job', $2, 'slide', $3::jsonb)`, [at, outcome, JSON.stringify([{ kind: "llm", provider, model: "m", calls: 1 }])]);
  const sent: string[] = [];
  const send = async (_chat: string, text: string) => (sent.push(text), true);
  const pass = async (at: Date) => (await A.runAlerts({ now: at, send })).sent.filter((s) => s.rule.startsWith("provider_fail:"));

  await t.test("recordProviderFailure: scrubbed, clipped, grouped; never throws", async () => {
    await reset();
    process.env.ELEVENLABS_API_KEY = "sk_eleven_secret_value_1234";
    t.after(() => void delete process.env.ELEVENLABS_API_KEY);
    await P.recordProviderFailure("job-1", { provider: "elevenlabs", status: 500, message: `500 oops key=abc sk_eleven_secret_value_1234 ${"x".repeat(300)}` });
    await P.recordProviderFailure("job-2", { provider: "gemini", status: 403, message: "Consumer 'api_key:AIzaSyA1234567890123456789012345678901234' suspended" });
    await P.recordProviderFailure("job-3", null);
    const rows = await query<{ provider: string; message: string; signature: string; job_id: string }>("SELECT provider, message, signature, job_id FROM provider_failures ORDER BY id");
    assert.equal(rows.length, 2);
    for (const r of rows) {
      assert.ok(r.message.length <= 120, `${r.message.length}`);
      assert.ok(!r.message.includes("sk_eleven_secret") && !r.message.includes("AIzaSy"), r.message);
      assert.ok(!r.signature.includes("sk_eleven_secret") && !r.signature.includes("AIzaSy"), r.signature);
    }
    await P.recordProviderFailure("job-4", { provider: "elevenlabs", message: MISSING("dubbing_write") });
    const last = await query<{ signature: string }>("SELECT signature FROM provider_failures WHERE job_id = 'job-4'");
    assert.equal(last[0]!.signature, "missing_permission:dubbing_write");
  });

  await t.test("alert: fires at five on the same error, not at four, with provider and error", async () => {
    await reset();
    sent.length = 0;
    await put(4, "gemini", "403|same", min(-1));
    assert.deepEqual(await pass(NOW), []);
    await put(1, "gemini", "403|same", min(-1), "103 Forbidden: <b>suspended</b>");
    assert.deepEqual(await pass(NOW), [{ rule: "provider_fail:gemini", kind: "alert" }]);
    assert.equal(sent.length, 1);
    assert.match(sent[0]!, /\[OGOHLANTIRISH\].*gemini.*5 ta ish.*103 Forbidden/, "`min(message)`: a stable sample");
    assert.ok(!sent[0]!.includes("<b>"), "Telegram HTML is escaped");
  });

  await t.test("alert: the window is ten minutes", async () => {
    await reset();
    await put(5, "gemini", "403|same", min(-11));
    assert.deepEqual(await pass(NOW), []);
  });

  await t.test("alert: different errors of a provider are not one spike; two providers are two incidents", async () => {
    await reset();
    await put(3, "gemini", "403|a", min(-1));
    await put(3, "gemini", "500|b", min(-1));
    assert.deepEqual(await pass(NOW), []);
    await reset();
    await put(5, "gemini", "403|a", min(-1));
    await put(5, "anthropic", "400|credit", min(-1));
    assert.equal((await pass(NOW)).length, 2);
  });

  await t.test("alert: one message per incident, through a trickle and hours of failures, then one recovery", async () => {
    await reset();
    sent.length = 0;
    await put(6, "kling", "401|a", min(-1));
    assert.equal((await pass(NOW)).length, 1);
    assert.deepEqual(await pass(min(1)), [], "next minute: same incident");
    await put(6, "kling", "401|a", min(179));
    assert.deepEqual(await pass(min(180)), [], "three hours on: no reminder");
    await put(1, "kling", "401|a", min(195));
    assert.deepEqual(await pass(min(200)), [], "a trickle neither re-alerts nor recovers");
    assert.deepEqual(await pass(min(215)), [], "an empty ten-minute window alone proves nothing: users stopped trying");
    assert.deepEqual(await pass(min(226)), [{ rule: "provider_fail:kling", kind: "recover" }], "thirty quiet minutes do");
    assert.equal(sent.length, 2);
    assert.match(sent[1]!, /\[NORMALLASHDI\].*kling.*30 daqiqadan beri/);
    assert.deepEqual(await pass(min(231)), []);
  });

  await t.test("alert: recovery needs evidence: a COMPLETED job that used this provider, from any of the three records", async () => {
    const fired = async (provider: string) => {
      await reset();
      await put(5, provider, "401|a", min(-1));
      assert.equal((await pass(NOW)).length, 1);
    };
    sent.length = 0;
    await fired("gemini");
    await usageOf(min(14), "anthropic");
    await usageOf(min(14), "gemini", "failed");
    assert.deepEqual(await pass(min(15)), [], "another provider's job, or a failed one, proves nothing");
    await usageOf(min(15), "gemini");
    assert.deepEqual(await pass(min(16)), [{ rule: "provider_fail:gemini", kind: "recover" }]);
    assert.match(sent.at(-1)!, /\[NORMALLASHDI\].*gemini.*muvaffaqiyatli/);

    await fired("fal");
    await query(`INSERT INTO media_jobs (id, purpose, model_id, provider, upstream_model, idempotency_key, status, finished_at) VALUES ('11111111-1111-4111-8111-111111111111', 'p', 'm', 'fal', 'u', 'k', 'succeeded', $1)`, [min(15)]);
    assert.deepEqual(await pass(min(16)), [{ rule: "provider_fail:fal", kind: "recover" }]);

    await fired("kling");
    const gen = "22222222-2222-4222-8222-222222222222";
    await query(`INSERT INTO generations (id, user_id, tool_id, status) VALUES ($1, $2, 'video', 'COMPLETED') ON CONFLICT DO NOTHING`, [gen, u[0]!.id]);
    await query(`INSERT INTO video_ops (generation_id, provider, status, deadline_at, finished_at) VALUES ($1, 'kling', 'succeeded', $2, $2)`, [gen, min(15)]);
    assert.deepEqual(await pass(min(16)), [{ rule: "provider_fail:kling", kind: "recover" }]);
  });

  await t.test("alert: a spike after a recovery is a new incident and alerts at once: the recovery had evidence", async () => {
    await reset();
    await put(5, "gemini", "401|a", min(-1));
    assert.equal((await pass(NOW)).length, 1);
    await usageOf(min(14), "gemini");
    assert.deepEqual(await pass(min(15)), [{ rule: "provider_fail:gemini", kind: "recover" }]);
    await put(5, "gemini", "401|a", min(19));
    assert.deepEqual(await pass(min(20)), [{ rule: "provider_fail:gemini", kind: "alert" }], "inside the old 60-minute cooldown");
  });

  await t.test("refusedPermissions: lists what the current key was refused; a changed key clears it", async () => {
    await reset();
    await P.recordProviderFailure("j1", { provider: "elevenlabs", status: 401, message: MISSING("speech_to_text") });
    await P.recordProviderFailure("j2", { provider: "elevenlabs", status: 401, message: MISSING("dubbing_write") });
    await P.recordProviderFailure("j3", { provider: "elevenlabs", status: 401, message: MISSING("dubbing_write") });
    await P.recordProviderFailure("j4", { provider: "gemini", status: 403, message: "suspended" });
    assert.deepEqual([...(await P.refusedPermissions())], [["elevenlabs", ["dubbing_write", "speech_to_text"]]]);
    await query("UPDATE provider_failures SET at = now() - interval '31 days' WHERE job_id = 'j1'");
    assert.deepEqual([...(await P.refusedPermissions())], [["elevenlabs", ["dubbing_write"]]], "older than the 30-day retention");
    await query("INSERT INTO provider_settings (provider, updated_at) VALUES ('elevenlabs', now() + interval '1 second')");
    assert.equal((await P.refusedPermissions()).size, 0);
  });

  await t.test("purge keeps thirty days", async () => {
    await reset();
    await query("INSERT INTO provider_failures (at, provider, signature, message) VALUES (now() - interval '31 days', 'gemini', 's', 'm'), (now() - interval '29 days', 'gemini', 's', 'm')");
    assert.equal(await P.purgeProviderFailures(), 1);
  });
});

test("Kling «Tekshirish»: the free account read, Bearer, packs summed, no pack and a refusal said plainly", async () => {
  const { probeProvider, probeRequest } = await import("../lib/server/providers/probe.ts");
  const { providerDef } = await import("../lib/server/providers/registry.ts");
  assert.equal(providerDef("kling")!.testable, true);
  const req = probeRequest("kling", GOOD_KLING) as { url: string; headers: Record<string, string>; method?: string };
  assert.match(req.url, /^https:\/\/api-singapore\.klingai\.com\/account\/costs\?start_time=\d+&end_time=\d+$/);
  assert.equal(req.headers.Authorization, `Bearer ${GOOD_KLING}`);
  assert.equal(req.method, undefined, "a read: nothing generated");
  const run = (status: number, body: unknown) =>
    probeProvider("kling", GOOD_KLING, { fetchImpl: (async () => new Response(JSON.stringify(body), { status })) as typeof fetch });
  const pack = (name: string, status: string, remaining_quantity: number) => ({ resource_pack_name: name, status, remaining_quantity });
  const live = await run(200, { code: 0, data: { resource_pack_subscribe_infos: [pack("Trial-Video-Flagship", "online", 64), pack("Video-Old", "expired", 900), pack("Image-Pack", "online", 50), pack("Kling-3.0-Pack", "online", 6)] } });
  assert.equal(live.ok, true);
  assert.match(live.message, /70 birlik/);
  const scoped = await run(200, { code: 0, data: { resource_pack_subscribe_infos: [{ ...pack("Trial-Video", "online", 64), resource_pack_applicable_models: "Available only for Kling 4.0 and Kling 4.0 Flash" }] } });
  assert.match(scoped.message, /only for Kling 4\.0 and Kling 4\.0 Flash/);
  const empty = await run(200, { code: 0, data: { resource_pack_subscribe_infos: [pack("Video-Old", "runOut", 0)] } });
  assert.equal(empty.ok, true);
  assert.match(empty.message, /faol video paket yo‘q/);
  const code = await run(200, { code: 1100, message: `bad ${GOOD_KLING}` });
  assert.equal(code.ok, false);
  assert.ok(!code.message.includes(GOOD_KLING));
  const refused = await run(401, { code: 1000, message: "auth failed" });
  assert.equal(refused.ok, false);
  assert.match(refused.message, /HTTP 401/);
});
