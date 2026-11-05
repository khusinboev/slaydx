import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { TOOL_BY_ID } from "../lib/tools.ts";
import type { FormValues } from "../lib/types.ts";
import { buildArtifact } from "../lib/generation/index.ts";
import { withJobCost } from "../lib/generation/job-cost.ts";
import { llmComplete, llmEnabled, llmFallback, llmGrounded, llmStream } from "../lib/generation/llm.ts";
import { complete, roleSpecs } from "../lib/generation/llm-roles.ts";
import { breakerFor, resetBreakers } from "../lib/generation/llm/breaker.ts";
import { ACCOUNT_BREAKER_MS, isAccountFailure, lastFailure, resetFailureCounters } from "../lib/generation/llm/failure.ts";
import { resetLimiters } from "../lib/generation/llm/limiter.ts";
import { effectiveRoute, geminiTextModel, usableTextChain } from "../lib/server/providers/route-effective.ts";
import { resetRouteSnapshot, setRouteSnapshot } from "../lib/server/providers/route-resolve.ts";
import { checkRoute } from "../lib/server/providers/routes.ts";

/**
 * Gemini down, the fallback answers: the whole path on a stubbed fetch, NO real provider call.
 *
 * Incident 2026-11-05: Gemini answered 403 for hours and 90 paid jobs failed, because the direct path (slide, course
 * work, translation) knew only Gemini and a 403 counted as provider health.
 *
 * MUTATIONS checked by hand (each makes the named test fail):
 *   - `runLlm` calls Gemini only (no `walkTextChain`) -> "llmComplete: Gemini 403 moves ...", the slide test;
 *   - `llmStream` skips the chain -> "llmStream: Gemini 403 ...";
 *   - `llmGrounded` walks the chain -> "grounded call never reaches a fallback";
 *   - remove the `isAccountFailure` branch of `withRetry` -> "breaker opens on one account error (direct path)";
 *   - remove it from `chain.ts` -> "breaker opens on one account error (role chain)";
 *   - leave `waitMax` on with a fallback -> "an open breaker is not waited for when a fallback exists";
 *   - drop `withoutKeylessFallbacks` from `roleSpecs` -> "no key: the role chains are what they were";
 *   - `usableTextChain` returns keyless specs -> "no key: exactly one Gemini call ...";
 *   - drop `recordLlmUsage` in `completeOthers` -> "cost_json shows the provider really used";
 *   - drop `reportFallback` -> "a fallback answer is one warn line";
 *   - env chain does not gain the fallbacks -> "env chain gains the fallbacks";
 *   - `geminiTextModel` ignores the chain -> "a stored chain can make a Chinese model primary".
 */

const ENV = ["GEMINI_API_KEY", "DASHSCOPE_API_KEY", "DEEPSEEK_API_KEY", "ANTHROPIC_API_KEY", "LLM_WRITER", "LLM_RESEARCHER", "LLM_JUDGE", "LLM_FAST", "LLM_STREAM", "GEMINI_MODEL", "PEXELS_API_KEY", "PIXABAY_API_KEY"];
const saved = new Map(ENV.map((k) => [k, process.env[k]]));
const realFetch = globalThis.fetch;

type Hit = { url: string; body: string };
const hits: Hit[] = [];

const GEMINI = "generativelanguage.googleapis.com";
const QWEN = "dashscope-intl.aliyuncs.com";
const DEEPSEEK = "api.deepseek.com";

const denied = () => Response.json({ error: { code: 403, message: "Your project has been denied access.", status: "PERMISSION_DENIED" } }, { status: 403 });
const geminiOk = (text: string) => Response.json({ candidates: [{ content: { parts: [{ text }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 } });
const compatOk = (text: string) => Response.json({ choices: [{ message: { content: text }, finish_reason: "stop" }], usage: { prompt_tokens: 100, completion_tokens: 50 } });

function route(reply: (h: Hit) => Response) {
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const h = { url: String(url instanceof Request ? url.url : url), body: String(init?.body ?? "") };
    hits.push(h);
    return reply(h);
  }) as typeof fetch;
}

const count = (host: string) => hits.filter((h) => h.url.includes(host)).length;
const logged: string[] = [];
const realWarn = console.warn;

beforeEach(() => {
  resetBreakers();
  resetLimiters();
  resetFailureCounters();
  resetRouteSnapshot();
  hits.length = 0;
  logged.length = 0;
  for (const k of ENV) delete process.env[k];
  process.env.GEMINI_API_KEY = "test-gemini-key";
  console.warn = (...args: unknown[]) => void logged.push(args.map(String).join(" "));
});

afterEach(() => {
  console.warn = realWarn;
  globalThis.fetch = realFetch;
  resetRouteSnapshot();
  for (const [k, v] of saved) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

const both = () => {
  process.env.DASHSCOPE_API_KEY = "test-qwen-key";
  process.env.DEEPSEEK_API_KEY = "test-deepseek-key";
};

/* ───────────────────────────── no key: nothing changes ───────────────────────────── */

test("no key: exactly one Gemini call, no other host, the direct path as it was", async () => {
  route(() => geminiOk("Salom"));
  assert.deepEqual(usableTextChain(), [{ provider: "gemini", model: "gemini-3.7-flash" }]);
  assert.equal(await llmComplete("s", "u", 100), "Salom");
  assert.deepEqual(hits.map((h) => new URL(h.url).host), [GEMINI]);
});

test("no key: a Gemini 403 fails as before, without another host", async () => {
  route(denied);
  assert.equal(await llmComplete("s", "u", 100), null);
  assert.equal(count(GEMINI), 1);
  assert.equal(hits.length, 1);
});

test("no key: the role chains are what they were (golden)", () => {
  const gemini = [{ provider: "gemini", model: "gemini-3.7-flash" }];
  for (const role of ["writer", "researcher", "judge", "fast"] as const) assert.deepEqual(roleSpecs(role), gemini, role);
  process.env.LLM_JUDGE = "anthropic:claude-sonnet-5,gemini:gemini-3.7-flash";
  assert.deepEqual(roleSpecs("judge"), [{ provider: "anthropic", model: "claude-sonnet-5" }, ...gemini]);
  delete process.env.GEMINI_API_KEY;
  assert.deepEqual(roleSpecs("writer"), [], "nothing configured: the caller gets null, as before");
  assert.equal(llmEnabled(), false);
});

test("the effective route shows the fallbacks to the admin even without keys", () => {
  assert.deepEqual(effectiveRoute("llm.chain", {}), {
    source: "default",
    entries: [
      { provider: "gemini", model: "gemini-3.7-flash" },
      { provider: "qwen", model: "qwen3.7-plus" },
      { provider: "deepseek", model: "deepseek-flash" },
    ],
  });
  assert.deepEqual(effectiveRoute("llm.writer", {}), effectiveRoute("llm.chain", {}));
  assert.equal(effectiveRoute("llm.chain", { GEMINI_MODEL: "gemini-3.1-pro" }).entries[0].model, "gemini-3.1-pro", "the env Gemini model leads the chain");
});

test("env chain gains the fallbacks after its own entries, without repeating a provider", () => {
  both();
  process.env.LLM_WRITER = "gemini:gemini-3.5-flash-lite";
  assert.deepEqual(roleSpecs("writer"), [
    { provider: "gemini", model: "gemini-3.5-flash-lite" },
    { provider: "qwen", model: "qwen3.7-plus" },
    { provider: "deepseek", model: "deepseek-flash" },
  ]);
  process.env.LLM_WRITER = "deepseek:deepseek-v4-pro,gemini:gemini-3.7-flash";
  assert.deepEqual(roleSpecs("writer").map((s) => `${s.provider}:${s.model}`), ["deepseek:deepseek-v4-pro", "gemini:gemini-3.7-flash", "qwen:qwen3.7-plus"]);
});

test("an admin's stored role chain stays exact", () => {
  both();
  setRouteSnapshot(new Map([["llm.writer", [{ provider: "gemini", model: "gemini-3.7-flash" }]]]));
  assert.deepEqual(roleSpecs("writer"), [{ provider: "gemini", model: "gemini-3.7-flash" }]);
});

test("one fallback key: only that provider joins the chain; a provider with no key is not tried", async () => {
  process.env.DEEPSEEK_API_KEY = "test-deepseek-key";
  route((h) => (h.url.includes(GEMINI) ? denied() : compatOk("DeepSeek javobi")));
  assert.equal(await llmComplete("s", "u", 100), "DeepSeek javobi");
  assert.equal(count(QWEN), 0);
  assert.equal(count(DEEPSEEK), 1);
});

/* ───────────────────────────── Gemini down ───────────────────────────── */

test("isAccountFailure: 401/402/403 and Gemini's bad-key 400; a plain 400, 404 and 429 are not", () => {
  for (const s of [401, 402, 403]) assert.equal(isAccountFailure(s), true, String(s));
  assert.equal(isAccountFailure(400, "API key not valid. Please pass a valid API key."), true);
  assert.equal(isAccountFailure(400, "Invalid JSON payload"), false);
  assert.equal(isAccountFailure(404), false);
  assert.equal(isAccountFailure(429, "You exceeded your current quota"), false, "Gemini says this for a per-minute limit too");
  assert.equal(isAccountFailure(undefined), false);
});

test("llmComplete: Gemini 403 moves to the next spec within one call, in the default order", async () => {
  both();
  route((h) => (h.url.includes(GEMINI) ? denied() : compatOk("Qwen javobi")));
  assert.equal(await llmComplete("s", "u", 100), "Qwen javobi");
  assert.deepEqual(hits.map((h) => new URL(h.url).host), [GEMINI, QWEN], "no retry on Gemini, Qwen first");
  assert.equal(JSON.parse(hits[1].body).model, "qwen3.7-plus");
});

test("Qwen refused too: DeepSeek answers", async () => {
  both();
  route((h) => (h.url.includes(DEEPSEEK) ? compatOk("DeepSeek javobi") : denied()));
  assert.equal(await llmComplete("s", "u", 100), "DeepSeek javobi");
  assert.deepEqual(hits.map((h) => new URL(h.url).host), [GEMINI, QWEN, DEEPSEEK]);
});

test("Gemini 5xx: its retries first, then the fallback", async () => {
  both();
  route((h) => (h.url.includes(GEMINI) ? Response.json({ error: { message: "down" } }, { status: 503 }) : compatOk("Qwen javobi")));
  assert.equal(await llmComplete("s", "u", 100), "Qwen javobi");
  assert.equal(count(GEMINI), 3);
});

test("complete(role): Gemini 403 moves on within the role chain, usage names the real provider", async () => {
  both();
  route((h) => (h.url.includes(GEMINI) ? denied() : compatOk('{"ok":true}')));
  const r = await complete("writer", "s", "u", { json: true });
  assert.equal(r?.text, '{"ok":true}');
  assert.equal(r?.usage?.provider, "qwen");
  assert.equal(r?.usage?.model, "qwen3.7-plus");
});

test("breaker opens on one account error (role chain): the next call skips Gemini", async () => {
  both();
  route((h) => (h.url.includes(GEMINI) ? denied() : compatOk("Qwen javobi")));
  await complete("writer", "s", "u");
  assert.equal(breakerFor("gemini").state, "open");
  assert.ok(breakerFor("gemini").msUntilRetry() > ACCOUNT_BREAKER_MS - 5_000);
  await complete("writer", "s", "u");
  assert.equal(count(GEMINI), 1, "the second job does not rediscover the outage");
  assert.equal(count(QWEN), 2);
});

test("breaker opens on one account error (direct path), for the stream too", async () => {
  both();
  route((h) => (h.url.includes(GEMINI) ? denied() : compatOk("Qwen javobi")));
  await llmComplete("s", "u", 100);
  assert.equal(breakerFor("gemini").state, "open");
  await llmComplete("s", "u", 100);
  await llmStream("s", "u", 100, { onText: () => {} });
  assert.equal(count(GEMINI), 1);
  assert.equal(count(QWEN), 3);
});

test("breaker opens without a fallback too, and a healthy 400 still closes nothing", async () => {
  route(denied);
  await llmComplete("s", "u", 100);
  assert.equal(breakerFor("gemini").state, "open");
  resetBreakers();
  route(() => Response.json({ error: { message: "Invalid JSON payload" } }, { status: 400 }));
  await llmComplete("s", "u", 100);
  assert.equal(breakerFor("gemini").state, "closed", "a request-level 4xx says nothing about the provider");
});

test("an open breaker is not waited for when a fallback exists", async () => {
  both();
  route(() => compatOk("Qwen javobi"));
  breakerFor("gemini").trip(1_000);
  const started = Date.now();
  assert.equal(await llmComplete("s", "u", 100, { deadline: Date.now() + 120_000 }), "Qwen javobi");
  assert.ok(Date.now() - started < 800, "the job went straight to the fallback");
  assert.equal(count(GEMINI), 0);
});

test("a timeout without a job deadline stops the walk: the caller's budget is unknown", async () => {
  both();
  globalThis.fetch = ((url: string, init: RequestInit) => {
    hits.push({ url: String(url), body: "" });
    return new Promise((_r, reject) => init.signal!.addEventListener("abort", () => reject(new Error("This operation was aborted"))));
  }) as unknown as typeof fetch;
  assert.equal(await llmComplete("s", "u", 100, { timeoutMs: 30 }), null);
  assert.equal(count(QWEN), 0);
});

test("llmStream: Gemini 403 streams from the fallback, onText gets the growing text", async () => {
  both();
  const sse = () =>
    new Response(
      [`data: ${JSON.stringify({ choices: [{ delta: { content: '{"a"' }, finish_reason: null }] })}\n\n`, `data: ${JSON.stringify({ choices: [{ delta: { content: ":1}" }, finish_reason: "stop" }] })}\n\n`, "data: [DONE]\n\n"].join(""),
      { headers: { "content-type": "text/event-stream" } },
    );
  route((h) => (h.url.includes(GEMINI) ? denied() : sse()));
  const seen: string[] = [];
  const text = await llmStream("s", "u", 100, { json: true, onText: (t) => seen.push(t) });
  assert.equal(text, '{"a":1}');
  assert.deepEqual(seen, ['{"a"', '{"a":1}']);
  assert.equal(JSON.parse(hits.find((h) => h.url.includes(QWEN))!.body).stream, true);
  assert.equal(count(GEMINI), 1, "a refused account is not asked again on the plain endpoint");
});

test("llmStream: the JSON-quality retry on a fallback is not streamed, onText still gets the finished text", async () => {
  both();
  let n = 0;
  route((h) => {
    if (h.url.includes(GEMINI)) return denied();
    n += 1;
    return n === 1 ? compatOk("not json at all") : compatOk('{"a":1}');
  });
  const seen: string[] = [];
  assert.equal(await llmStream("s", "u", 100, { json: true, onText: (t) => seen.push(t) }), '{"a":1}');
  assert.equal(JSON.parse(hits.filter((h) => h.url.includes(QWEN))[1].body).stream, undefined);
  assert.equal(seen.at(-1), '{"a":1}');
});

test("LLM_STREAM=false still walks the chain", async () => {
  both();
  process.env.LLM_STREAM = "false";
  route((h) => (h.url.includes(GEMINI) ? denied() : compatOk("Qwen javobi")));
  const seen: string[] = [];
  assert.equal(await llmStream("s", "u", 100, { onText: (t) => seen.push(t) }), "Qwen javobi");
  assert.deepEqual(seen, ["Qwen javobi"]);
});

test("grounded call never reaches a fallback: no search means no «verified» facts", async () => {
  both();
  route((h) => (h.url.includes(GEMINI) ? denied() : compatOk("xotiradan yozilgan fakt")));
  assert.equal(await llmGrounded("s", "u", 100), null);
  assert.equal(count(QWEN) + count(DEEPSEEK), 0);
});

test("no Gemini key: the fallback alone serves text, and the product says text is available", async () => {
  both();
  delete process.env.GEMINI_API_KEY;
  assert.equal(llmEnabled(), true);
  route(() => compatOk("Qwen javobi"));
  assert.equal(await llmComplete("s", "u", 100), "Qwen javobi");
  assert.equal(count(GEMINI), 0);
  assert.equal((await complete("fast", "s", "u"))?.text, "Qwen javobi");
  assert.equal(await llmGrounded("s", "u", 100), null);
});

test("a stored chain can make a Chinese model primary; Gemini then is the fallback with its own model", async () => {
  both();
  const entries = [{ provider: "qwen", model: "qwen3.8-flash" }, { provider: "gemini", model: "gemini-3.5-flash-lite" }];
  assert.deepEqual(checkRoute("llm.chain", entries), { ok: true, entries });
  setRouteSnapshot(new Map([["llm.chain", entries as never]]));
  assert.equal(geminiTextModel(), "gemini-3.5-flash-lite");
  assert.deepEqual(roleSpecs("writer").map((s) => s.provider), ["qwen", "gemini"], "a role with no chain of its own follows");
  route((h) => (h.url.includes(QWEN) ? Response.json({ error: { message: "no" } }, { status: 400 }) : geminiOk("Gemini javobi")));
  assert.equal(await llmComplete("s", "u", 100), "Gemini javobi");
  assert.deepEqual(hits.map((h) => new URL(h.url).host), [QWEN, GEMINI]);
  assert.match(hits[1].url, /gemini-3\.5-flash-lite:generateContent/);
  assert.ok(logged.some((l) => l.includes("[llm] fallback used") && l.includes("gemini-3.5-flash-lite")));
});

test("a fallback answer is one warn line with role/provider/model and no text", async () => {
  both();
  route((h) => (h.url.includes(GEMINI) ? denied() : compatOk("Maxfiy javob")));
  await llmComplete("s", "maxfiy prompt", 100);
  const lines = logged.filter((l) => l.includes("[llm] fallback used"));
  assert.equal(lines.length, 1);
  for (const part of ["complete", "qwen", "qwen3.7-plus"]) assert.ok(lines[0].includes(part), part);
  assert.ok(!logged.join("\n").toLowerCase().includes("maxfiy"), "metadata only");
  hits.length = 0;
  logged.length = 0;
  resetBreakers();
  route(() => geminiOk("ok"));
  await llmComplete("s", "u", 100);
  assert.equal(logged.filter((l) => l.includes("[llm] fallback used")).length, 0, "a healthy Gemini logs nothing");
});

test("all providers down: null, and the last failure names the last one tried", async () => {
  both();
  route(denied);
  assert.equal(await llmComplete("s", "u", 100), null);
  assert.equal(lastFailure()?.provider, "deepseek");
  assert.equal(lastFailure()?.status, 403);
});

test("cost_json shows the provider really used (direct path)", async () => {
  both();
  route((h) => (h.url.includes(GEMINI) ? denied() : compatOk("Qwen javobi")));
  const { cost } = await withJobCost(() => llmComplete("s", "u", 100));
  const parts = cost.toJson().parts ?? [];
  assert.deepEqual(parts.map((p) => [p.provider, p.model, p.inputTokens, p.outputTokens]), [["qwen", "qwen3.7-plus", 100, 50]]);
  assert.ok(Math.abs(parts[0].usd - (100 * 0.4 + 50 * 1.6) / 1e6) < 1e-12);
});

test("llmFallback: text-only helper skips Gemini; null with no fallback key", async () => {
  route(() => compatOk('{"score":1}'));
  assert.equal(await llmFallback("domla.score", "s", "u", 100, { json: true }), null);
  assert.equal(hits.length, 0);
  both();
  assert.equal(await llmFallback("domla.score", "s", "u", 100, { json: true }), '{"score":1}');
  assert.deepEqual(hits.map((h) => new URL(h.url).host), [QWEN]);
});

/* ───────────────────────────── the incident's job, end to end ───────────────────────────── */

const SLIDES = Array.from({ length: 8 }, (_, i) => ({ layout: "bullets", title: `Fotosintez bosqichi ${i + 1}`, bullets: ["Yorug'lik energiyasi xlorofillda tutiladi.", "Suv molekulasi parchalanadi va kislorod ajraladi."] }));

test("slide: Gemini 403 and Qwen answering, the job that failed on 2026-11-05 now completes", async () => {
  both();
  route((h) => {
    if (h.url.includes(GEMINI)) return denied();
    if (h.url.includes(QWEN)) return compatOk(JSON.stringify({ slides: SLIDES }));
    throw new Error(`unexpected host: ${h.url}`);
  });
  const file = await buildArtifact(TOOL_BY_ID.slide, { topic: "Fotosintez", slideCount: 8 } as FormValues, { deadline: Date.now() + 240_000 });
  assert.ok(file.bytes.length > 1000, "a real file");
  assert.equal(file.cost?.provider, "qwen");
  assert.equal(file.cost?.model, "qwen3.7-plus");
  assert.equal(count(GEMINI), 1, "one Gemini refusal, then the breaker keeps the job off it");
  assert.ok(count(QWEN) >= 1);
});

test("pro-slide with internet search: research is skipped, the deck is written on the fallback", async () => {
  both();
  route((h) => {
    if (h.url.includes(GEMINI)) return denied();
    return compatOk(JSON.stringify({ slides: SLIDES.slice(0, 6) }));
  });
  const file = await buildArtifact(TOOL_BY_ID["pro-slide"], { topic: "Fotosintez", slideCount: 6, internetSearch: true } as FormValues, { deadline: Date.now() + 240_000 });
  assert.ok(file.bytes.length > 1000);
  assert.ok(!file.cost?.parts?.some((p) => p.kind === "grounding"), "no search happened, none is billed");
  assert.ok(hits.some((h) => h.url.includes(GEMINI) && h.body.includes("google_search")), "the grounded call did try Gemini");
});

test("slide: with no fallback key the job fails as it did (the error the owner saw)", async () => {
  route(denied);
  await assert.rejects(buildArtifact(TOOL_BY_ID.slide, { topic: "Fotosintez", slideCount: 8 } as FormValues, { deadline: Date.now() + 240_000 }), /Taqdimot matni yozilmadi/);
});
