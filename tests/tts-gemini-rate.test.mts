import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createIsolatedDb } from "./helpers/isolated-db.mts";
import { makeTtsChain, TTS_RATE_RETRIES, type TtsClock } from "../lib/generation/tts/chain.ts";
import { GEMINI_DAILY_QUOTA_MESSAGE, makeGeminiTts, parseGeminiQuota, parseRetryDelay } from "../lib/generation/tts/gemini.ts";
import { geminiTtsRpm, makePacer, pgTakeSlot, type TakeSlot } from "../lib/generation/tts/pace.ts";
import { DeadlineError } from "../lib/generation/llm/chain.ts";
import { TtsError } from "../lib/generation/tts/types.ts";
import { UserFacingError, userMessage, VOICE_JOB_ERROR } from "../lib/server/user-error.ts";

/**
 * Gemini TTS 429 handling + cross-process pacing.
 *
 * Mutation checks (each made the named tests fail, then restored):
 *   - 429 no longer `rateLimited` / retry loop removed from `runGroup`  -> the wait/retry, retry-bound and deadline tests;
 *   - `daily` always false                                              -> the per-day fail-fast test (it would sleep + retry);
 *   - `pace` not called in `runGroup` (limiter removed)                  -> the "caps N per window" chain test;
 *   - chunk size back to 900                                             -> tests/tts-pack.test.mts.
 */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://unused/unused";
const iso = hasDb ? await createIsolatedDb("ttsrate") : { isolated: false, drop: async () => {} };

after(async () => {
  if (!hasDb) return;
  const { pool } = await import("../lib/server/db.ts");
  await pool().end();
  await iso.drop();
});

const ENV = {} as unknown as NodeJS.ProcessEnv;
const PCM = Buffer.from(new Uint8Array(48_000)).toString("base64");
const OK = () => Response.json({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "audio/L16;codec=pcm;rate=24000", data: PCM } }] } }] });

const minuteBody = (retryDelay?: string) =>
  JSON.stringify({
    error: {
      code: 429,
      message: "You exceeded your current quota",
      status: "RESOURCE_EXHAUSTED",
      details: [
        { "@type": "type.googleapis.com/google.rpc.QuotaFailure", violations: [{ quotaMetric: "generativelanguage.googleapis.com/generate_requests_per_model", quotaId: "GenerateRequestsPerMinutePerProjectPerModel" }] },
        ...(retryDelay ? [{ "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay }] : []),
      ],
    },
  });
const dayBody = JSON.stringify({
  error: { code: 429, status: "RESOURCE_EXHAUSTED", details: [{ "@type": "type.googleapis.com/google.rpc.QuotaFailure", violations: [{ quotaId: "GenerateRequestsPerDayPerProjectPerModel" }] }, { "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "39s" }] },
});
const r429 = (body: string) => new Response(body, { status: 429, statusText: "Too Many Requests" });

/** Fake clock: `sleep` advances time instantly and is recorded. */
function clock(start = 1_000_000) {
  const state = { t: start, sleeps: [] as number[] };
  const c: TtsClock = {
    now: () => state.t,
    sleep: async (ms) => {
      if (ms > 0) {
        state.sleeps.push(ms);
        state.t += ms;
      }
    },
  };
  return { c, state };
}

/** Real Gemini adapter over a scripted fetch. */
function gemini(responses: (() => Response)[], pace?: (ctx: never) => Promise<void>) {
  let calls = 0;
  const p = makeGeminiTts({
    key: () => "k",
    model: () => "gemini-2.5-flash-preview-tts",
    fetchImpl: (async () => {
      const next = responses[Math.min(calls, responses.length - 1)];
      calls++;
      return next();
    }) as unknown as typeof fetch,
    ...(pace ? { pace: pace as never } : {}),
  });
  return { p, calls: () => calls };
}

const run = (p: ReturnType<typeof gemini>["p"], c: TtsClock, logs: string[], deadline?: number) =>
  makeTtsChain({ providers: [p], env: ENV, log: (l) => logs.push(l), clock: c }).synthesizeAll([{ text: "Salom dunyo." }], { lang: "uz", ...(deadline !== undefined ? { deadline } : {}) });

/* ══════════════════════════ parsing ══════════════════════════ */

test("parseRetryDelay: '39s', '39.5s', '500ms', bare number; junk -> undefined", () => {
  assert.equal(parseRetryDelay("39s"), 39_000);
  assert.equal(parseRetryDelay("39.5s"), 39_500);
  assert.equal(parseRetryDelay("500ms"), 500);
  assert.equal(parseRetryDelay(12), 12_000);
  assert.equal(parseRetryDelay("soon"), undefined);
  assert.equal(parseRetryDelay(undefined), undefined);
});

test("parseGeminiQuota: per-minute body, per-day body, truncated non-JSON body", () => {
  assert.deepEqual(parseGeminiQuota(minuteBody("39s")), { retryDelayMs: 39_000, quotaIds: ["GenerateRequestsPerMinutePerProjectPerModel"], daily: false });
  const day = parseGeminiQuota(dayBody);
  assert.equal(day.daily, true);
  assert.ok(day.quotaIds.includes("GenerateRequestsPerDayPerProjectPerModel"));
  assert.equal(parseGeminiQuota('{"error":{"details":[{"quotaId":"GenerateRequestsPerDayPerProj').daily, true, "truncated body still names PerDay");
  assert.equal(parseGeminiQuota("<html>boom</html>").daily, false);
  assert.equal(parseGeminiQuota(minuteBody()).retryDelayMs, undefined);
});

/* ══════════════════════════ 429 retry ══════════════════════════ */

test("429 -> waits retryDelay + 1 s (fake clock) -> retries -> success", async () => {
  const { c, state } = clock();
  const g = gemini([() => r429(minuteBody("39s")), OK]);
  const logs: string[] = [];
  const out = await run(g.p, c, logs);
  assert.equal(out.audios.length, 1);
  assert.equal(g.calls(), 2);
  assert.deepEqual(state.sleeps, [40_000]);
  assert.ok(logs.some((l) => l.includes("GenerateRequestsPerMinutePerProjectPerModel") && l.includes("40000")), logs.join("\n"));
});

test("429 without retryDelay falls back to 20 s (+1 s)", async () => {
  const { c, state } = clock();
  const g = gemini([() => r429(minuteBody()), OK]);
  await run(g.p, c, []);
  assert.deepEqual(state.sleeps, [21_000]);
});

test("429 forever: exactly TTS_RATE_RETRIES waits, then the error surfaces (generic voice message)", async () => {
  assert.equal(TTS_RATE_RETRIES, 3);
  const { c, state } = clock();
  const g = gemini([() => r429(minuteBody("5s"))]);
  await assert.rejects(
    () => run(g.p, c, []),
    (e) => {
      assert.ok(e instanceof TtsError && e.rateLimited && e.status === 429);
      assert.equal(userMessage(e), VOICE_JOB_ERROR);
      return true;
    },
  );
  assert.equal(g.calls(), 4, "1 call + 3 retries");
  assert.deepEqual(state.sleeps, [6_000, 6_000, 6_000]);
});

test("per-DAY quota: fail fast (one call, no sleep), Uzbek user message, quota id logged", async () => {
  const { c, state } = clock();
  const g = gemini([() => r429(dayBody), OK]);
  const logs: string[] = [];
  await assert.rejects(
    () => run(g.p, c, logs),
    (e) => {
      assert.ok(e instanceof UserFacingError);
      assert.equal(e.message, GEMINI_DAILY_QUOTA_MESSAGE);
      assert.equal(userMessage(e), GEMINI_DAILY_QUOTA_MESSAGE);
      assert.match(e.message, /bugungi limitga yetdi/);
      return true;
    },
  );
  assert.equal(g.calls(), 1);
  assert.deepEqual(state.sleeps, []);
  assert.ok(logs.some((l) => l.includes("GenerateRequestsPerDayPerProjectPerModel")), logs.join("\n"));
});

test("deadline bounds the wait and the retries: never sleeps past deadline - reserve, then DeadlineError", async () => {
  const { c, state } = clock();
  const deadline = state.t + 30_000;
  const g = gemini([() => r429(minuteBody("39s"))]);
  await assert.rejects(() => run(g.p, c, [], deadline), DeadlineError);
  // 30 s - 1 s safety - 3 s reserve = 26 s: shortened from the requested 40 s.
  assert.deepEqual(state.sleeps, [26_000]);
  assert.ok(state.t <= deadline, "clock never moved past the deadline");
  assert.equal(g.calls(), 2);
});

test("no time left at all: DeadlineError before any request", async () => {
  const { c, state } = clock();
  const g = gemini([OK]);
  await assert.rejects(() => run(g.p, c, [], state.t + 2_000), DeadlineError);
  assert.equal(g.calls(), 0);
});

test("a non-429 5xx keeps the old behaviour: one quick retry, no long wait", async () => {
  const { c, state } = clock();
  const g = gemini([() => new Response("oops", { status: 503 }), OK]);
  await run(g.p, c, []);
  assert.equal(g.calls(), 2);
  assert.ok(state.sleeps.every((s) => s < 5_000));
});

/* ══════════════════════════ pacing ══════════════════════════ */

/** In-memory fixed-window limiter shared by every "process"; counts like `rateLimit` (rejected takes count too). */
function memoryLimiter(now: () => number) {
  const hits = new Map<string, number>();
  const granted = new Map<number, number>();
  const take: TakeSlot = async (bucket, limit, windowSec) => {
    const w = Math.floor(now() / (windowSec * 1000));
    const key = `${bucket}:${w}`;
    const n = (hits.get(key) ?? 0) + 1;
    hits.set(key, n);
    const ok = n <= limit;
    if (ok) granted.set(w, (granted.get(w) ?? 0) + 1);
    return { ok, retryAfterSec: Math.max(1, Math.ceil(((w + 1) * windowSec * 1000 - now()) / 1000)) };
  };
  return { take, granted };
}

test("limiter caps at N requests per window across two simulated callers", async () => {
  const { c, state } = clock(60_000 * 100 + 5_000);
  const lim = memoryLimiter(c.now);
  const pace = makePacer({ take: lim.take, limit: () => 8, log: () => {} });
  const ctx = { left: () => Infinity, reserveMs: 3_000, sleep: c.sleep, now: c.now };
  const caller = async () => {
    for (let i = 0; i < 10; i++) await pace(ctx);
  };
  await Promise.all([caller(), caller()]);
  const perWindow = [...lim.granted.values()];
  assert.equal(perWindow.reduce((a, b) => a + b, 0), 20, "every request eventually got a slot");
  assert.ok(perWindow.every((n) => n <= 8), `window counts ${perWindow.join(",")}`);
  assert.ok(perWindow.length >= 3, "20 requests at 8/min span at least 3 windows");
  assert.ok(state.sleeps.length > 0);
});

test("the chain takes a slot before EVERY request attempt (retries included); limiter off -> no cap", async () => {
  const { c } = clock();
  const slots: number[] = [];
  const pace = async () => void slots.push(c.now());
  const g = gemini([() => r429(minuteBody("5s")), OK], pace);
  await run(g.p, c, []);
  assert.equal(g.calls(), 2);
  assert.equal(slots.length, 2, "one slot per attempt");
});

test("pacer never sleeps past the job deadline: DeadlineError instead", async () => {
  const { c, state } = clock(60_000 * 100 + 1_000);
  const lim = memoryLimiter(c.now);
  const pace = makePacer({ take: lim.take, limit: () => 1, log: () => {} });
  const ctx = { left: () => 20_000, reserveMs: 3_000, sleep: c.sleep, now: c.now };
  await pace(ctx);
  await assert.rejects(() => pace(ctx), DeadlineError); // the next window opens in 59 s > 20 s left
  assert.deepEqual(state.sleeps, []);
});

test("TTS_GEMINI_RPM: default 8, positive integer override, junk -> 8", () => {
  assert.equal(geminiTtsRpm({} as never), 8);
  assert.equal(geminiTtsRpm({ TTS_GEMINI_RPM: "5" } as never), 5);
  assert.equal(geminiTtsRpm({ TTS_GEMINI_RPM: "0" } as never), 8);
  assert.equal(geminiTtsRpm({ TTS_GEMINI_RPM: "many" } as never), 8);
});

test("pg backend: two pacers share the pg rate_limits row (limit 3 -> 3 ok, then wait for the next window)", { skip: hasDb ? false : "DATABASE_URL yo'q" }, async () => {
  const { ensureMigrated } = await import("../lib/server/db.ts");
  await ensureMigrated();
  const bucket = `tts:gemini:rpm:test:${Date.now()}`;
  const results: boolean[] = [];
  for (let i = 0; i < 5; i++) results.push((await pgTakeSlot(bucket, 3, 60)).ok);
  assert.deepEqual(results, [true, true, true, false, false]);
  const blocked = await pgTakeSlot(bucket, 3, 60);
  assert.ok(blocked.retryAfterSec >= 1 && blocked.retryAfterSec <= 60);
});
