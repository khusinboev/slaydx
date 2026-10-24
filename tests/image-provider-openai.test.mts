import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { openaiProvider, openaiSizeFor, isValidOpenaiSize, requestOpenaiImage, scrubSecrets, OPENAI_IMAGE_DEFAULT_MODEL } from "../lib/generation/image-provider-openai.ts";
import { IMAGE_RATIOS } from "../lib/generation/image-studio-options.ts";
import { withJobCost } from "../lib/generation/job-cost.ts";
import { OPENAI_IMAGE_FALLBACK_USD, IMAGE_PRICES, openaiImageUsd } from "../lib/generation/llm-pricing.ts";
import { resetProviderCache, setProviderSnapshot } from "../lib/server/providers/resolve.ts";

/**
 * OpenAI image adapter (program-17 item 5) -- fetch is STUBBED. No live call was made (no OpenAI key on the build
 * machine); the request/response shape follows https://developers.openai.com/api/docs/guides/image-generation
 * (checked 2026-10-24) and is locked here.
 *
 * Mutation checks (each made the named test fail, then restored):
 *   - put the key into a log line (`console.warn("[openai-image]", key)`) -> "the key never reaches a log";
 *   - skip `scrubSecrets` on the provider error text -> the same test (the error body echoes a masked key).
 */

const KEY = "sk-test-0123456789abcdefSECRETKEY";
const B64 = Buffer.alloc(300, 9).toString("base64");
const ASK = { prompt: "a red apple", size: { width: 1024, height: 1024 }, styleId: "photo" } as const;

type Sent = { url: string; init: RequestInit; body: Record<string, unknown> };
let sent: Sent[] = [];
const saved = { fetch: globalThis.fetch, key: process.env.OPENAI_API_KEY, model: process.env.OPENAI_IMAGE_MODEL };
const logs: string[] = [];
const savedConsole = { log: console.log, warn: console.warn, error: console.error, info: console.info };

function stub(handler: (n: number) => Response | Promise<Response> | never) {
  let n = 0;
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    sent.push({ url: String(url), init, body: JSON.parse(String(init.body)) });
    return handler(n++);
  }) as unknown as typeof fetch;
}
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const OK = { data: [{ b64_json: B64 }], usage: { input_tokens: 40, input_tokens_details: { text_tokens: 40, image_tokens: 0 }, output_tokens: 1767 } };

beforeEach(() => {
  sent = [];
  logs.length = 0;
  process.env.OPENAI_API_KEY = KEY;
  delete process.env.OPENAI_IMAGE_MODEL;
  resetProviderCache();
  for (const k of ["log", "warn", "error", "info"] as const) console[k] = (...a: unknown[]) => void logs.push(a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" "));
});
afterEach(() => {
  globalThis.fetch = saved.fetch;
  if (saved.key === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = saved.key;
  if (saved.model === undefined) delete process.env.OPENAI_IMAGE_MODEL;
  else process.env.OPENAI_IMAGE_MODEL = saved.model;
  Object.assign(console, savedConsole);
  resetProviderCache();
});

test("request shape: endpoint, bearer header, model, prompt, n, size, quality, jpeg output", async () => {
  stub(() => json(200, OK));
  const r = await requestOpenaiImage({ ...ASK, size: { width: 1024, height: 576 } });
  assert.ok(r.ok);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].url, "https://api.openai.com/v1/images/generations");
  assert.equal(sent[0].init.method, "POST");
  const headers = sent[0].init.headers as Record<string, string>;
  assert.equal(headers.Authorization, `Bearer ${KEY}`);
  assert.equal(headers["Content-Type"], "application/json");
  assert.ok(sent[0].init.signal, "a timeout signal is attached");
  assert.equal(sent[0].body.model, OPENAI_IMAGE_DEFAULT_MODEL);
  assert.equal(sent[0].body.model, "gpt-image-2.5-flare");
  assert.equal(sent[0].body.prompt, "a red apple");
  assert.equal(sent[0].body.n, 1);
  assert.equal(sent[0].body.quality, "medium");
  assert.equal(sent[0].body.output_format, "jpeg");
  assert.equal(sent[0].body.size, openaiSizeFor({ width: 1024, height: 576 }));
  assert.match(String(sent[0].body.size), /^\d+x\d+$/);
});

test("OPENAI_IMAGE_MODEL overrides the model", async () => {
  process.env.OPENAI_IMAGE_MODEL = "gpt-image-2.5-sunburst";
  stub(() => json(200, OK));
  await requestOpenaiImage(ASK);
  assert.equal(sent[0].body.model, "gpt-image-2.5-sunburst");
});

test("base64 answer -> a data URL whose bytes are exactly the decoded image", async () => {
  stub(() => json(200, OK));
  const r = await requestOpenaiImage(ASK);
  assert.ok(r.ok);
  const m = /^data:(image\/jpeg);base64,(.+)$/.exec(r.image.url);
  assert.ok(m, "jpeg data URL");
  assert.deepEqual(Buffer.from(m![2], "base64"), Buffer.alloc(300, 9));
  assert.equal(r.image.alt, "a red apple");
});

test("the answer's output_format decides the mime (png/webp), unknown falls back to jpeg", async () => {
  for (const [fmt, mime] of [["png", "image/png"], ["webp", "image/webp"], ["bmp", "image/jpeg"]] as const) {
    stub(() => json(200, { ...OK, output_format: fmt }));
    const r = await requestOpenaiImage(ASK);
    assert.ok(r.ok && r.image.url.startsWith(`data:${mime};base64,`), fmt);
  }
});

test("sizes: every slot ratio maps to a size the API accepts, in the user's ratio, at about 1 MP", () => {
  for (const r of IMAGE_RATIOS) {
    const size = openaiSizeFor({ width: r.w, height: r.h });
    const [w, h] = size.split("x").map(Number);
    assert.ok(isValidOpenaiSize(w, h), `${r.id} -> ${size} violates the documented limits`);
    const [a, b] = r.id.split(":").map(Number);
    assert.ok(Math.abs(w / h / (a / b) - 1) < 0.02, `${r.id} -> ${size}: ratio drifted`);
    assert.ok(w * h > 850_000 && w * h < 1_250_000, `${r.id} -> ${size}: not about 1 MP`);
  }
  assert.equal(openaiSizeFor({ width: 1024, height: 1024 }), "1024x1024");
  // Extreme slots are clamped to the 1:3..3:1 window, never an invalid size.
  for (const s of [{ width: 5000, height: 100 }, { width: 100, height: 5000 }, { width: 0, height: 0 }]) {
    const [w, h] = openaiSizeFor(s).split("x").map(Number);
    assert.ok(isValidOpenaiSize(w, h), JSON.stringify(s));
  }
});

test("sizes: portrait and landscape slots differ and keep their orientation", () => {
  const [lw, lh] = openaiSizeFor({ width: 1024, height: 576 }).split("x").map(Number);
  const [pw, ph] = openaiSizeFor({ width: 576, height: 1024 }).split("x").map(Number);
  assert.ok(lw > lh && ph > pw);
});

test("content-policy refusal (400 moderation_blocked) -> no image, reason failed, detail names the refusal, nothing recorded", async () => {
  stub(() => json(400, { error: { type: "image_generation_user_error", code: "moderation_blocked", message: "Your request was rejected by the safety system.", moderation_details: { moderation_stage: "input", categories: ["violence"] } } }));
  const { value, cost } = await withJobCost(() => requestOpenaiImage(ASK));
  assert.equal(value.ok, false);
  assert.ok(!value.ok && value.reason === "failed");
  assert.ok(!value.ok && value.detail.startsWith("moderation_blocked"));
  assert.equal(sent.length, 1, "a refusal is not retried unchanged");
  assert.equal(cost.toJson().usd, 0, "no picture, no cost");
});

test("HTTP errors map to the provider-failure contract", async () => {
  const cases: [number, string][] = [[401, "blocked"], [402, "blocked"], [403, "blocked"], [429, "rate"], [500, "failed"], [503, "failed"], [400, "failed"]];
  for (const [status, reason] of cases) {
    stub(() => json(status, { error: { message: "nope", code: "x" } }));
    const r = await requestOpenaiImage(ASK);
    assert.ok(!r.ok && r.reason === reason, `${status} -> ${reason}`);
  }
});

test("a 200 without a picture (empty data, short or missing b64) is a plain failure", async () => {
  for (const body of [{ data: [] }, { data: [{ b64_json: "AAAA" }] }, { data: [{ url: "https://x" }] }, {}, null]) {
    stub(() => json(200, body));
    const r = await requestOpenaiImage(ASK);
    assert.ok(!r.ok && r.reason === "failed", JSON.stringify(body));
  }
});

test("timeout: an aborted fetch is `timeout`; a body read cut by the abort is `timeout` too; a plain network error is `failed`", async () => {
  stub(() => {
    throw Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
  });
  const t = await requestOpenaiImage(ASK);
  assert.ok(!t.ok && t.reason === "timeout");
  stub(() => ({ ok: true, status: 200, json: async () => { throw Object.assign(new Error("aborted"), { name: "AbortError" }); } }) as never);
  const b = await requestOpenaiImage(ASK);
  assert.ok(!b.ok && b.reason === "timeout");
  stub(() => {
    throw new Error("connect ECONNRESET");
  });
  const n = await requestOpenaiImage(ASK);
  assert.ok(!n.ok && n.reason === "failed");
});

test("deadline: under 2 s left -> `timeout` without sending; the request is capped at 90 s", async () => {
  stub(() => json(200, OK));
  const r = await requestOpenaiImage(ASK, Date.now() + 1_000);
  assert.ok(!r.ok && r.reason === "timeout");
  assert.equal(sent.length, 0);
  const realTimeout = AbortSignal.timeout;
  const seen: number[] = [];
  AbortSignal.timeout = ((ms: number) => (seen.push(ms), realTimeout.call(AbortSignal, ms))) as typeof AbortSignal.timeout;
  try {
    await requestOpenaiImage(ASK);
    await requestOpenaiImage(ASK, Date.now() + 600_000);
    await requestOpenaiImage(ASK, Date.now() + 10_000);
  } finally {
    AbortSignal.timeout = realTimeout;
  }
  assert.deepEqual(seen.slice(0, 2), [90_000, 90_000]);
  assert.ok(seen[2] <= 10_000 && seen[2] > 8_000);
});

test("no key: `no-key`, nothing sent; hasKey follows the resolver and the admin switch", async () => {
  delete process.env.OPENAI_API_KEY;
  stub(() => json(200, OK));
  const r = await requestOpenaiImage(ASK);
  assert.ok(!r.ok && r.reason === "no-key");
  assert.equal(sent.length, 0);
  assert.equal(openaiProvider.hasKey(), false);
  process.env.OPENAI_API_KEY = KEY;
  assert.equal(openaiProvider.hasKey(), true);
  // Switched off in «Provayderlar»: the key is hidden even though the env var exists.
  setProviderSnapshot(new Map([["openai-image", { enabled: false, key: null, unreadable: false }]]));
  assert.equal(openaiProvider.hasKey(), false);
  // A key stored in the DB wins over the env var.
  setProviderSnapshot(new Map([["openai-image", { enabled: true, key: "sk-db-key-1234567890", unreadable: false }]]));
  stub(() => json(200, OK));
  await requestOpenaiImage(ASK);
  assert.equal((sent[0].init.headers as Record<string, string>).Authorization, "Bearer sk-db-key-1234567890");
});

test("the key never reaches a log line or a result detail (success, refusal, 401 echoing the key, network error, bad body)", async () => {
  const echoing = `Incorrect API key provided: ${KEY}. You can find your API key at https://platform.openai.com/account/api-keys.`;
  const masked = "Incorrect API key provided: sk-test-****************************KEY.";
  const scenarios: (() => Response)[] = [
    () => json(200, OK),
    () => json(400, { error: { code: "moderation_blocked", message: `blocked for ${KEY}` } }),
    () => json(401, { error: { message: echoing, code: "invalid_api_key" } }),
    () => json(401, { error: { message: masked } }),
    () => json(500, { error: `server said ${KEY}` }),
    () => new Response("<html>bad gateway</html>", { status: 502 }),
  ];
  for (const make of scenarios) {
    stub(() => make());
    const r = await requestOpenaiImage(ASK);
    if (!r.ok) {
      assert.ok(!r.detail.includes(KEY), `detail leaked the key: ${r.detail}`);
      assert.ok(!/sk-[A-Za-z0-9]{6}/.test(r.detail), `detail has a key-shaped token: ${r.detail}`);
    }
  }
  stub(() => {
    throw new Error(`fetch failed for ${KEY}`);
  });
  const net = await requestOpenaiImage(ASK);
  assert.ok(!net.ok && !net.detail.includes(KEY));
  assert.ok(logs.length > 0, "the failures were logged");
  for (const line of logs) {
    assert.ok(!line.includes(KEY), `a log line contains the key: ${line}`);
    assert.ok(!/authorization|bearer/i.test(line), `a log line mentions the request headers: ${line}`);
  }
  assert.equal(scrubSecrets(`x ${KEY} y sk-abcdefgh1234`, KEY), "x [key] y [key]");
});

test("cost: priced from the answer's token usage (published rates), fallback to the documented estimate; failures cost nothing", async () => {
  stub(() => json(200, OK));
  const a = await withJobCost(() => requestOpenaiImage(ASK));
  const want = openaiImageUsd({ textIn: 40, imageIn: 0, imageOut: 1767 });
  assert.ok(Math.abs(want - (40 * 5 + 1767 * 30) / 1_000_000) < 1e-12);
  const part = a.cost.toJson().parts![0];
  assert.equal(part.kind, "image");
  assert.equal(part.provider, "openai");
  assert.equal(part.model, "gpt-image-2.5-flare");
  assert.equal(part.units, 1);
  assert.ok(Math.abs(part.usd - want) < 1e-6, `${part.usd} vs ${want}`);
  assert.ok(part.usd > 0.04 && part.usd < 0.07, "about 5 cents for a medium 1 MP picture");

  stub(() => json(200, { data: [{ b64_json: B64 }] }));
  const b = await withJobCost(() => requestOpenaiImage(ASK));
  assert.equal(b.cost.toJson().parts![0].usd, OPENAI_IMAGE_FALLBACK_USD);

  stub(() => json(500, {}));
  const c = await withJobCost(() => requestOpenaiImage(ASK));
  assert.equal(c.cost.toJson().usd, 0);
  assert.equal(IMAGE_PRICES["gpt-image-2.5-flare"], OPENAI_IMAGE_FALLBACK_USD, "the price book lists the model");
});
