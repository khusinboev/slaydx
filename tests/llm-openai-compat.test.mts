import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { costUsd } from "../lib/generation/llm-pricing.ts";
import { OPENAI_COMPAT_ADAPTERS, OPENAI_COMPAT_PRESETS, chatBody, makeOpenAiCompatAdapter, presetBaseUrl } from "../lib/generation/llm/openai-compat.ts";
import { OPENAI_COMPAT_IDS, parseRoleSpec, type Attempt, type OpenAiCompatId } from "../lib/generation/llm/types.ts";
import { deepseekMessage, probeProvider, probeRequest } from "../lib/server/providers/probe.ts";
import { providerDef } from "../lib/server/providers/registry.ts";
import { PROVIDER_META } from "../lib/server/providers/catalog.ts";
import { modelOptions } from "../lib/server/providers/routes.ts";

/**
 * The OpenAI-compatible adapter, stubbed fetch only: no real provider is ever called.
 *
 * MUTATIONS checked by hand (each makes the named test fail):
 *   - take `thinkingOff` out of `chatBody` -> "golden request per preset";
 *   - drop `response_format` -> "JSON mode";
 *   - drop `JSON_INSTRUCTION` -> "JSON mode" (both providers refuse a prompt without the word JSON);
 *   - remove the `Math.min(..., maxOutputTokens)` cap -> "max_tokens";
 *   - accumulate `delta.reasoning_content` too -> "reasoning text is excluded" (stream) ;
 *   - read `message.reasoning_content` as a fallback for empty content -> "reasoning text is excluded" (plain);
 *   - return ok on a stream with no finish_reason -> "a cut stream is a retryable failure";
 *   - make 402 retryable -> "error mapping";
 *   - remove NO_QUOTA_RE from `httpFailure` -> "429 with no quota";
 *   - remove BAD_CONTENT_RE from `httpFailure` -> "content inspection";
 *   - remove `clean()` from `httpFailure` -> "the key never leaks";
 *   - map `finish_reason: content_filter` to ok -> "finish reasons";
 *   - accept an http:// base URL override -> "base URL override";
 *   - drop the host suffix check -> "base URL override";
 *   - remove `loweredLimit` -> "a 400 about max_tokens";
 *   - take the first number instead of the largest below the request -> "a 400 about max_tokens";
 *   - make a refused redirect retryable -> "a refused redirect is final";
 *   - remove `foreignScript` from `finished` -> "language guard";
 *   - drop `CJK_REQUESTED_RE` -> "language guard";
 *   - drop `stripThink` in `finished` -> "<think> blocks";
 *   - drop `stripThink` before `onText` -> "<think> blocks";
 *   - remove the line cap -> "SSE caps"; remove the text cap -> "SSE caps";
 *   - return the balance without the completion probe -> "probe: DeepSeek ...".
 */

const KEY = "sk-test-secret-key-0123456789";
const ENV = ["DASHSCOPE_API_KEY", "DEEPSEEK_API_KEY", "DASHSCOPE_BASE_URL"];
const OPTS = { maxTokens: 5000, timeoutMs: 2_000 };
const envOf = (e: Record<string, string>) => e as unknown as NodeJS.ProcessEnv;

type Seen = { url: string; init: RequestInit; body: Record<string, unknown> };

function stub(reply: () => Response | Promise<Response>): { fetchImpl: typeof fetch; seen: Seen[] } {
  const seen: Seen[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    seen.push({ url: String(url), init, body: JSON.parse(String(init.body)) as Record<string, unknown> });
    return reply();
  }) as unknown as typeof fetch;
  return { fetchImpl, seen };
}

const answer = (content: string | null, finish = "stop", extra: Record<string, unknown> = {}) =>
  Response.json({ choices: [{ message: { content, ...extra }, finish_reason: finish }], usage: { prompt_tokens: 1000, completion_tokens: 500 } });

function sse(lines: string[]): Response {
  const body = new ReadableStream({
    start(c) {
      for (const l of lines) c.enqueue(new TextEncoder().encode(l));
      c.close();
    },
  });
  return new Response(body, { headers: { "content-type": "text/event-stream" } });
}

const chunk = (delta: Record<string, unknown>, finish: string | null = null) => `data: ${JSON.stringify({ choices: [{ delta, finish_reason: finish }] })}\n\n`;

function adapter(id: OpenAiCompatId, reply: () => Response | Promise<Response>) {
  const s = stub(reply);
  return { ...s, a: makeOpenAiCompatAdapter(OPENAI_COMPAT_PRESETS[id], { fetchImpl: s.fetchImpl, env: envOf({}) }) };
}

beforeEach(() => {
  process.env.DASHSCOPE_API_KEY = KEY;
  process.env.DEEPSEEK_API_KEY = KEY;
});
afterEach(() => {
  for (const k of ENV) delete process.env[k];
});

test("golden request per preset: URL, auth, model, thinking off, floor of max_tokens, no stream fields", async () => {
  const q = adapter("qwen", () => answer("Salom"));
  await q.a.complete("qwen3.7-plus", "SYS", "USR", { maxTokens: 100, timeoutMs: 2_000, thinking: 2048 });
  assert.equal(q.seen[0].url, "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions");
  assert.equal((q.seen[0].init.headers as Record<string, string>).Authorization, `Bearer ${KEY}`);
  assert.equal(q.seen[0].init.redirect, "error", "a redirect must not carry the key to another host");
  assert.deepEqual(q.seen[0].body, {
    model: "qwen3.7-plus",
    messages: [{ role: "system", content: "SYS" }, { role: "user", content: "USR" }],
    temperature: 0.5,
    max_tokens: 4096,
    enable_thinking: false,
  });
  const d = adapter("deepseek", () => answer("Salom"));
  await d.a.complete("deepseek-flash", "SYS", "USR", OPTS);
  assert.equal(d.seen[0].url, "https://api.deepseek.com/chat/completions");
  assert.deepEqual(d.seen[0].body, {
    model: "deepseek-flash",
    messages: [{ role: "system", content: "SYS" }, { role: "user", content: "USR" }],
    temperature: 0.5,
    max_tokens: 5000,
    thinking: { type: "disabled" },
  });
});

test("max_tokens never exceeds the preset's limit", () => {
  const body = chatBody(OPENAI_COMPAT_PRESETS.qwen, "m", "s", "u", { maxTokens: 900_000, timeoutMs: 1 });
  assert.equal(body.max_tokens, OPENAI_COMPAT_PRESETS.qwen.maxOutputTokens);
});

test("JSON mode: response_format, the word JSON in the prompt, the schema as a hint", async () => {
  const d = adapter("deepseek", () => answer('{"a":1}'));
  const r = await d.a.complete("deepseek-flash", "SYS", "USR", { ...OPTS, json: true, responseSchema: { type: "object", required: ["a"] } });
  assert.ok(r.ok);
  assert.deepEqual(d.seen[0].body.response_format, { type: "json_object" });
  assert.equal(d.seen[0].body.temperature, 0.4);
  const system = (d.seen[0].body.messages as { content: string }[])[0].content;
  assert.match(system, /^SYS/);
  assert.match(system, /JSON/);
  assert.match(system, /"required":\["a"\]/);
  const bare = adapter("qwen", () => answer('{"a":1}'));
  await bare.a.complete("qwen3.7-plus", "SYS", "USR", { ...OPTS, json: true });
  assert.match((bare.seen[0].body.messages as { content: string }[])[0].content, /JSON/, "both providers refuse JSON mode without the word, schema or not");
  const plain = adapter("deepseek", () => answer("x"));
  await plain.a.complete("deepseek-flash", "SYS", "USR", OPTS);
  assert.ok(!("response_format" in plain.seen[0].body));
});

test("usage: tokens reach the Attempt and price at the book's peak row", async () => {
  const d = adapter("deepseek", () => answer("Javob", "stop"));
  const r = await d.a.complete("deepseek-flash", "s", "u", OPTS);
  assert.ok(r.ok);
  assert.deepEqual(r.usage, { inputTokens: 1000, outputTokens: 500 });
  assert.equal(r.finishReason, "stop");
  const usd = costUsd({ provider: "deepseek", model: "deepseek-flash", ...r.usage });
  assert.ok(Math.abs(usd - (1000 * 0.3 + 500 * 1.2) / 1e6) < 1e-12, String(usd));
});

test("an answer with no usage is estimated, never a silent $0", async () => {
  const d = adapter("deepseek", () => Response.json({ choices: [{ message: { content: "abcdef" }, finish_reason: "stop" }] }));
  const r = await d.a.complete("deepseek-flash", "sss", "uuu", OPTS);
  assert.ok(r.ok);
  assert.deepEqual(r.usage, { inputTokens: 2, outputTokens: 2 });
});

test("streaming: cumulative text, usage from the last chunk, stream fields in the request", async () => {
  const q = adapter("qwen", () =>
    sse([
      chunk({ role: "assistant", content: "" }),
      chunk({ content: "Sal" }),
      // A chunk split in the middle of a line: the buffer must join it.
      "data: " + JSON.stringify({ choices: [{ delta: { content: "om" }, finish_reason: null }] }).slice(0, 20),
      JSON.stringify({ choices: [{ delta: { content: "om" }, finish_reason: null }] }).slice(20) + "\n\n",
      chunk({}, "stop"),
      `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 7, completion_tokens: 3 } })}\n\n`,
      "data: [DONE]\n\n",
    ]),
  );
  const seen: string[] = [];
  const r = await q.a.complete("qwen3.7-plus", "s", "u", { ...OPTS, onText: (t) => seen.push(t) });
  assert.deepEqual(seen, ["Sal", "Salom"]);
  assert.ok(r.ok);
  assert.equal(r.text, "Salom");
  assert.deepEqual(r.usage, { inputTokens: 7, outputTokens: 3 });
  assert.equal(q.seen[0].body.stream, true);
  assert.deepEqual(q.seen[0].body.stream_options, { include_usage: true });
});

test("streaming asked, a JSON answer came (a buffering proxy): one onText with the whole text", async () => {
  const d = adapter("deepseek", () => answer("Butun javob"));
  const seen: string[] = [];
  const r = await d.a.complete("deepseek-flash", "s", "u", { ...OPTS, onText: (t) => seen.push(t) });
  assert.ok(r.ok);
  assert.deepEqual(seen, ["Butun javob"]);
});

test("reasoning text is excluded: stream and plain", async () => {
  const d = adapter("deepseek", () => sse([chunk({ reasoning_content: "MAXFIY FIKR" }), chunk({ content: "Javob" }), chunk({}, "stop")]));
  const seen: string[] = [];
  const r = await d.a.complete("deepseek-flash", "s", "u", { ...OPTS, onText: (t) => seen.push(t) });
  assert.ok(r.ok);
  assert.equal(r.text, "Javob");
  assert.ok(!seen.join("").includes("FIKR"));
  const plain = adapter("deepseek", () => answer("Javob", "stop", { reasoning_content: "MAXFIY FIKR" }));
  const p = await plain.a.complete("deepseek-flash", "s", "u", OPTS);
  assert.ok(p.ok);
  assert.equal(p.text, "Javob");
  const onlyThought = adapter("deepseek", () => answer("", "stop", { reasoning_content: "MAXFIY FIKR" }));
  const e = await onlyThought.a.complete("deepseek-flash", "s", "u", OPTS);
  assert.ok(!e.ok);
  assert.equal(e.kind, "empty", "reasoning never stands in for a missing answer");
});

test("a cut stream is a retryable failure, never a short answer", async () => {
  const d = adapter("deepseek", () => sse([chunk({ content: '{"a":' })]));
  const r = await d.a.complete("deepseek-flash", "s", "u", { ...OPTS, onText: () => {} });
  assert.ok(!r.ok);
  assert.equal(r.retryable, true);
  assert.equal(r.kind, "network");
  assert.ok(r.usage && r.usage.outputTokens > 0, "the partial answer is still paid for");
  const hole = adapter("deepseek", () => sse([chunk({ content: "a" }), "data: {not json\n\n", chunk({ content: "b" }, "stop")]));
  const h = await hole.a.complete("deepseek-flash", "s", "u", { ...OPTS, onText: () => {} });
  assert.ok(!h.ok, "a lost chunk leaves a hole in the text");
  assert.equal(h.retryable, true);
});

test("an error object inside the stream fails the attempt", async () => {
  const d = adapter("deepseek", () => sse([chunk({ content: "a" }), `data: ${JSON.stringify({ error: { message: "overloaded", code: 503 } })}\n\n`]));
  const r = await d.a.complete("deepseek-flash", "s", "u", { ...OPTS, onText: () => {} });
  assert.ok(!r.ok);
  assert.equal(r.status, 503);
  assert.equal(r.retryable, true);
});

const STATUS: [number, boolean][] = [
  [400, false],
  [401, false],
  [402, false],
  [403, false],
  [404, false],
  [422, false],
  [429, true],
  [500, true],
  [503, true],
];

for (const [status, retryable] of STATUS) {
  test(`error mapping: ${status} is ${retryable ? "retryable" : "final"}`, async () => {
    const d = adapter("deepseek", () => Response.json({ error: { message: `fail ${status}` } }, { status, headers: { "retry-after": "2" } }));
    const r = (await d.a.complete("deepseek-flash", "s", "u", OPTS)) as Extract<Attempt, { ok: false }>;
    assert.equal(r.ok, false);
    assert.equal(r.status, status);
    assert.equal(r.retryable, retryable);
    assert.equal(r.retryAfterMs, retryable ? 2_000 : undefined);
    assert.match(r.error, new RegExp(`fail ${status}`));
  });
}

test("429 with no quota / arrears: final and account-level (DashScope bodies, both shapes)", async () => {
  const bodies = [
    { error: { message: "You exceeded your current quota, please check your plan and billing details", code: "insufficient_quota" } },
    { code: "Arrearage", message: "Access denied, please make sure your account is in good standing." },
    { code: "Throttling.AllocationQuota", message: "Free allocated quota exceeded." },
  ];
  for (const b of bodies) {
    const q = adapter("qwen", () => Response.json(b, { status: 429 }));
    const r = (await q.a.complete("qwen3.7-plus", "s", "u", OPTS)) as Extract<Attempt, { ok: false }>;
    assert.equal(r.retryable, false, JSON.stringify(b));
    assert.equal(r.account, true, JSON.stringify(b));
  }
});

test("content inspection: a refusal, not an account problem", async () => {
  const q = adapter("qwen", () => Response.json({ error: { message: "Input or output data may contain inappropriate content.", code: "data_inspection_failed" } }, { status: 400 }));
  const r = (await q.a.complete("qwen3.7-plus", "s", "u", OPTS)) as Extract<Attempt, { ok: false }>;
  assert.equal(r.kind, "safety");
  assert.equal(r.retryable, false);
  assert.ok(!r.account);
});

test("finish reasons: length, content_filter, DeepSeek's resource stop, blank JSON", async () => {
  const cut = await adapter("deepseek", () => answer("kesilgan", "length")).a.complete("m", "s", "u", OPTS);
  assert.ok(cut.ok);
  assert.equal(cut.finishReason, "MAX_TOKENS", "the JSON retry reads this");
  const empty = (await adapter("deepseek", () => answer("", "length")).a.complete("m", "s", "u", OPTS)) as Extract<Attempt, { ok: false }>;
  assert.deepEqual([empty.kind, empty.retryable, empty.finishReason], ["truncated", false, "MAX_TOKENS"]);
  const filtered = (await adapter("qwen", () => answer("yarim", "content_filter")).a.complete("m", "s", "u", OPTS)) as Extract<Attempt, { ok: false }>;
  assert.deepEqual([filtered.ok, filtered.kind, filtered.retryable], [false, "safety", false]);
  const res = (await adapter("deepseek", () => answer("yarim", "insufficient_system_resource")).a.complete("m", "s", "u", OPTS)) as Extract<Attempt, { ok: false }>;
  assert.deepEqual([res.ok, res.retryable], [false, true]);
  const blank = (await adapter("deepseek", () => answer("   \n  ")).a.complete("m", "s", "u", { ...OPTS, json: true })) as Extract<Attempt, { ok: false }>;
  assert.deepEqual([blank.kind, blank.retryable], ["empty", true], "DeepSeek blanks invalid JSON to spaces");
});

test("network error is retryable, timeout aborts and is final for this provider", async () => {
  const net = adapter("deepseek", () => Promise.reject(new TypeError("fetch failed", { cause: { code: "ECONNRESET" } })));
  const r = (await net.a.complete("m", "s", "u", OPTS)) as Extract<Attempt, { ok: false }>;
  assert.deepEqual([r.retryable, r.kind], [true, "network"]);
  assert.match(r.error, /ECONNRESET/);
  const hung: typeof fetch = ((_u: string, init: RequestInit) =>
    new Promise((_r, reject) => {
      init.signal!.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    })) as unknown as typeof fetch;
  const t = (await makeOpenAiCompatAdapter(OPENAI_COMPAT_PRESETS.deepseek, { fetchImpl: hung }).complete("m", "s", "u", { maxTokens: 1, timeoutMs: 20 })) as Extract<Attempt, { ok: false }>;
  assert.deepEqual([t.kind, t.retryable], ["timeout", false]);
});

test("a 400 about max_tokens: one more try with the limit the message names, else half", async () => {
  let n = 0;
  const named = adapter("qwen", () => (++n === 1 ? Response.json({ error: { message: "Range of max_tokens should be [1, 8192]" } }, { status: 400 }) : answer("Javob")));
  const r = await named.a.complete("qwen3.8-flash", "s", "u", { ...OPTS, maxTokens: 20_000 });
  assert.ok(r.ok);
  assert.deepEqual(named.seen.map((s) => s.body.max_tokens), [20_000, 8192]);
  n = 0;
  const unnamed = adapter("deepseek", () => (++n === 1 ? Response.json({ error: { message: "max_tokens is too large" } }, { status: 422 }) : answer("Javob")));
  await unnamed.a.complete("m", "s", "u", { ...OPTS, maxTokens: 20_000 });
  assert.deepEqual(unnamed.seen.map((s) => s.body.max_tokens), [20_000, 10_000]);
  const twice = adapter("qwen", () => Response.json({ error: { message: "max_tokens out of range" } }, { status: 400 }));
  const f = (await twice.a.complete("m", "s", "u", { ...OPTS, maxTokens: 20_000 })) as Extract<Attempt, { ok: false }>;
  assert.equal(twice.seen.length, 2, "once, not a loop");
  assert.deepEqual([f.ok, f.status, f.retryable], [false, 400, false]);
  const other = adapter("qwen", () => Response.json({ error: { message: "Invalid messages" } }, { status: 400 }));
  await other.a.complete("m", "s", "u", OPTS);
  assert.equal(other.seen.length, 1, "any other 400 is not retried");
});

test("a refused redirect is final: the same request gets the same redirect", async () => {
  const d = adapter("deepseek", () => Promise.reject(new TypeError("fetch failed", { cause: new Error("unexpected redirect") })));
  const r = (await d.a.complete("m", "s", "u", OPTS)) as Extract<Attempt, { ok: false }>;
  assert.equal(r.ok, false);
  assert.equal(r.retryable, false);
});

const CHINESE = "这是一个完全用中文写的答案，内容不是乌兹别克语。";

test("language guard: above 2 % of letters fails like an empty answer, final for this provider, paid", async () => {
  const d = adapter("deepseek", () => answer(CHINESE));
  const r = (await d.a.complete("m", "O'zbekcha yozing", "suv", OPTS)) as Extract<Attempt, { ok: false }>;
  assert.deepEqual([r.ok, r.kind, r.retryable], [false, "empty", false]);
  assert.deepEqual(r.usage, { inputTokens: 1000, outputTokens: 500 });
  const inJson = (await adapter("qwen", () => answer(JSON.stringify({ title: CHINESE }))).a.complete("m", "s", "u", { ...OPTS, json: true })) as Extract<Attempt, { ok: false }>;
  assert.equal(inJson.kind, "empty", "a JSON answer is checked too");
  const stream = (await adapter("deepseek", () => sse([chunk({ content: CHINESE }), chunk({}, "stop")])).a.complete("m", "s", "u", { ...OPTS, onText: () => {} })) as Extract<Attempt, { ok: false }>;
  assert.equal(stream.kind, "empty", "a streamed answer is checked too");
});

test("language guard: a few quoted characters pass, and so does a request that allows CJK", async () => {
  const term = await adapter("deepseek", () => answer("水 va 火 belgilari.")).a.complete("m", "s", "u", OPTS);
  assert.ok(term.ok, "two characters are a quoted term, whatever their share of a short answer");
  const ratio = await adapter("deepseek", () => answer(`${"O'zbek tilidagi uzun matn ".repeat(40)} 光合作用 atamasi`)).a.complete("m", "s", "u", OPTS);
  assert.ok(ratio.ok, "four characters under 2 % of the letters");
  for (const system of ["OUTPUT LANGUAGE: Chinese (Simplified) (中文). This is absolute.", "Target language: Japanese.", "OUTPUT LANGUAGE: Korean (한국어).", "Mavzu: Xitoy tarixi"]) {
    const ok = await adapter("qwen", () => answer(CHINESE)).a.complete("m", system, "u", OPTS);
    assert.ok(ok.ok, system);
  }
});

test("<think> blocks: removed from the answer and from the live text, also while unclosed", async () => {
  const plain = await adapter("qwen", () => answer("<think>MAXFIY FIKR</think>\nJavob")).a.complete("m", "s", "u", OPTS);
  assert.ok(plain.ok);
  assert.equal(plain.text, "Javob");
  const only = (await adapter("qwen", () => answer("<think>MAXFIY FIKR", "length")).a.complete("m", "s", "u", OPTS)) as Extract<Attempt, { ok: false }>;
  assert.deepEqual([only.ok, only.kind], [false, "truncated"]);
  const seen: string[] = [];
  const s = adapter("deepseek", () => sse([chunk({ content: "<think>MAXFIY" }), chunk({ content: " FIKR</think>Jav" }), chunk({ content: "ob" }, "stop")]));
  const r = await s.a.complete("m", "s", "u", { ...OPTS, onText: (t) => seen.push(t) });
  assert.ok(r.ok);
  assert.equal(r.text, "Javob");
  assert.deepEqual(seen, ["Jav", "Javob"]);
});

test("SSE caps: an endless line or an endless answer ends the stream, final", async () => {
  const line = (await adapter("deepseek", () => sse([`data: ${"x".repeat(1_000_100)}`])).a.complete("m", "s", "u", { ...OPTS, onText: () => {} })) as Extract<Attempt, { ok: false }>;
  assert.deepEqual([line.ok, line.error, line.retryable], [false, "stream too large", false]);
  const piece = chunk({ content: "a".repeat(900_000) });
  const text = (await adapter("deepseek", () => sse(Array.from({ length: 5 }, () => piece))).a.complete("m", "s", "u", { ...OPTS, onText: () => {} })) as Extract<Attempt, { ok: false }>;
  assert.deepEqual([text.ok, text.error, text.retryable], [false, "stream too large", false]);
});

test("the key never leaks: an echoed key is removed from the error", async () => {
  const d = adapter("deepseek", () => Response.json({ error: { message: `Incorrect API key provided: ${KEY}` } }, { status: 401 }));
  const r = (await d.a.complete("m", "s", "u", OPTS)) as Extract<Attempt, { ok: false }>;
  assert.ok(!JSON.stringify(r).includes(KEY));
  assert.match(r.error, /Incorrect API key/);
  const net = adapter("deepseek", () => Promise.reject(new Error(`connect failed for ${KEY}`)));
  assert.ok(!JSON.stringify(await net.a.complete("m", "s", "u", OPTS)).includes(KEY));
  const sent = adapter("deepseek", () => answer("x"));
  await sent.a.complete("m", "s", "u", OPTS);
  assert.ok(!String(sent.seen[0].init.body).includes(KEY), "only the Authorization header carries it");
  assert.ok(!sent.seen[0].url.includes(KEY));
});

test("no key: no request", async () => {
  delete process.env.DEEPSEEK_API_KEY;
  const d = adapter("deepseek", () => answer("x"));
  const r = await d.a.complete("m", "s", "u", OPTS);
  assert.ok(!r.ok);
  assert.equal(d.seen.length, 0);
});

test("base URL override: https only, trailing slash dropped", () => {
  const p = OPENAI_COMPAT_PRESETS.qwen;
  assert.equal(presetBaseUrl(p, envOf({ DASHSCOPE_BASE_URL: "https://ws1.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1/" })), "https://ws1.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1");
  assert.equal(presetBaseUrl(p, envOf({ DASHSCOPE_BASE_URL: "http://evil.example/v1" })), p.baseUrl);
  assert.equal(presetBaseUrl(p, envOf({ DASHSCOPE_BASE_URL: "http://ws1.ap-southeast-1.maas.aliyuncs.com/v1" })), p.baseUrl, "https only");
  assert.equal(presetBaseUrl(p, envOf({ DASHSCOPE_BASE_URL: "https://evil.example/v1" })), p.baseUrl, "Alibaba hosts only");
  assert.equal(presetBaseUrl(p, envOf({ DASHSCOPE_BASE_URL: "https://x.aliyuncs.com.evil.example/v1" })), p.baseUrl);
  assert.equal(presetBaseUrl(p, envOf({ DASHSCOPE_BASE_URL: "https://user:pw@x.aliyuncs.com/v1" })), p.baseUrl);
  assert.equal(presetBaseUrl(p, envOf({ DASHSCOPE_BASE_URL: "not a url" })), p.baseUrl);
  assert.equal(presetBaseUrl(p, envOf({})), p.baseUrl);
  assert.equal(presetBaseUrl(OPENAI_COMPAT_PRESETS.deepseek, envOf({ DASHSCOPE_BASE_URL: "https://x.example" })), OPENAI_COMPAT_PRESETS.deepseek.baseUrl);
});

test("every preset is wired end to end: adapter, registry, catalog, price book, role spec", () => {
  for (const id of OPENAI_COMPAT_IDS) {
    const p = OPENAI_COMPAT_PRESETS[id];
    assert.equal(p.id, id);
    assert.equal(OPENAI_COMPAT_ADAPTERS[id].id, id);
    const def = providerDef(id)!;
    assert.deepEqual(def.kinds, ["llm"]);
    assert.equal(def.testable, true);
    assert.equal(PROVIDER_META[id].billing, "paid");
    assert.equal(PROVIDER_META[id].need, "optional");
    assert.match(PROVIDER_META[id].priceNote, /\$/);
    assert.ok(modelOptions("llm.chain").some((o) => o.provider === id && o.model === p.defaultModel), `${id}: its default model is selectable (priced)`);
    assert.ok(costUsd({ provider: id, model: p.defaultModel, inputTokens: 1_000_000, outputTokens: 0 }) > 0);
    assert.deepEqual(parseRoleSpec(`${id}:${p.defaultModel}`), [{ provider: id, model: p.defaultModel }]);
  }
});

test("price rows: the official figures read on 2026-11-05", () => {
  const rate = (provider: string, model: string) => [costUsd({ provider, model, inputTokens: 1e6, outputTokens: 0 }), costUsd({ provider, model, inputTokens: 0, outputTokens: 1e6 })];
  assert.deepEqual(rate("qwen", "qwen3.7-plus"), [0.4, 1.6]);
  assert.deepEqual(rate("qwen", "qwen3.8-flash"), [0.15, 0.47]);
  assert.deepEqual(rate("deepseek", "deepseek-flash"), [0.3, 1.2], "the PEAK rate");
  assert.deepEqual(rate("deepseek", "deepseek-v4-pro"), [1.32, 3.96], "the PEAK rate");
});

test("probe: DeepSeek reads the balance and spends one token, Qwen spends one token; the key stays in the header", async () => {
  const d = probeRequest("deepseek", KEY) as { url: string; headers: Record<string, string>; method?: string };
  assert.equal(d.url, "https://api.deepseek.com/user/balance");
  assert.equal(d.method, undefined);
  assert.equal(d.headers.Authorization, `Bearer ${KEY}`);
  const q = probeRequest("qwen", KEY) as { url: string; method: string; body: string };
  assert.equal(q.url, "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions");
  assert.equal(q.method, "POST");
  assert.deepEqual(JSON.parse(q.body), { model: "qwen3.7-plus", messages: [{ role: "user", content: "1" }], max_tokens: 1, enable_thinking: false });
  assert.ok(!q.url.includes(KEY) && !q.body.includes(KEY));

  const calls: { method?: string; body?: unknown }[] = [];
  const ok = (async (_u: string, init: RequestInit) => {
    calls.push({ method: init.method, body: init.body });
    return Response.json({ is_available: true, balance_infos: [{ currency: "USD", total_balance: "12.50" }] });
  }) as unknown as typeof fetch;
  assert.deepEqual(await probeProvider("deepseek", KEY, { fetchImpl: ok }), { ok: true, message: "Kalit qabul qilindi · balans 12.5 USD" });
  assert.equal(calls[0].method, "GET");
  assert.equal(calls[1].method, "POST", "the configured model is called too");
  assert.equal(JSON.parse(String(calls[1].body)).model, "deepseek-flash");
  assert.equal(JSON.parse(String(calls[1].body)).max_tokens, 1);
  await probeProvider("qwen", KEY, { fetchImpl: ok });
  assert.equal(calls[2].method, "POST");
  const wrongModel = (async (_u: string, init: RequestInit) =>
    init.method === "POST" ? Response.json({ error: { message: "Model Not Exist" } }, { status: 400 }) : Response.json({ is_available: true, balance_infos: [] })) as unknown as typeof fetch;
  const bad = await probeProvider("deepseek", KEY, { fetchImpl: wrongModel });
  assert.equal(bad.ok, false, "a wrong model id is caught here, not during an outage");
  assert.match(bad.message, /HTTP 400.*Model Not Exist/);
  const denied = (async () => Response.json({ error: { message: `bad key ${KEY}` } }, { status: 401 })) as unknown as typeof fetch;
  const r = await probeProvider("qwen", KEY, { fetchImpl: denied });
  assert.equal(r.ok, false);
  assert.match(r.message, /HTTP 401/);
  assert.ok(!r.message.includes(KEY));
});

test("deepseekMessage: an empty balance says so, junk adds nothing", () => {
  assert.match(deepseekMessage({ is_available: false, balance_infos: [{ currency: "USD", total_balance: "0.00" }] }), /balans 0 USD · balans yetarli emas/);
  assert.equal(deepseekMessage(null), "Kalit qabul qilindi");
  assert.equal(deepseekMessage({ balance_infos: [{ currency: "<b>", total_balance: "x" }] }), "Kalit qabul qilindi");
});
