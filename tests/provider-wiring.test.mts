import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { complete, roleSpecs } from "../lib/generation/llm-roles.ts";
import { llmModel } from "../lib/generation/llm.ts";
import { geminiImageModel } from "../lib/generation/image-provider-gemini.ts";
import { requestPexelsImage } from "../lib/generation/image-provider-pexels.ts";
import { requestPixabayImage } from "../lib/generation/image-provider-pixabay.ts";
import { registerProviderCallSink } from "../lib/generation/provider-calls.ts";
import { resetBreakers } from "../lib/generation/llm/breaker.ts";
import { resetRouteSnapshot, setRouteSnapshot } from "../lib/server/providers/route-resolve.ts";
import type { ImageAsk } from "../lib/generation/image-provider.ts";

/**
 * The admin's routing slots really drive the generation layer (owner request 2026-10-31): a stored choice beats the
 * `LLM_*` / `GEMINI_*` environment variable, which beats the built-in default — for the role chains (`roleSpecs`,
 * `complete`), the default Gemini text model (`llmModel`) and the Gemini image model; a chain whose first provider has
 * no key falls through to the next one; the stock-photo providers report every real request to the usage counter.
 *
 * Mutation checks (each made the named test fail, then restored):
 *   - read `process.env.LLM_<ROL>` first in `roleSpecs` -> "a stored chain beats the env chain" fails;
 *   - return the env/default model from `llmModel` -> "the stored text model ..." fails;
 *   - drop `recordProviderCall` after the Pexels fetch -> "stock providers count every real request" fails;
 *   - count a no-key / no-query call -> the same test fails (nothing went out, nothing is counted).
 */

const ENV_NAMES = ["GEMINI_API_KEY", "GEMINI_MODEL", "GEMINI_IMAGE_MODEL", "ANTHROPIC_API_KEY", "LLM_WRITER", "LLM_RESEARCHER", "LLM_JUDGE", "LLM_FAST", "PEXELS_API_KEY", "PIXABAY_API_KEY"];
const saved = Object.fromEntries(ENV_NAMES.map((n) => [n, process.env[n]]));
const realFetch = globalThis.fetch;

function setEnv(env: Record<string, string>) {
  for (const n of ENV_NAMES) delete process.env[n];
  for (const [k, v] of Object.entries(env)) process.env[k] = v;
}

afterEach(() => {
  resetRouteSnapshot();
  registerProviderCallSink(null);
  resetBreakers();
  globalThis.fetch = realFetch;
  for (const n of ENV_NAMES) {
    if (saved[n] === undefined) delete process.env[n];
    else process.env[n] = saved[n];
  }
});

const geminiOk = (text: string) => ({
  ok: true,
  status: 200,
  json: async () => ({ candidates: [{ content: { parts: [{ text }] } }], usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 2 } }),
});

function stubGemini(): string[] {
  const urls: string[] = [];
  globalThis.fetch = (async (url: string) => {
    urls.push(String(url));
    return geminiOk("Salom") as never;
  }) as typeof fetch;
  return urls;
}

const stored = (id: string, entries: Array<{ provider: string; model: string | null }>) =>
  setRouteSnapshot(new Map([[id, entries.map((e) => ({ provider: e.provider as "gemini", model: e.model }))]]));

test("a stored chain beats the env chain, which beats the default", () => {
  setEnv({ GEMINI_API_KEY: "g-key", ANTHROPIC_API_KEY: "a-key", LLM_JUDGE: "gemini:gemini-3.7-flash" });
  assert.deepEqual(roleSpecs("judge"), [{ provider: "gemini", model: "gemini-3.7-flash" }], "env");
  stored("llm.judge", [{ provider: "anthropic", model: "claude-sonnet-5" }, { provider: "gemini", model: "gemini-3.1-pro" }]);
  assert.deepEqual(roleSpecs("judge"), [{ provider: "anthropic", model: "claude-sonnet-5" }, { provider: "gemini", model: "gemini-3.1-pro" }], "stored");
  assert.deepEqual(roleSpecs("writer"), [{ provider: "gemini", model: "gemini-3.7-flash" }], "another role is untouched: the default");
  resetRouteSnapshot();
  assert.deepEqual(roleSpecs("judge"), [{ provider: "gemini", model: "gemini-3.7-flash" }], "reset: the env value applies again");
});

test("no key at all and nothing chosen: no chain, `complete` answers null without a call", async () => {
  setEnv({});
  assert.deepEqual(roleSpecs("writer"), []);
  const urls = stubGemini();
  assert.equal(await complete("writer", "SYS", "USER"), null);
  assert.equal(urls.length, 0);
});

test("`complete` calls the stored model, not the env one", async () => {
  setEnv({ GEMINI_API_KEY: "g-key", LLM_WRITER: "gemini:gemini-3.5-flash-lite" });
  stored("llm.writer", [{ provider: "gemini", model: "gemini-3.1-pro" }]);
  const urls = stubGemini();
  const res = await complete("writer", "SYS", "USER");
  assert.equal(res?.text, "Salom");
  assert.equal(res?.usage?.model, "gemini-3.1-pro");
  assert.ok(urls[0].includes("gemini-3.1-pro") && !urls[0].includes("flash-lite"), urls[0]);
});

test("a stored chain whose first provider has no key falls through to the next one", async () => {
  setEnv({ GEMINI_API_KEY: "g-key" });
  stored("llm.judge", [{ provider: "anthropic", model: "claude-sonnet-5" }, { provider: "gemini", model: "gemini-3.7-flash" }]);
  const urls = stubGemini();
  const res = await complete("judge", "SYS", "USER");
  assert.equal(res?.usage?.provider, "gemini", "Claude has no key: the fallback answered");
  assert.equal(urls.length, 1);
});

test("the stored text model and image model drive `llmModel` and `geminiImageModel`", () => {
  setEnv({ GEMINI_MODEL: "gemini-3.5-flash-lite", GEMINI_IMAGE_MODEL: "gemini-3.1-flash-image" });
  assert.equal(llmModel(), "gemini-3.5-flash-lite", "env");
  assert.equal(geminiImageModel(), "gemini-3.1-flash-image", "env");
  stored("llm.model", [{ provider: "gemini", model: "gemini-3.1-pro" }]);
  setRouteSnapshot(new Map([["llm.model", [{ provider: "gemini", model: "gemini-3.1-pro" }]], ["image.gemini", [{ provider: "gemini", model: "gemini-3.1-flash-lite-image" }]]]));
  assert.equal(llmModel(), "gemini-3.1-pro", "the stored text model beats the env one");
  assert.equal(geminiImageModel(), "gemini-3.1-flash-lite-image", "the stored image model beats the env one");
  resetRouteSnapshot();
  setEnv({});
  assert.equal(llmModel(), "gemini-3.7-flash", "default");
  assert.equal(geminiImageModel(), "gemini-3.1-flash-lite-image", "default");
});

/* ───────────────────────────── stock counters ───────────────────────────── */

const ASK = { searchQuery: "mountains", size: "landscape" } as unknown as ImageAsk;
const res = (status: number, body: unknown = {}) => ({ ok: status < 400, status, statusText: `s${status}`, json: async () => body }) as never;

test("stock providers count every real request, and only those", async () => {
  const seen: Array<[string, boolean]> = [];
  registerProviderCallSink((p, ok) => seen.push([p, ok]));

  // Nothing went out: no key, no query, no budget.
  setEnv({});
  globalThis.fetch = (async () => {
    throw new Error("must not be called");
  }) as typeof fetch;
  await requestPexelsImage(ASK);
  await requestPixabayImage(ASK);
  setEnv({ PEXELS_API_KEY: "p-key", PIXABAY_API_KEY: "x-key" });
  await requestPexelsImage({ ...ASK, searchQuery: "" } as ImageAsk);
  await requestPixabayImage({ ...ASK, searchQuery: "" } as ImageAsk);
  await requestPexelsImage(ASK, Date.now() + 500);
  assert.deepEqual(seen, [], "a skipped provider is not a request");

  globalThis.fetch = (async (url: string) => (String(url).includes("pexels") ? res(200, { photos: [{ src: { large2x: "https://images.pexels.com/a.jpg" } }] }) : res(500))) as typeof fetch;
  await requestPexelsImage(ASK);
  await requestPixabayImage(ASK);
  assert.deepEqual(seen, [["pexels", true], ["pixabay", false]], "ok and HTTP-error responses");

  seen.length = 0;
  globalThis.fetch = (async () => {
    throw new Error("ECONNRESET");
  }) as typeof fetch;
  await requestPexelsImage(ASK);
  assert.deepEqual(seen, [["pexels", false]], "a network failure is one failed request");

  seen.length = 0;
  globalThis.fetch = (async () => ({ ok: true, status: 200, statusText: "ok", json: async () => Promise.reject(new Error("bad json")) }) as never) as typeof fetch;
  await requestPexelsImage(ASK);
  assert.deepEqual(seen, [["pexels", true]], "a broken body after a good response is NOT counted twice");
});
